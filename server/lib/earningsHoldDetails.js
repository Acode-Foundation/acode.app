const Entity = require('../entities/entity');
const Payment = require('../entities/payment');
const User = require('../entities/user');
const UserEarnings = require('../entities/userEarnings');

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
     WHERE e.user_id IN (SELECT value FROM json_each(?))`,
    [ids],
    UserEarnings,
  );

  return holds.map((hold) => {
    const user = users.find((row) => row.id === hold.userId);
    const rows = earnings.filter((row) => row.user_id === hold.userId);
    const saved = rows.find((row) => Number(row.year) === hold.year && Number(row.month) === hold.month);
    return {
      ...hold,
      user: user ? { name: user.name, email: user.email } : null,
      // null when the month was never saved, so its earnings are not part of any payout yet.
      savedEarnings: saved ? saved.amount : null,
      payout: saved?.payment_id == null ? null : { id: saved.payment_id, status: PAYOUT_STATUS[saved.status] ?? 'unknown' },
      unpaidBalance: Math.round(rows.filter((row) => row.payment_id == null).reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100,
    };
  });
};
