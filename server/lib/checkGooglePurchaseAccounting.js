const moment = require('moment');
const Plugin = require('../entities/plugin');
const UserEarnings = require('../entities/userEarnings');

module.exports = async function checkGooglePurchaseAccounting(order) {
  const date = order.created_at ? moment.utc(order.created_at) : moment.invalid();
  const [plugin] = await Plugin.get([Plugin.USER_ID], [Plugin.ID, order.plugin_id]);
  let recorded;
  if (date.isValid() && plugin?.user_id != null) {
    [recorded] = await UserEarnings.for('internal').get(
      [UserEarnings.ID],
      [
        [UserEarnings.USER_ID, plugin.user_id],
        [`CAST(${UserEarnings.YEAR} AS INTEGER)`, date.year()],
        [`CAST(${UserEarnings.MONTH} AS INTEGER)`, date.month()],
      ],
    );
  }
  // Monthly totals cannot prove whether a legacy pending order was already counted.
  // Hold even unpaid recorded months: their balance could otherwise count the sale twice.
  if (!date.isValid() || plugin?.user_id == null || recorded) {
    const error = new Error(`Purchase requires an accounting review. Please contact Acode support. Reference: ${order.id}.`);
    error.code = 'GOOGLE_PURCHASE_REVIEW_REQUIRED';
    throw error;
  }
};
