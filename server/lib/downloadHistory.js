const moment = require('moment');
const AppConfig = require('../entities/appConfig');
const Download = require('../entities/download');
const calcEarnings = require('./calcEarnings');
const db = require('./db');
const earningsReview = require('./earningsReview');

// Not exposed by the settings API, like the holds themselves.
function key(userId, year, month) {
  earningsReview.monthMarkers(userId, year, month); // Throws when the period is invalid.
  return `earnings-downloads:${userId}:${year}:${month}`;
}

/**
 * Whether the downloads of a whole month are still stored. The daily cleanup deletes the oldest days of all
 * plugins, so a row from the first day of the month, or an earlier one, means that nothing after it is gone.
 * Looks at the rows, because the retention period was shorter before: a recorded cutoff would claim months that
 * had already lost rows by then. A month without any earlier download counts as incomplete, to be safe.
 * @param {number} year
 * @param {number} month month (0-11)
 */
function isComplete(year, month) {
  const secondDay = moment({ year, month }).add(1, 'day').format('YYYY-MM-DD');
  const oldest = db.prepare(Download.OLDEST_QUERY).get();
  return Boolean(oldest && oldest.created_at < secondDay);
}

/**
 * The download earnings that were kept when the downloads of a held month were about to be deleted.
 * @param {number} userId
 * @param {number} year
 * @param {number} month month (0-11)
 * @returns {number|null}
 */
function keptEarnings(userId, year, month) {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key(userId, year, month));
  if (!row) return null;
  const amount = Number(row.value);
  if (!row.value.trim() || !Number.isFinite(amount) || amount < 0) {
    throw Object.assign(new Error('The kept download earnings of this month are damaged. Correct them in the database.'), {
      code: 'INVALID_KEPT_DOWNLOADS',
      key: key(userId, year, month),
      statusCode: 409,
    });
  }
  return amount;
}

/**
 * Keeps the download earnings of held months, so that they can be recalculated after the cleanup.
 * Call before deleting downloads.
 * @param {string} cutoff downloads before this date are about to be deleted
 */
async function keepHeldMonths(cutoff) {
  const { holds } = await earningsReview.listAll();
  for (const { userId, year, month } of holds) {
    const losesDownloads = moment({ year, month }).format('YYYY-MM-DD') < cutoff;
    // Counting a month that already lost some would keep too little.
    if (!losesDownloads || !isComplete(year, month)) continue;
    const earnings = await calcEarnings.fromDownloads(year, month, { id: userId });
    await AppConfig.insertOrIgnore([AppConfig.KEY, key(userId, year, month)], [AppConfig.VALUE, String(earnings)]);
  }
}

module.exports = { isComplete, keptEarnings, keepHeldMonths };
