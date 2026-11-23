const { randomUUID } = require('node:crypto');
const AppConfig = require('../entities/appConfig');
const Entity = require('../entities/entity');

const HOLD_PREFIX = 'earnings-hold:';
const CALCULATION_CODES = Object.freeze(['INVALID_GOOGLE_REPORT', 'MISSING_RAZORPAY_INR']);
// Set by the first monthly run that excludes pending Google orders. user_earnings
// rows created at or after it cannot include a pending order's estimate.
const PENDING_EXCLUDED_SINCE = 'earnings-pending-excluded-since';

// Separate keys preserve independent months without a schema change or a shared
// JSON read/modify/write. These internal keys are not exposed by the settings API.
function prefix(userId) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new Error('Invalid earnings review user.');
  return `${HOLD_PREFIX}${Number(userId)}:`;
}

function key(userId, year, month) {
  if (!Number.isSafeInteger(year) || year < 1970 || !Number.isInteger(month) || month < 0 || month > 11) {
    throw new Error('Invalid earnings review month.');
  }
  return `${prefix(userId)}${year}:${month}`;
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

async function hold(userId, year, month, code) {
  if (typeof code !== 'string' || !/^[A-Z_]+$/.test(code)) throw new Error('Invalid earnings review reason.');
  // Keep independent reasons, but refresh the revision for every new review event.
  // A second purchase raising the same code must invalidate an earlier admin GET.
  await Entity.execSql(
    `INSERT INTO app_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [`${key(userId, year, month)}:${code}`, JSON.stringify({ code, revision: randomUUID() })],
    AppConfig,
  );
}

async function snapshot(userId, year, month) {
  const base = key(userId, year, month);
  const rows = await AppConfig.for('internal').get(
    [AppConfig.KEY, AppConfig.VALUE],
    [[AppConfig.KEY, base], 'OR', [AppConfig.KEY, `${base}:*`, 'GLOB']],
  );
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
  const base = key(userId, year, month);
  const keys = [base, ...CALCULATION_CODES.map((code) => `${base}:${code}`)];
  // Match both legacy code values and revisioned values; never remove manual reasons.
  await Entity.execSql(
    `DELETE FROM app_config WHERE key IN (${keys.map(() => '?').join(', ')})
     AND (CASE WHEN json_valid(value) THEN json_extract(value, '$.code') ELSE value END)
       IN (${CALCULATION_CODES.map(() => '?').join(', ')})`,
    [...keys, ...CALCULATION_CODES],
    AppConfig,
  );
}

async function assertRecalculable(userId, year, month) {
  rejectHolds((await list(userId)).filter((hold) => hold.year === year && hold.month === month && !CALCULATION_CODES.includes(hold.code)));
}

async function list(userId) {
  const rows = await AppConfig.for('internal').get([AppConfig.KEY, AppConfig.VALUE], [AppConfig.KEY, `${prefix(userId)}*`, 'GLOB']);
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
    if (!months.has(period)) months.set(period, { userId, year, month, codes: [], snapshot: [] });
    const entry = months.get(period);
    if (!entry.codes.includes(code)) entry.codes.push(code);
    entry.snapshot.push(row);
  }
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
  hold,
  snapshot,
  clear,
  clearCalculated,
  assertRecalculable,
  list,
  listAll,
  assertClear,
  markPendingExcluded,
  pendingExcludedSince,
};
