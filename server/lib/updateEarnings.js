const crypto = require('node:crypto');
const moment = require('moment');
const Plugin = require('../entities/plugin');
const Payment = require('../entities/payment');
const downloadReport = require('./downloadGr');
const calcEarnings = require('./calcEarnings');
const UserEarnings = require('../entities/userEarnings');
const PaymentMethod = require('../entities/paymentMethod');
const sendEmail = require('./sendEmail');
const { PAYMENT_THRESHOLD } = require('../../constants.mjs');

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
  })();
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

    // push previous month report to current month report using for loop
    const len = reportOfPreviousMonth.length;
    for (let i = 0; i < len; i++) {
      report.push(reportOfPreviousMonth[i]);
    }

    const users = await Plugin.getUsersWithPlugin();
    // filter user with not paypal email or not bank account and send email to them
    // send email to user with no paypal email or no bank account

    for (const user of users) {
      const { payment_method_id, email, name } = user;
      const earnings = await calcEarnings.total(year, month, user, report);
      const threshold = PAYMENT_THRESHOLD;

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

      if (!payment_method_id) continue;

      const { ids: unpaidEarningsId, earnings: unpaid, from, to } = await calcEarnings.unpaid(user);
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
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(error);
    process.exit(1);
  }
}

module.exports = updateEarnings;
