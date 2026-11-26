const { randomUUID } = require('node:crypto');
const AppConfig = require('../entities/appConfig');
const Entity = require('../entities/entity');

const HOLD_PREFIX = 'earnings-hold:';
// The monthly run failed before it could save the month.
const RUN_FAILED = 'EARNINGS_RUN_FAILED';
// Reasons that a successful calculation of the month resolves.
const CALCULATION_CODES = Object.freeze(['INVALID_GOOGLE_REPORT', 'MISSING_RAZORPAY_INR', RUN_FAILED]);
// Set by the first monthly run that excludes pending Google orders. user_earnings
// rows created at or after it cannot include a pending order's estimate.
const PENDING_EXCLUDED_SINCE = 'earnings-pending-excluded-since';

// Separate keys preserve independent months without a schema change or a shared
// JSON read/modify/write. These internal keys are not exposed by the settings API.
function prefix(userId) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new Error('Invalid earnings review user.');
  return `${HOLD_PREFIX}${Number(userId)}:`;
}

/** GLOB pattern of every marker that holds this developer, damaged ones included. */
function holdPattern(userId) {
  return `${prefix(userId)}*`;
}

function key(userId, year, month) {
  if (!Number.isSafeInteger(year) || year < 1970 || !Number.isInteger(month) || month < 0 || month > 11) {
    throw new Error('Invalid earnings review month.');
  }
  return `${prefix(userId)}${year}:${month}`;
}

/** Keys of the markers of one month: the legacy one and one per reason. */
function monthMarkers(userId, year, month) {
  const base = key(userId, year, month);
  return { base, pattern: `${base}:*` };
}

function parse(row) {
  try {
    const [userId, year, month, reason] = row.key.slice(HOLD_PREFIX.length).split(':');
    // Older markers stored only the code; new ones include a review revision.
    const value = row.value.startsWith('{') ? JSON.parse(row.value) : { code: row.value };
    if (typeof value.code !== 'string' || !/^[A-Z_]+$/.test(value.code)) throw new Error('Invalid earnings review reason.');
    const base = key(Number(userId), Number(year), Number(month));
    if (row.key !== (reason ? `${base}:${value.code}` : base)) throw new Error('Invalid earnings review marker.');
    return { userId: Number(userId), year: Number(year), month: Number(month), code: value.code };
  } catch {
    // Corrupt metadata must block this developer, never silently release funds.
    throw Object.assign(new Error('Invalid earnings review marker. Manual review is required.'), {
      code: 'EARNINGS_UNDER_REVIEW',
      statusCode: 409,
    });
  }
}

function uniqueHolds(rows) {
  const holds = rows.map(parse);
  return [...new Map(holds.map((hold) => [`${hold.userId}:${hold.year}:${hold.month}:${hold.code}`, hold])).values()];
}

/**
 * @param {object} [order] The order that raised the review, kept so an admin can find it.
 * @param {number} order.id purchase_order.id
 * @param {string} [order.orderId] The provider's order ID.
 * @param {string} [order.pluginId] plugin.id, the plugin's package ID.
 * @param {string} [order.createdAt] The accounting date before the review, UTC.
 */
async function hold(userId, year, month, code, order) {
  if (typeof code !== 'string' || !/^[A-Z_]+$/.test(code)) throw new Error('Invalid earnings review reason.');
  const value = { code, revision: randomUUID() };
  if (order) {
    // purchase_order.plugin_id has INTEGER affinity, so a numeric-looking package ID arrives as a number.
    const text = (field) => (field == null || field === '' ? null : String(field));
    value.orders = [{ id: order.id, orderId: text(order.orderId), pluginId: text(order.pluginId), createdAt: order.createdAt ?? null }];
  }
  // Keep independent reasons, but refresh the revision for every new review event.
  // A second purchase raising the same code must invalidate an earlier admin GET.
  // Orders accumulate in one statement, so concurrent holds of one month keep every order.
  await Entity.execSql(
    `INSERT INTO app_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = json_set(excluded.value, '$.orders', json((
       SELECT json_group_array(json(item)) FROM (
         SELECT value AS item FROM json_each(CASE WHEN json_valid(app_config.value) THEN app_config.value ELSE '{}' END, '$.orders')
         UNION
         SELECT value AS item FROM json_each(excluded.value, '$.orders')
       )
     )))`,
    [`${key(userId, year, month)}:${code}`, JSON.stringify(value)],
    AppConfig,
  );
}

/** The orders recorded on a marker. Markers from before orders were recorded have none. */
function orders(row) {
  try {
    const list = JSON.parse(row.value).orders;
    if (!Array.isArray(list)) return [];
    // Markers may be edited by hand; keep only what the admin page can show safely.
    return list
      .filter((order) => order && typeof order === 'object' && Number.isSafeInteger(order.id))
      .map((order) => ({
        id: order.id,
        orderId: typeof order.orderId === 'string' && order.orderId ? order.orderId : null,
        pluginId: typeof order.pluginId === 'string' && order.pluginId ? order.pluginId : null,
        createdAt: typeof order.createdAt === 'string' && order.createdAt ? order.createdAt : null,
      }));
  } catch {
    return [];
  }
}

async function snapshot(userId, year, month) {
  const { base, pattern } = monthMarkers(userId, year, month);
  const rows = await AppConfig.for('internal').get([AppConfig.KEY, AppConfig.VALUE], [[AppConfig.KEY, base], 'OR', [AppConfig.KEY, pattern, 'GLOB']]);
  rows.forEach(parse);
  return rows;
}

