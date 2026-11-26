const moment = require('moment');
const Plugin = require('../entities/plugin');
const Download = require('../entities/download');
const UserEarnings = require('../entities/userEarnings');
const PurchaseOrder = require('../entities/purchaseOrder');
const RazorpayOrder = require('../entities/razorpayOrder');
const earningsReview = require('./earningsReview');

function normalizeOrderId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPurchased(state) {
  return (typeof state === 'number' || (typeof state === 'string' && state.trim() !== '')) && Number(state) === PurchaseOrder.STATE_PURCHASED;
}

function indexReport(report) {
  const amounts = new Map();
  for (const row of report) {
    // Missing report keys must never match legacy purchases with a missing order ID.
    const orderId = normalizeOrderId(row?.Description);
    if (!orderId) continue;
    const rawAmount = row['Amount (Merchant Currency)'];
    const amount = typeof rawAmount === 'number' || (typeof rawAmount === 'string' && rawAmount.trim()) ? Number(rawAmount) : NaN;
    const total = (amounts.get(orderId) ?? 0) + amount;
    // Keep invalid orders marked so only their developers are held for review.
    amounts.set(orderId, Number.isFinite(amount) && Number.isSafeInteger(Math.round(total * 100)) ? total : NaN);
  }
  return amounts;
}

/**
 * Calculate earnings from paid plugins
 * @param {number} year
 * @param {number} month
 * @param {object} user
 * @param {Array<object>|Map<string, number>} [report] Report rows or the normalized index returned by indexReport.
 * @returns {Promise<number>}
 */
async function fromPaidPlugins(year, month, user, report) {
  const { monthStart, nextMonthStart } = getDate(year, month);
  const plugins = await Plugin.for('internal').get([Plugin.ID], [Plugin.USER_ID, user.id]);
  const orders = await PurchaseOrder.for('internal').get([
    [PurchaseOrder.PLUGIN_ID, plugins.map((p) => p.id)],
    [PurchaseOrder.CREATED_AT, monthStart, '>='],
    [PurchaseOrder.CREATED_AT, nextMonthStart, '<'],
  ]);

  const reportAmounts = report instanceof Map ? report : indexReport(report || []);
  // Validate this developer's payable orders before updating any of their amounts.
  for (const order of orders) {
    const orderId = normalizeOrderId(order.order_id);
    if (
      isPurchased(order.state) &&
      order.provider !== PurchaseOrder.PROVIDER_RAZORPAY &&
      orderId &&
      reportAmounts.has(orderId) &&
      !Number.isFinite(reportAmounts.get(orderId))
    ) {
      const error = new Error(`Invalid Google report amount for order ${order.order_id}; earnings held for user ${user.id}.`);
      error.code = 'INVALID_GOOGLE_REPORT';
      error.statusCode = 409;
      throw error;
    }
  }

  const razorpayOrderIds = orders
    .filter(({ provider, order_id: orderId }) => provider === PurchaseOrder.PROVIDER_RAZORPAY && orderId)
    .map(({ order_id: orderId }) => orderId);
  const razorpayAmountsInr = new Map();
  if (razorpayOrderIds.length) {
    const razorpayOrders = await RazorpayOrder.for('internal').get(
      [RazorpayOrder.RAZORPAY_ORDER_ID, RazorpayOrder.AMOUNT_INR],
      [RazorpayOrder.RAZORPAY_ORDER_ID, razorpayOrderIds, 'IN'],
    );
    for (const order of razorpayOrders) {
      const amountInr = Number(order.amount_inr);
      if (Number.isFinite(amountInr) && amountInr > 0) {
        razorpayAmountsInr.set(String(order.razorpay_order_id), amountInr);
      }
    }
  }

  // Hold the developer before any report amount updates if an INR basis is missing.
  const missingInr = orders.filter(
    (order) =>
      isPurchased(order.state) &&
      order.provider === PurchaseOrder.PROVIDER_RAZORPAY &&
      !razorpayAmountsInr.has(String(order.order_id)) &&
      (order.currency || 'INR').toUpperCase() !== 'INR',
  );
  if (missingInr.length) {
    const error = new Error(
      `Missing INR accounting amounts for Razorpay orders ${missingInr.map((order) => order.order_id || order.id).join(', ')}; earnings held for user ${user.id}.`,
    );
    error.code = 'MISSING_RAZORPAY_INR';
    error.statusCode = 409;
    throw error;
  }

  const amounts = await Promise.all(
    orders.map(async ({ id: rowId, order_id: orderId, amount, state, provider }) => {
      if (!isPurchased(state)) {
        return 0;
      }

      if (provider === PurchaseOrder.PROVIDER_RAZORPAY) {
        // Keep purchase_order in the buyer's charged currency. Developer
        // earnings use the immutable INR value captured when the order was created.
        let accountingAmount = razorpayAmountsInr.get(String(orderId));
        if (accountingAmount === undefined) {
          accountingAmount = amount;
        }
        return accountingAmount * 0.7;
      }

      if (report) {
        const reportOrderId = normalizeOrderId(orderId);
        if (!reportOrderId || !reportAmounts.has(reportOrderId)) {
          // Late registrations may predate the available reports; retain the
          // existing estimate instead of dropping them from their registration month.
          return amount * 0.7;
        }

        const calculatedAmount = reportAmounts.get(reportOrderId);

        if (calculatedAmount !== amount) {
          await PurchaseOrder.update([PurchaseOrder.AMOUNT, calculatedAmount], [PurchaseOrder.ID, rowId]);
        }

        // apply 15% platform fee (Google's fee is already reflected in the settlement amount)
        return Math.round(calculatedAmount * 85) / 100;
      }

      return amount * 0.7;
    }),
  );

  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
}

