const crypto = require('node:crypto');
const moment = require('moment');
const Plugin = require('../entities/plugin');
const Payment = require('../entities/payment');
const downloadReport = require('./downloadGr');
const calcEarnings = require('./calcEarnings');
const UserEarnings = require('../entities/userEarnings');
const PaymentMethod = require('../entities/paymentMethod');
const sendEmail = require('./sendEmail');
const AppConfig = require('../entities/appConfig');
const earningsReview = require('./earningsReview');

const args = process.argv.slice(2);
const yearArg = args[0];
const monthArg = args[1];

if (yearArg && monthArg) {
  (async () => {
    const path = require('node:path');
    const { config } = require('dotenv');
    const setAuth = require('../lib/gapis');
    config({ path: path.resolve(__dirname, '../.env') });
    await setAuth();

    await updateEarnings(+yearArg, +monthArg);
  })().catch(() => {
    // updateEarnings has already logged the error.
    process.exitCode = 1;
  });
}

/**
 * Get previous month and year
 * @param {number} year Year
 * @param {number} month Month (0-11)
 */
function previous(year, month) {
  if (month === 0) {
    return [year - 1, 11];
  }
  return [year, month - 1];
}

/**
 * Update earnings for given month and year
 * @param {number} year YYYY year (default: current year)
 * @param {number} month month (0-11)
 */
async function updateEarnings(year, month) {
  if (year === undefined || month === undefined) {
    const now = moment();
    [year, month] = previous(now.year(), now.month());
  }
  try {
    const [previousYear, previousMonth] = previous(year, month);
    const report = await downloadReport(year, month + 1);
    const reportOfPreviousMonth = await downloadReport(previousYear, previousMonth + 1);

    // Include adjacent report entries for the same order. Invalid entries from either
    // month intentionally hold its developer rather than risk a partial settlement.
    const len = reportOfPreviousMonth.length;
    for (let i = 0; i < len; i++) {
      report.push(reportOfPreviousMonth[i]);
    }

    // Mark before any row is written: rows saved from here on exclude pending orders.
    await earningsReview.markPendingExcluded(moment.utc().format('YYYY-MM-DD HH:mm:ss'));
    const users = await Plugin.getUsersWithPlugin();
    const indexedReport = calcEarnings.indexReport(report);
    const heldUsers = [];
    const holdReasons = [];
    const threshold = await AppConfig.getPaymentThreshold();
    // filter user with not paypal email or not bank account and send email to them
    // send email to user with no paypal email or no bank account

    for (const user of users) {
      const { payment_method_id, email, name } = user;
      let earnings;
      try {
        await earningsReview.assertRecalculable(user.id, year, month);
        earnings = await calcEarnings.total(year, month, user, indexedReport);
      } catch (error) {
        if (earningsReview.CALCULATION_CODES.includes(error.code)) {
          await earningsReview.hold(user.id, year, month, error.code);
        } else if (error.code !== 'EARNINGS_UNDER_REVIEW') {
          throw error;
        }
        console.error(error.message);
        heldUsers.push(user.id);
        holdReasons.push(error.message);
        continue;
      }

      const [row] = await UserEarnings.get([
        [UserEarnings.USER_ID, user.id],
        [UserEarnings.YEAR, year],
        [UserEarnings.MONTH, month],
      ]);

      if (row) {
        await UserEarnings.update([UserEarnings.AMOUNT, earnings], [UserEarnings.ID, row.id]);
      } else {
        await UserEarnings.insert(
          [UserEarnings.USER_ID, user.id],
          [UserEarnings.YEAR, year],
          [UserEarnings.MONTH, month],
          [UserEarnings.AMOUNT, earnings],
        );
      }

      // Clear only after this month's result has been saved. Other held months
      // still make the aggregate incomplete and must prevent payout initiation.
      await earningsReview.clearCalculated(user.id, year, month);
      let unpaidEarnings;
      try {
        if (payment_method_id) {
          // unpaid() checks for holds itself. Catch that check here too, so a
          // hold found during balance loading does not skip later developers.
          unpaidEarnings = await calcEarnings.unpaid(user);
        } else {
          await earningsReview.assertClear(user.id);
        }
      } catch (error) {
        if (error.code !== 'EARNINGS_UNDER_REVIEW') throw error;
        heldUsers.push(user.id);
        holdReasons.push(error.message);
        continue;
      }

      if (!payment_method_id) continue;

      const { ids: unpaidEarningsId, earnings: unpaid, from, to } = unpaidEarnings;
      console.log(`Earnings for ${user.name} is ${unpaid}`);

      if (unpaid < threshold) continue;

      const [paymentMethod] = await PaymentMethod.get([PaymentMethod.ID, payment_method_id]);
      if (!paymentMethod) {
        sendEmail(
          email,
          name,
          'Payment method not found',
          'Your earnings have reached the payment threshold. Please add a bank account to receive your payments.',
        ).catch((err) => console.error(`Failed to send email to ${email}:`, err));
        continue;
      }
      if (paymentMethod.paypal_email || paymentMethod.wallet_address) {
        sendEmail(
          email,
          name,
          'Payment method not supported',
          'Your earnings have reached the payment threshold, but PayPal and cryptocurrency payment methods are no longer supported. Please add a bank account to receive your payments.',
        ).catch((err) => console.error(`Failed to send email to ${email}:`, err));
        continue;
      }

      const paymentId = crypto.randomInt(1, 2147483647);

      await Payment.insert(
        [Payment.ID, paymentId],
        [Payment.USER_ID, user.id],
        [Payment.AMOUNT, unpaid],
        [Payment.STATUS, Payment.STATUS_INITIATED],
        [Payment.PAYMENT_METHOD_ID, user.payment_method_id],
        [Payment.DATE_FROM, from.format('YYYY-MM-DD')],
        [Payment.DATE_TO, to.format('YYYY-MM-DD')],
      );

      await UserEarnings.update([UserEarnings.PAYMENT_ID, paymentId], [UserEarnings.ID, unpaidEarningsId]);
    }
    if (heldUsers.length) {
      throw new Error(
        `Earnings completed with holds for users: ${heldUsers.join(', ')}. Other users completed; review held users and payment links before a targeted retry. ${holdReasons.join(' ')}`,
      );
    }
  } catch (error) {
    // Let the cron wrapper send its existing failure alert without terminating the server.
    console.error(error);
    throw error;
  }
}

module.exports = updateEarnings;
