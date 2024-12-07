const moment = require('moment');
const downloadReport = require('./downloadGr');
const UserEarnings = require('./entities/userEarnings');
const Payment = require('./entities/payment');
const Plugin = require('./entities/plugin');
const { sendNotification } = require('./helpers');
const calcEarnings = require('./calcEarnings');
const PaymentMethod = require('./entities/paymentMethod');

const now = moment();

// previous month (0-11) and year
const [currentYear, currentMonth] = previous(now.year(), now.month());

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
 * @param {number} year
 * @param {number} month month (0-11)
 */
module.exports = async function updateEarnings(year = currentYear, month = currentMonth) {
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
    users.forEach((u) => {
      if (u.payment_method_id) return;
      sendNotification(
        u.email,
        u.name,
        'Payment method not found',
        'Please add payment method to receive payment.',
      );
    });

    users.forEach(async (usr) => {
      const earnings = await calcEarnings.total(year, month, usr, report);

      const [row] = await UserEarnings.get([
        [UserEarnings.USER_ID, usr.id],
        [UserEarnings.YEAR, year],
        [UserEarnings.MONTH, month],
      ]);

      if (row) {
        await UserEarnings.update(
          [UserEarnings.AMOUNT, earnings],
          [UserEarnings.ID, row.id],
        );
      } else {
        await UserEarnings.insert(
          [UserEarnings.USER_ID, usr.id],
          [UserEarnings.YEAR, year],
          [UserEarnings.MONTH, month],
          [UserEarnings.AMOUNT, earnings],
        );
      }

      if (!usr.payment_method_id) return;

      const {
        ids: unpaidEarningsId,
        earnings: unpaid,
        from,
        to,
      } = await calcEarnings.unpaid(usr);
      // eslint-disable-next-line no-console
      console.log(`Earnings for ${usr.name} is ${unpaid}`);
      let { threshold } = usr;

      const [paymentMethod] = await PaymentMethod.get([PaymentMethod.ID, usr.payment_method_id]);
      if (paymentMethod.wallet_address) {
        threshold = Math.max(4000, threshold);
      } else if (paymentMethod.bank_swift_code) {
        threshold = Math.max(5000, threshold);
      }

      if (unpaid < threshold) return;
      // create integer random unique payment id
      const paymentId = Math.floor(Math.random() * 1000000000);

      await Payment.insert(
        [Payment.ID, paymentId],
        [Payment.USER_ID, usr.id],
        [Payment.AMOUNT, unpaid],
        [Payment.STATUS, Payment.STATUS_INITIATED],
        [Payment.PAYMENT_METHOD_ID, usr.payment_method_id],
        [Payment.DATE_FROM, from.format('YYYY-MM-DD')],
        [Payment.DATE_TO, to.format('YYYY-MM-DD')],
      );

      await UserEarnings.update(
        [UserEarnings.PAYMENT_ID, paymentId],
        [UserEarnings.ID, unpaidEarningsId],
      );
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(error);
    process.exit(1);
  }
};