/**
 * Gets earnings from downloads
 * @param {number} year year
 * @param {number} month month (0-11)
 * @param {object} user
 * @returns {Promise<number>}
 */
async function fromDownloads(year, month, user) {
  const { monthStart, nextMonthStart } = getDate(year, month);
  const plugins = await Plugin.for('internal').get([Plugin.ID], [Plugin.USER_ID, user.id]);
  const downloads = await Download.count([
    [Download.PLUGIN_ID, plugins.map((p) => p.id)],
    [Download.CREATED_AT, monthStart, '>='],
    [Download.CREATED_AT, nextMonthStart, '<'],
    [Download.PACKAGE_NAME, 'com.foxdebug.acodefree'],
  ]);

  // INR 12 per 1000 downloads
  return Math.round(downloads * 0.012 * 100) / 100;
}

/**
 * Get total earnings for user
 * @param {number} year
 * @param {number} month month (0-11)
 * @param {object} user
 * @param {Array<object>|Map<string, number>} [report]
 * @param {number|null} [downloadEarnings] Use this amount instead of counting the stored downloads
 */
async function total(year, month, user, report, downloadEarnings) {
  let earnings = await fromPaidPlugins(year, month, user, report);
  earnings += downloadEarnings ?? (await fromDownloads(year, month, user));
  earnings = Number.parseFloat(Math.round(earnings * 100) / 100);
  return earnings;
}

/**
 * @typedef {object} UnpaidEarnings
 * @property {Array<number>} ids
 * @property {number} earnings
 * @property {moment.Moment} from
 * @property {moment.Moment} to
 */

/**
 * Get unpaid earnings for user
 * @param {object} user user object
 * @param {number} [year] year to exclude
 * @param {number} [month] month to exclude
 * @returns {Promise<UnpaidEarnings>}
 */
async function unpaid(user, year, month) {
  await earningsReview.assertClear(user.id);
  let earnings = 0;
  const ids = [];
  const where = [
    [UserEarnings.USER_ID, user.id],
    [UserEarnings.PAYMENT_ID, null],
  ];

  if (year && month) {
    where.push([UserEarnings.MONTH, month, '<'], [UserEarnings.YEAR, year], 'OR', [UserEarnings.YEAR, year, '<']);
  }

  const unpaidEarnings = await UserEarnings.get([UserEarnings.AMOUNT, UserEarnings.ID, UserEarnings.MONTH, UserEarnings.YEAR], where);

  let fromMonth = 31;
  let fromYear = 9999;
  let toMonth = 0;
  let toYear = 0;

  for (const earning of unpaidEarnings) {
    const { id, amount, month: thisMonth, year: thisYear } = earning;
    ids.push(id);

    if (thisYear < fromYear || (thisYear === fromYear && thisMonth < fromMonth)) {
      fromMonth = thisMonth;
      fromYear = thisYear;
    }

    if (thisYear > toYear || (thisYear === toYear && thisMonth > toMonth)) {
      toMonth = thisMonth;
      toYear = thisYear;
    }

    earnings += Number.parseFloat(amount);
  }

  earnings = Number.parseFloat(Math.round(earnings * 100) / 100);
  return {
    ids,
    earnings,
    from: moment({ year: fromYear, month: fromMonth }).startOf('month'),
    to: moment({ year: toYear, month: toMonth }).endOf('month'),
  };
}

/**
 * Get date range for month
 * @param {number} year year
 * @param {number} month month (0-11)
 * @returns {{monthStart: string, nextMonthStart: string}}
 */
function getDate(year, month) {
  const date = moment({ month, year });
  const monthStart = date.startOf('month').format('YYYY-MM-DD');
  const nextMonthStart = date.add(1, 'month').format('YYYY-MM-DD');
  return { monthStart, nextMonthStart };
}

module.exports = {
  indexReport,
  fromPaidPlugins,
  fromDownloads,
  unpaid,
  total,
};
