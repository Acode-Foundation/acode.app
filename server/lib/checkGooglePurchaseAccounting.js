const moment = require('moment');
const Plugin = require('../entities/plugin');
const UserEarnings = require('../entities/userEarnings');
const earningsReview = require('./earningsReview');

const REVIEW_CODE = 'GOOGLE_PURCHASE_REVIEW_REQUIRED';

/**
 * Runs before a pending Google purchase is completed. Completion moves the order
 * into the current month, so check whether its original month may already have
 * counted it. An ambiguous month holds the developer's earnings for review
 * without rejecting a validated purchase; invalid dates or storage errors still fail.
 * @returns {Promise<{userId: number, year: number, month: number} | null>} the month held for review
 */
module.exports = async function checkGooglePurchaseAccounting(order) {
  const date = order.created_at ? moment.utc(order.created_at) : moment.invalid();
  if (!date.isValid()) {
    const error = new Error(`Purchase requires an accounting review. Please contact Acode support. Reference: ${order.id}.`);
    error.code = REVIEW_CODE;
    throw error;
  }

  const [plugin] = await Plugin.get([Plugin.USER_ID], [Plugin.ID, order.plugin_id]);
  if (plugin?.user_id == null) {
    console.error('Google purchase %s has no developer attribution; review plugin %s.', order.id, order.plugin_id);
    return null;
  }

  const year = date.year();
  const month = date.month();
  const recorded = await UserEarnings.for('internal').get(
    [UserEarnings.ID, UserEarnings.CREATED_AT],
    [
      [UserEarnings.USER_ID, plugin.user_id],
      [`CAST(${UserEarnings.YEAR} AS INTEGER)`, year],
      [`CAST(${UserEarnings.MONTH} AS INTEGER)`, month],
    ],
  );
  if (!recorded.length) return null;

  // Rows first created after pending orders were excluded never counted this order.
  // updated_at is not used: marking a legacy row paid also bumps it.
  const excludedSince = await earningsReview.pendingExcludedSince();
  const cutoff = parseTimestamp(excludedSince);
  // Every matching row must be safe, including legacy duplicates and unknown dates.
  if (
    cutoff.isValid() &&
    recorded.every((row) => {
      const created = parseTimestamp(row.created_at);
      return created.isValid() && !created.isBefore(cutoff);
    })
  )
    return null;

  // Legacy totals cannot prove whether this pending order was counted. Hold the
  // original month (even if already paid) so its developer is reviewed before
  // any further payout could count the sale twice.
  await earningsReview.hold(plugin.user_id, year, month, REVIEW_CODE);
  console.error('Google purchase %s requires earnings review for user %s, %s-%s.', order.id, plugin.user_id, year, month + 1);
  return { userId: plugin.user_id, year, month };
};

function parseTimestamp(value) {
  return typeof value === 'string' ? moment.utc(value, ['YYYY-MM-DD HH:mm:ss', moment.ISO_8601], true) : moment.invalid();
}
