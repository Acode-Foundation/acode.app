const moment = require('moment');
const db = require('./db');
const User = require('../entities/user');
const calcEarnings = require('./calcEarnings');
const downloadReport = require('./downloadGr');
const earningsReview = require('./earningsReview');
const PurchaseOrder = require('../entities/purchaseOrder');
const updateEarnings = require('./updateEarnings');

function refuse(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * Calculates one held month of one developer again and saves it. Never starts a payout: the next monthly
 * run pays the saved amount once the developer has no holds left.
 * @param {number} userId
 * @param {number} year
 * @param {number} month month (0-11)
 * @returns {Promise<{earnings: number, remainingCodes: string[]}>}
 */
module.exports = async function recalculateEarnings(userId, year, month) {
  if (!moment({ year, month }).isBefore(moment().startOf('month'))) throw refuse('Only a finished month can be recalculated.', 400);

  // Validates the markers too, so a damaged one is never cleared.
  const markers = await earningsReview.snapshot(userId, year, month);
  const codes = await heldCodes(userId, year, month);
  if (!codes.some(isCalculation)) throw refuse('This month is not held because of a calculation problem.');

  const [user] = await User.get([User.ID, userId]);
  if (!user) throw refuse('User not found', 404);

  const hasManualHold = codes.some((code) => !isCalculation(code));
  // Refuse before calculating, because calculating also corrects the amounts of orders.
  assertCanSave(findRow(userId, year, month), hasManualHold);

  // Razorpay orders and downloads do not depend on Google's reports.
  const needsReports = hasGoogleOrders(userId, year, month);
  const reports = needsReports ? await loadReports(year, month) : [];

  let earnings;
  try {
    earnings = await calcEarnings.total(year, month, user, calcEarnings.indexReport(reports));
  } catch (error) {
    if (!isCalculation(error.code)) throw error;
    await earningsReview.hold(userId, year, month, error.code);
    throw refuse(error.message);
  }

  save(userId, year, month, earnings, { hasManualHold, markers, needsReports });
  return { earnings, remainingCodes: await heldCodes(userId, year, month) };
};

/**
 * The same two reports as the monthly run. An order without a report entry falls back to an estimate,
 * so a missing report would release the hold on guessed numbers. The month before may have had no sales.
 */
async function loadReports(year, month) {
  const previous = moment({ year, month }).subtract(1, 'month');
  const report = await downloadReport(year, month + 1);
  const previousReport = await downloadReport(previous.year(), previous.month() + 1);
  if (!report.length || previousReport.missing) {
    throw refuse('This month has Google orders, but the Google earnings reports needed to check them are not available.');
  }
  return [...report, ...previousReport];
}

// The same orders that calcEarnings pays. Older databases store the state as text, such as '0.0'.
function hasGoogleOrders(userId, year, month) {
  const start = moment({ year, month });
  const order = db
    .prepare(
      `SELECT 1 FROM purchase_order
       WHERE plugin_id IN (SELECT id FROM plugin WHERE user_id = ?) AND created_at >= ? AND created_at < ?
         AND provider IS NOT ? AND CAST(state AS REAL) = ?
       LIMIT 1`,
    )
    .get(
      userId,
      start.format('YYYY-MM-DD'),
      start.clone().add(1, 'month').format('YYYY-MM-DD'),
      PurchaseOrder.PROVIDER_RAZORPAY,
      PurchaseOrder.STATE_PURCHASED,
    );
  return Boolean(order);
}

function isCalculation(code) {
  return earningsReview.CALCULATION_CODES.includes(code);
}

async function heldCodes(userId, year, month) {
  const holds = await earningsReview.list(userId);
  return holds.filter((hold) => hold.year === year && hold.month === month).map((hold) => hold.code);
}

function findRow(userId, year, month) {
  const rows = db.prepare('SELECT id, payment_id FROM user_earnings WHERE user_id = ? AND year = ? AND month = ?').all(userId, year, month);
  if (rows.length > 1) throw refuse('This month was saved more than once. Remove the wrong row before recalculating it.');
  return rows[0];
}

function assertCanSave(row, hasManualHold) {
  if (row && row.payment_id !== null) throw refuse('This month is already part of a payout, so it cannot be recalculated.');
  // The saved amount may be the result of that review.
  if (row && hasManualHold) throw refuse('This month also needs a manual review. Finish that before recalculating it.');
}

// One transaction, so that no run, admin or process can save, pay, hold or release the month in between.
function save(userId, year, month, earnings, { hasManualHold, markers, needsReports }) {
  db.transaction(() => {
    if (updateEarnings.isRunning()) throw refuse('The monthly earnings run is in progress. Try again when it has finished.');
    // A hold raised during the calculation may make its result unsafe to save.
    if (!sameMarkers(markers, currentMarkers(userId, year, month))) throw refuse('The holds of this month changed. Review them and try again.');

    // A pending Google order may have completed since, and was then estimated.
    if (!needsReports && hasGoogleOrders(userId, year, month)) throw refuse('A Google order of this month completed. Try again.');

    const row = findRow(userId, year, month);
    assertCanSave(row, hasManualHold);
    if (row) db.prepare('UPDATE user_earnings SET amount = ? WHERE id = ?').run(earnings, row.id);
    else db.prepare('INSERT INTO user_earnings (user_id, year, month, amount) VALUES (?, ?, ?, ?)').run(userId, year, month, earnings);

    const { sql, values } = earningsReview.clearCalculatedStatement(userId, year, month);
    db.prepare(sql).run(...values);
  }).immediate();
}

function currentMarkers(userId, year, month) {
  const { base, pattern } = earningsReview.monthMarkers(userId, year, month);
  return db.prepare('SELECT key, value FROM app_config WHERE key = ? OR key GLOB ?').all(base, pattern);
}

function sameMarkers(before, now) {
  return before.length === now.length && before.every((marker) => now.some(({ key, value }) => key === marker.key && value === marker.value));
}
