const AppConfig = require('../entities/appConfig');

// Separate keys preserve independent months without a schema change or a shared
// JSON read/modify/write. These internal keys are not exposed by the settings API.
function prefix(userId) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new Error('Invalid earnings review user.');
  return `earnings-hold:${Number(userId)}:`;
}

function key(userId, year, month) {
  if (!Number.isSafeInteger(year) || year < 1970 || !Number.isInteger(month) || month < 0 || month > 11) {
    throw new Error('Invalid earnings review month.');
  }
  return `${prefix(userId)}${year}:${month}`;
}

async function hold(userId, year, month, code) {
  await AppConfig.setValue(key(userId, year, month), code);
}

async function clear(userId, year, month) {
  await AppConfig.delete([AppConfig.KEY, key(userId, year, month)]);
}

async function list(userId) {
  const start = prefix(userId);
  const rows = await AppConfig.for('internal').get([AppConfig.KEY, AppConfig.VALUE], [AppConfig.KEY, `${start}%`, 'LIKE']);
  return rows.map((row) => {
    const [year, month] = row.key.slice(start.length).split(':').map(Number);
    if (row.key !== key(userId, year, month)) throw new Error('Invalid earnings review marker.');
    return { year, month, code: row.value };
  });
}

async function assertClear(userId, year, month) {
  const holds = (await list(userId)).filter((hold) => year === undefined || (hold.year === year && hold.month === month));
  if (!holds.length) return;
  const periods = holds.map(({ year, month }) => `${year}-${String(month + 1).padStart(2, '0')}`).join(', ');
  throw Object.assign(new Error(`Earnings under review for ${periods}. Totals are unavailable until the review is completed.`), {
    code: 'EARNINGS_UNDER_REVIEW',
    statusCode: 409,
  });
}

module.exports = { hold, clear, list, assertClear };
