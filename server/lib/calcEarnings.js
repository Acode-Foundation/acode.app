const moment = require('moment');
const Plugin = require('../entities/plugin');
const Download = require('../entities/download');
const UserEarnings = require('../entities/userEarnings');
const PurchaseOrder = require('../entities/purchaseOrder');

/**
 * Calculate earnings from paid plugins
 * @param {number} year
 * @param {number} month
 * @param {object} user
 * @param {Array<object>} [report]
 * @returns {Promise<number>}
 */
async function fromPaidPlugins(year, month, user, report) {
  const { monthStart, monthEnd } = getDate(year, month);
  const plugins = await Plugin.get([Plugin.ID], [Plugin.USER_ID, user.id]);
  const orders = await PurchaseOrder.for('internal').get([
    [PurchaseOrder.PLUGIN_ID, plugins.map((p) => p.id)],
    [PurchaseOrder.CREATED_AT, [monthStart, monthEnd], 'BETWEEN'],
  ]);

  const amounts = await Promise.all(
    orders.map(async ({ id: rowId, order_id: orderId, amount, state }) => {
      state = Number.parseInt(state, 10);
      if (state === PurchaseOrder.STATE_CANCELED) {
        return 0;
      }

      try {
        const updates = [];

        let calculatedAmount = 0;
        if (report) {
          const reportRows = report.filter((r) => r.Description === orderId);
          if (!reportRows.length) {
            calculatedAmount = amount * 0.65;
          } else {
            for (const row of reportRows) {
              calculatedAmount += Number.parseFloat(row['Amount (Merchant Currency)']);
            }
          }
        } else {
          calculatedAmount = amount;
        }

        if (calculatedAmount !== amount) {
          updates.push([PurchaseOrder.AMOUNT, calculatedAmount]);
        }

        if (updates.length) {
          await PurchaseOrder.update(updates, [PurchaseOrder.ID, rowId]);
        }

        return calculatedAmount;
      } catch (_error) {
        return 0;
      }
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
  const { monthStart, monthEnd } = getDate(year, month);
  const plugins = await Plugin.get([Plugin.ID], [Plugin.USER_ID, user.id]);
  const downloads = await Download.count([
    [Download.PLUGIN_ID, plugins.map((p) => p.id)],
    [Download.CREATED_AT, [monthStart, monthEnd], 'BETWEEN'],
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
 * @param {Array<object>} [report]
 */
async function total(year, month, user, report) {
  let earnings = 0;
  const paidPluginEarnings = await fromPaidPlugins(year, month, user, report);
  earnings = (1 - process.env.PERCENTAGE_CUT) * paidPluginEarnings;
  const freePluginDownloads = await fromDownloads(year, month, user);
  earnings += freePluginDownloads;
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
  let earnings = 0;
  const ids = [];
  const where = [
    [UserEarnings.USER_ID, user.id],
    [UserEarnings.PAYMENT_ID, null],
  ];

  // Exclude current or future months if year/month is passed
  if (year && month) {
    where.push(
      [UserEarnings.MONTH, month, '<'],
      [UserEarnings.YEAR, year],
      'OR',
      [UserEarnings.YEAR, year, '<']
    );
  }

  const unpaidEarnings = await UserEarnings.get(
    [UserEarnings.AMOUNT, UserEarnings.ID, UserEarnings.MONTH, UserEarnings.YEAR],
    where
  );

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

  // ✅ Fix: Adjust 'to' date so it doesn’t go beyond current date
  const now = moment();
  let toMoment = moment({ year: toYear, month: toMonth });

  if (toMoment.isSame(now, 'month') && toMoment.isSame(now, 'year')) {
    // If unpaid includes the current month, cap it at today
    toMoment = now.endOf('day');
  } else {
    // Otherwise use the full month end
    toMoment = toMoment.endOf('month');
  }

  return {
    ids,
    earnings,
    from: moment({ year: fromYear, month: fromMonth }).startOf('month'),
    to: toMoment,
  };
}

/**
 * Get date range for month
 * @param {number} year year
 * @param {number} month month (0-11)
 * @returns {[string, string]]}
 */
function getDate(year, month) {
  const date = moment({ month, year });
  const monthStart = date.startOf('month').format('YYYY-MM-DD');
  const monthEnd = date.endOf('month').format('YYYY-MM-DD');
  return { monthStart, monthEnd };
}

module.exports = {
  fromPaidPlugins,
  fromDownloads,
  unpaid,
  total,
};
