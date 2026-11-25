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
const { PAYMENT_METHOD_LABELS, PAYPAL, getPaymentMethodType, isPaymentMethodTypeAvailable } = require('../../shared/paymentMethods');

let activeRuns = 0;

if (require.main === module) runFromCommandLine(process.argv[2], process.argv[3]);

/**
 * Runs a finished month again: node server/lib/updateEarnings <year> <month (0-11)>
 */
async function runFromCommandLine(yearArg, monthArg) {
  try {
    const path = require('node:path');
    const { config } = require('dotenv');
    config({ path: path.resolve(__dirname, '../.env') });
    const year = Number(yearArg);
    const month = Number(monthArg);
    if (!yearArg || !monthArg || !Number.isInteger(year) || year < 1970 || !Number.isInteger(month) || month < 0 || month > 11) {
      throw new Error('Usage: updateEarnings <year> <month (0-11)>');
    }
    if (!moment({ year, month }).isBefore(moment().startOf('month'))) throw new Error('Only a finished month can be run.');
    // A rerun rewrites the month of every developer, without the downloads that were deleted. It does not use
    // the kept earnings of held months, because other developers have none; recalculate those months instead.
    if (!require('./downloadHistory').isComplete(year, month)) {
      throw new Error('Some download records of this month have already been deleted. Nothing was changed.');
    }
    await require('../lib/gapis')();
    // It logs its own errors.
    await updateEarnings(year, month).catch(() => {
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
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
  activeRuns += 1;
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
    const failedUsers = [];
    const failures = [];
    const threshold = await AppConfig.getPaymentThreshold();

    for (const user of users) {
      const progress = { saved: false };
      try {
        await processUser(user, progress);
      } catch (error) {
        // Do not let one developer block the others. A payout is created completely or not at all.
        if (progress.saved && error.code === 'EARNINGS_UNDER_REVIEW') {
          // Held after the balance was calculated. The month is saved, so the next run pays it.
          heldUsers.push(user.id);
          holdReasons.push(error.message);
          continue;
        }

        console.error('Earnings run failed for user %s:', user.id, error);
        failedUsers.push(user.id);
        failures.push(`User ${user.id}: ${error.message}`);
        if (!progress.saved) await holdUnsavedMonth(user.id);
      }
    }

    const problems = [];
    if (heldUsers.length) {
      problems.push(
        `Earnings completed with holds for users: ${heldUsers.join(', ')}. Other users completed; review held users and payment links before a targeted retry. ${holdReasons.join(' ')}`,
      );
    }
    if (failedUsers.length) {
      problems.push(`Earnings failed unexpectedly for users: ${failedUsers.join(', ')}. ${summarize(failures)}`);
    }
    if (problems.length) throw new Error(problems.join(' '));

    async function processUser(user, progress) {
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
        return;
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

      progress.saved = true;
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
        return;
      }

      if (!payment_method_id) return;

      const { ids: earningIds, earnings: unpaid, from, to } = unpaidEarnings;
      console.log(`Earnings for ${user.name} is ${unpaid}`);

      if (unpaid < threshold) return;

      const [paymentMethod] = await PaymentMethod.get([PaymentMethod.ID, payment_method_id]);
      if (!paymentMethod) {
        sendEmail(
          email,
          name,
          'Payment method not found',
          'Your earnings have reached the payment threshold. Please add a payment method to receive your payments.',
        ).catch((err) => console.error(`Failed to send email to ${email}:`, err));
        return;
      }

      const methodType = getPaymentMethodType(paymentMethod);
      const paypalEnabled = methodType === PAYPAL && (await AppConfig.isPayPalEnabled());
      if (!isPaymentMethodTypeAvailable(methodType, { paypalEnabled })) {
        sendEmail(
          email,
          name,
          'Payment method not available',
          `Your earnings have reached the payment threshold, but payouts to your default payment method (${PAYMENT_METHOD_LABELS[methodType] || methodType}) are currently unavailable. Please set another payment method as your default to receive your payments.`,
        ).catch((err) => console.error(`Failed to send email to ${email}:`, err));
        return;
      }

      const paymentId = crypto.randomInt(1, 2147483647);

      Payment.initiate({
        id: paymentId,
        userId: user.id,
        amount: unpaid,
        paymentMethodId: payment_method_id,
        dateFrom: from.format('YYYY-MM-DD'),
        dateTo: to.format('YYYY-MM-DD'),
        earningIds,
      });
    }

    // Later runs only calculate their own month. Without a hold they would pay this developer
    // without the month that could not be saved.
    async function holdUnsavedMonth(userId) {
      try {
        await earningsReview.hold(userId, year, month, earningsReview.RUN_FAILED);
      } catch (error) {
        console.error('Failed to hold earnings of user %s:', userId, error);
        failures.push(`User ${userId} could NOT be held; run ${year}-${month + 1} again before the next payout.`);
      }
    }
  } catch (error) {
    // Let the cron wrapper send its existing failure alert without terminating the server.
    console.error(error);
    throw error;
  } finally {
    activeRuns -= 1;
  }
}

/** Keeps the alert readable when everything fails for the same reason. */
function summarize(messages, limit = 20) {
  const rest = messages.length - limit;
  // The most important messages are about developers that could not be held.
  const urgent = messages.filter((message) => message.includes('could NOT be held'));
  const others = messages.filter((message) => !urgent.includes(message));
  return [...urgent, ...others].slice(0, limit).join(' ') + (rest > 0 ? ` And ${rest} more, see the server log.` : '');
}

/** Whether a run of this process is calculating and paying earnings right now. */
updateEarnings.isRunning = () => activeRuns > 0;

module.exports = updateEarnings;
