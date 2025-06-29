const moment = require('moment');
const Plugin = require('../entities/plugin');
const Payment = require('../entities/payment');
const downloadReport = require('./downloadGr');
const calcEarnings = require('./calcEarnings');
const { sendNotification } = require('../lib/helpers');
const UserEarnings = require('../entities/userEarnings');
const PaymentMethod = require('../entities/paymentMethod');

const now = moment();

// previous month (0-11) and year
const [currentYear, currentMonth] = previous(now.year(), now.month());

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
async function updateEarnings(year = currentYear, month = currentMonth) {
  try {
    const [previousYear, previousMonth] = previous(year, month);
    const report = await downloadReport(year, month + 1);
    const reportOfPreviousMonth = await downloadReport(previousYear, previousMonth + 1);

    console.log(reportOfPreviousMonth);

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
      let { threshold } = user;

      if (!payment_method_id) {
        sendNotification(email, name, 'Payment method not found', 'Please add payment method to receive payment.');
      }

      const earnings = await calcEarnings.total(year, month, user, report);

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

      const [paymentMethod] = await PaymentMethod.get([PaymentMethod.ID, user.payment_method_id]);
      if (paymentMethod.wallet_address) {
        threshold = Math.max(4000, threshold);
      } else if (paymentMethod.bank_swift_code) {
        threshold = Math.max(5000, threshold);
      }

      if (unpaid < threshold) continue;
      // create integer random unique payment id
      const paymentId = Math.floor(Math.random() * 1000000000);

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
