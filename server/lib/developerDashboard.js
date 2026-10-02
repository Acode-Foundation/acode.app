const moment = require('moment');
const Entity = require('../entities/entity');
const Download = require('../entities/download');

const DAILY_RANGE = 30;
const MONTHLY_RANGE = 12;
// Downloads are pruned by the daily cleanup cron. Keep enough for the dashboard's
// current + previous 30-day windows and for the previous month's earnings, which
// are calculated on the 16th.
const DOWNLOAD_RETENTION_DAYS = DAILY_RANGE * 2 + 2;

// Downloads are inserted in time order, so the lowest id is the oldest row we still have.
const OLDEST_DOWNLOAD_QUERY = 'SELECT created_at FROM download ORDER BY id LIMIT 1';

const PLUGIN_STATS_QUERY = `SELECT
  p.id AS id,
  p.name AS name,
  IFNULL(p.price, 0) AS price,
  p.status AS status,
  p.version AS version,
  p.status_change_message AS status_message,
  COALESCE(p.package_updated_at, p.created_at) AS updated_at,
  CAST(IFNULL(p.downloads, 0) AS INTEGER) AS downloads,
  IFNULL(p.votes_up, 0) AS votes_up,
  IFNULL(p.votes_down, 0) AS votes_down,
  COALESCE(SUM(CASE WHEN d.created_at >= ? THEN 1 ELSE 0 END), 0) AS recent,
  COALESCE(SUM(CASE WHEN d.created_at < ? THEN 1 ELSE 0 END), 0) AS previous
FROM plugin p
LEFT JOIN download d ON d.plugin_id = p.id AND d.created_at >= ?
WHERE p.user_id = ? AND p.status != 3
GROUP BY p.id
ORDER BY recent DESC, downloads DESC`;

const DAILY_DOWNLOADS_QUERY = `SELECT
  DATE(d.created_at) AS day,
  COUNT(*) AS count
FROM download d
JOIN plugin p ON p.id = d.plugin_id
WHERE p.user_id = ? AND p.status != 3 AND d.created_at >= ?
GROUP BY day`;

const MONTHLY_EARNINGS_QUERY = `SELECT year, month, amount, payment_id
FROM user_earnings
WHERE user_id = ? AND (year > ? OR (year = ? AND month >= ?))`;

/**
 * Build developer dashboard data for a user.
 * @param {object} user
 * @param {object} [deps]
 * @param {(sql: string, values: any[]) => Promise<object[]>} [deps.executeQuery]
 * @param {(year: number, month: number, user: object) => Promise<number>} [deps.estimateEarnings]
 * @param {moment.Moment} [deps.now]
 */
