const Entity = require('../entities/entity');
const Payment = require('../entities/payment');
const Plugin = require('../entities/plugin');
const User = require('../entities/user');
const UserEarnings = require('../entities/userEarnings');
const downloadHistory = require('./downloadHistory');

const PAYOUT_STATUS = {
  [Payment.STATUS_NONE]: 'none',
  [Payment.STATUS_PAID]: 'paid',
  [Payment.STATUS_INITIATED]: 'initiated',
};

/**
 * Adds what an admin needs to decide whether a hold can be cleared. The snapshot is left untouched,
 * because clearing compares it with the stored markers.
 * @param {Array<{userId: number, year: number, month: number}>} holds
 */
module.exports = async function earningsHoldDetails(holds) {
  const userIds = [...new Set(holds.map((hold) => hold.userId))];
  if (!userIds.length) return [];

  const ids = JSON.stringify(userIds);
  const users = await Entity.execSql('SELECT id, name, email FROM user WHERE id IN (SELECT value FROM json_each(?))', [ids], User);
  const earnings = await Entity.execSql(
    `SELECT e.user_id, e.year, e.month, e.amount, e.payment_id, p.status
     FROM user_earnings e
     LEFT JOIN payment p ON p.id = e.payment_id
     WHERE e.user_id IN (SELECT value FROM json_each(?))
     ORDER BY e.id`,
    [ids],
    UserEarnings,
  );
  const pluginIds = [...new Set(holds.flatMap((hold) => (hold.orders || []).map((order) => order.pluginId)).filter((id) => id != null))];
  const plugins = pluginIds.length
    ? await Entity.execSql('SELECT id, name FROM plugin WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify(pluginIds)], Plugin)
    : [];
  const pluginNames = new Map(plugins.map((row) => [String(row.id), row.name]));

  return holds.map((hold) => {
    const user = users.find((row) => row.id === hold.userId);
    const rows = earnings.filter((row) => row.user_id === hold.userId);
    return {
      ...hold,
      orders: (hold.orders || []).map((order) => ({
        ...order,
        pluginName: pluginNames.get(String(order.pluginId)) ?? null,
      })),
      user: user ? { name: user.name, email: user.email } : null,
      // Empty when the month was never saved. Databases from before migration 020 may have saved it more than once.
      saved: rows
        .filter((row) => Number(row.year) === hold.year && Number(row.month) === hold.month)
        .map((row) => ({
          amount: row.amount,
          payout: row.payment_id == null ? null : { id: row.payment_id, status: PAYOUT_STATUS[row.status] ?? 'unknown' },
        })),
      // Without its downloads the month can no longer be recalculated.
      ...downloadState(hold),
      unpaidBalance: Math.round(rows.filter((row) => row.payment_id == null).reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100,
    };
  });
};

function downloadState({ userId, year, month }) {
  try {
    return { hasDownloads: downloadHistory.isComplete(year, month) || downloadHistory.keptEarnings(userId, year, month) !== null };
  } catch (error) {
    // One damaged amount must not hide the holds of everyone.
    if (error.code !== 'INVALID_KEPT_DOWNLOADS') throw error;
    return { hasDownloads: false, damagedDownloads: error.key };
  }
}