async function clear(userId, year, month, expected) {
  const base = key(userId, year, month);
  if (!Array.isArray(expected) || !expected.length) {
    throw Object.assign(new Error('A reviewed snapshot is required.'), { statusCode: 400 });
  }
  try {
    for (const row of expected) {
      const hold = parse(row);
      if (hold.userId !== Number(userId) || hold.year !== year || hold.month !== month) throw new Error('Wrong earnings review period.');
    }
  } catch {
    throw Object.assign(new Error('Invalid earnings review snapshot.'), { statusCode: 400 });
  }
  // Materialize the current set before deleting anything. A new, removed or
  // changed reason invalidates the entire snapshot, including legacy markers.
  const matches = expected.map(() => '(key = ? AND value = ?)').join(' OR ');
  const removed = await Entity.execSql(
    `WITH current_holds AS MATERIALIZED (
      SELECT key, value FROM app_config WHERE key = ? OR key GLOB ?
    )
    DELETE FROM app_config
    WHERE (key = ? OR key GLOB ?)
      AND (SELECT COUNT(*) FROM current_holds) = ?
      AND NOT EXISTS (SELECT 1 FROM current_holds WHERE NOT (${matches}))
    RETURNING key, value`,
    [base, `${base}:*`, base, `${base}:*`, expected.length, ...expected.flatMap((row) => [row.key, row.value])],
    AppConfig,
  );
  if (removed.length !== expected.length) {
    throw Object.assign(new Error('Earnings holds changed. Reload and review them before clearing.'), { statusCode: 409 });
  }
  return removed.map(parse);
}

async function clearCalculated(userId, year, month) {
  const { sql, values } = clearCalculatedStatement(userId, year, month);
  await Entity.execSql(sql, values, AppConfig);
}

/** For callers that have to clear the holds in the transaction that saves the month. */
function clearCalculatedStatement(userId, year, month) {
  const base = key(userId, year, month);
  const keys = [base, ...CALCULATION_CODES.map((code) => `${base}:${code}`)];
  // Match both legacy code values and revisioned values; never remove manual reasons.
  return {
    sql: `DELETE FROM app_config WHERE key IN (${keys.map(() => '?').join(', ')})
     AND (CASE WHEN json_valid(value) THEN json_extract(value, '$.code') ELSE value END)
       IN (${CALCULATION_CODES.map(() => '?').join(', ')})`,
    values: [...keys, ...CALCULATION_CODES],
  };
}

async function assertRecalculable(userId, year, month) {
  rejectHolds((await list(userId)).filter((hold) => hold.year === year && hold.month === month && !CALCULATION_CODES.includes(hold.code)));
}

async function list(userId) {
  const rows = await AppConfig.for('internal').get([AppConfig.KEY, AppConfig.VALUE], [AppConfig.KEY, holdPattern(userId), 'GLOB']);
  return uniqueHolds(rows).map(({ year, month, code }) => ({ year, month, code }));
}

async function listAll() {
  const rows = await AppConfig.for('internal').get([AppConfig.KEY, AppConfig.VALUE], [AppConfig.KEY, `${HOLD_PREFIX}*`, 'GLOB']);
  const months = new Map();
  const invalidMarkers = [];
  for (const row of rows) {
    let hold;
    try {
      hold = parse(row);
    } catch (error) {
      if (error.code !== 'EARNINGS_UNDER_REVIEW') throw error;
      invalidMarkers.push({ ...row, code: 'INVALID_MARKER' });
      continue;
    }
    const { userId, year, month, code } = hold;
    const period = key(userId, year, month);
    if (!months.has(period)) months.set(period, { userId, year, month, codes: [], orders: [], snapshot: [] });
    const entry = months.get(period);
    if (!entry.codes.includes(code)) entry.codes.push(code);
    for (const order of orders(row)) {
      // The stored list dedupes by JSON text, so one order may be stored twice with fields filled in later.
      const known = entry.orders.find((item) => item.id === order.id);
      if (!known) entry.orders.push({ ...order, code });
      else for (const field of ['orderId', 'pluginId', 'createdAt']) known[field] ??= order[field];
    }
    entry.snapshot.push(row);
  }
  for (const entry of months.values()) entry.orders.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id - b.id);
  return { holds: [...months.values()], invalidMarkers };
}

async function assertClear(userId, year, month) {
  const holds = (await list(userId)).filter((hold) => year === undefined || (hold.year === year && hold.month === month));
  rejectHolds(holds);
}

function rejectHolds(holds) {
  if (!holds.length) return;
  const periods = [...new Set(holds.map(({ year, month }) => `${year}-${String(month + 1).padStart(2, '0')}`))].join(', ');
  throw Object.assign(new Error(`Earnings under review for ${periods}. Totals are unavailable until the review is completed.`), {
    code: 'EARNINGS_UNDER_REVIEW',
    statusCode: 409,
  });
}

/**
 * Records when monthly earnings started excluding pending orders, once.
 * @param {string} timestamp UTC 'YYYY-MM-DD HH:mm:ss', the same format as CURRENT_TIMESTAMP
 */
async function markPendingExcluded(timestamp) {
  await AppConfig.insertOrIgnore([AppConfig.KEY, PENDING_EXCLUDED_SINCE], [AppConfig.VALUE, timestamp]);
}

async function pendingExcludedSince() {
  return AppConfig.getValue(PENDING_EXCLUDED_SINCE);
}

module.exports = {
  CALCULATION_CODES,
  RUN_FAILED,
  holdPattern,
  hold,
  snapshot,
  clear,
  clearCalculated,
  clearCalculatedStatement,
  monthMarkers,
  assertRecalculable,
  list,
  listAll,
  assertClear,
  markPendingExcluded,
  pendingExcludedSince,
};