async function getDeveloperDashboard(user, { executeQuery = executeDashboardQuery, estimateEarnings, now = moment() } = {}) {
  const today = now.clone().startOf('day');
  const rangeStart = today.clone().subtract(DAILY_RANGE - 1, 'days');
  const previousStart = rangeStart.clone().subtract(DAILY_RANGE, 'days');
  const rangeStartSql = rangeStart.format('YYYY-MM-DD HH:mm:ss');
  const previousStartSql = previousStart.format('YYYY-MM-DD HH:mm:ss');

  const [pluginRows, dailyRows, earningRows, [oldestDownload]] = await Promise.all([
    executeQuery(PLUGIN_STATS_QUERY, [rangeStartSql, rangeStartSql, previousStartSql, user.id]),
    executeQuery(DAILY_DOWNLOADS_QUERY, [user.id, rangeStartSql]),
    getEarningRows(user, now, executeQuery),
    executeQuery(OLDEST_DOWNLOAD_QUERY, []),
  ]);

  // If older downloads were pruned before the previous window started, the
  // comparison would be against missing data, so report it as unavailable.
  const hasPreviousWindow = Boolean(oldestDownload) && oldestDownload.created_at <= previousStartSql;

  const plugins = pluginRows.map((row) => ({
    id: row.id,
    name: row.name,
    price: Number(row.price) || 0,
    status: Number(row.status),
    version: row.version,
    statusMessage: row.status_message || '',
    updatedAt: row.updated_at,
    downloads: Number(row.downloads) || 0,
    votesUp: Number(row.votes_up) || 0,
    votesDown: Number(row.votes_down) || 0,
    recent: Number(row.recent) || 0,
    previous: Number(row.previous) || 0,
  }));

  const dailyMap = new Map(dailyRows.map((row) => [row.day, Number(row.count) || 0]));
  const daily = [];
  for (let i = 0; i < DAILY_RANGE; i++) {
    const day = rangeStart.clone().add(i, 'days').format('YYYY-MM-DD');
    daily.push({ date: day, count: dailyMap.get(day) || 0 });
  }

  const monthly = await buildMonthlyEarnings(user, earningRows, now, estimateEarnings);

  return {
    range: DAILY_RANGE,
    totals: {
      plugins: plugins.length,
      paidPlugins: plugins.filter((p) => p.price > 0).length,
      downloads: plugins.reduce((sum, p) => sum + p.downloads, 0),
      recentDownloads: plugins.reduce((sum, p) => sum + p.recent, 0),
      previousDownloads: hasPreviousWindow ? plugins.reduce((sum, p) => sum + p.previous, 0) : null,
      votesUp: plugins.reduce((sum, p) => sum + p.votesUp, 0),
      votesDown: plugins.reduce((sum, p) => sum + p.votesDown, 0),
      lifetimeEarnings: Math.round(monthly.lifetime * 100) / 100,
    },
    daily,
    monthly: monthly.rows,
    plugins,
  };
}

function getEarningRows(user, now, executeQuery) {
  const start = now
    .clone()
    .startOf('month')
    .subtract(MONTHLY_RANGE - 1, 'months');
  return Promise.all([
    executeQuery(MONTHLY_EARNINGS_QUERY, [user.id, start.year(), start.year(), start.month()]),
    executeQuery('SELECT COALESCE(SUM(amount), 0) AS total FROM user_earnings WHERE user_id = ?', [user.id]),
  ]);
}

async function buildMonthlyEarnings(user, [rows, [lifetimeRow]], now, estimateEarnings) {
  const thisMonth = now.clone().startOf('month');
  const lastMonth = thisMonth.clone().subtract(1, 'month');
  const rowMap = new Map(rows.map((row) => [`${row.year}-${row.month}`, row]));
  let lifetime = Number(lifetimeRow?.total) || 0;
  const result = [];

  for (let i = MONTHLY_RANGE - 1; i >= 0; i--) {
    const date = thisMonth.clone().subtract(i, 'months');
    const year = date.year();
    const month = date.month();
    const row = rowMap.get(`${year}-${month}`);
    const storedAmount = row ? Number(row.amount) || 0 : 0;
    let amount = storedAmount;
    let estimated = false;

    // Current month (and last month until it is finalized) are estimates,
    // unless the month has already been paid out.
    const isSettled = Boolean(row?.payment_id);
    const isCurrent = date.isSame(thisMonth, 'month');
    const isPendingLast = !row && date.isSame(lastMonth, 'month');
    if ((isCurrent || isPendingLast) && !isSettled && estimateEarnings) {
      amount = Number(await estimateEarnings(year, month, user)) || 0;
      estimated = true;
      lifetime += amount - storedAmount;
    }

    result.push({ year, month, amount: Math.round(amount * 100) / 100, estimated, paid: isSettled });
  }

  return { rows: result, lifetime };
}

function executeDashboardQuery(sql, values) {
  return Entity.execSql(sql, values, Download);
}

module.exports = { getDeveloperDashboard, DAILY_RANGE, MONTHLY_RANGE, DOWNLOAD_RETENTION_DAYS };
