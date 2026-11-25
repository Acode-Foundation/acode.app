import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import moment from 'moment';

const HOLD = { userId: 7, year: 2026, month: 8 };
let db;
let reviews;
let calculator;
let reports;
let running;
let downloadReport;
let recalculate;

function load(file, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL(`../../server/${file}`, import.meta.url), 'utf8'), {
    module,
    console: { log() {}, error() {} },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-25T12:00:00Z') });
  db = new Database(':memory:');
  db.exec(`CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE user_earnings (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, payment_id INTEGER
    );
    CREATE TABLE plugin (id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE purchase_order (id INTEGER PRIMARY KEY, plugin_id INTEGER, provider TEXT, state TEXT, created_at DATETIME);
    INSERT INTO user VALUES (7, 'Example Developer');
    INSERT INTO plugin VALUES (70, 7), (80, 8);`);
  // Every finished month of this year has a Google order, so its reports are needed.
  for (let month = 1; month <= 10; month += 1) order(70, 'google_play', '0.0', `2026-${String(month).padStart(2, '0')}-10 10:00:00`);
  const Entity = load('entities/entity.js', { '../lib/db': db });
  const settings = load('entities/appConfig.js', { './entity': Entity, '../../constants.mjs': { PAYMENT_THRESHOLD: 10000 } });
  reviews = load('lib/earningsReview.js', { '../entities/appConfig': settings, '../entities/entity': Entity, 'node:crypto': crypto });
  calculator = { indexReport: vi.fn((rows) => rows), total: vi.fn().mockResolvedValue(321.5) };
  reports = { '2026-9': [{ id: 'september' }], '2026-8': [{ id: 'august' }] };
  downloadReport = vi.fn(async (year, month) => reports[`${year}-${month}`] || []);
  running = false;
  recalculate = load('lib/recalculateEarnings.js', {
    moment,
    './db': db,
    '../entities/user': { ID: 'id', get: async ([, id]) => db.prepare('SELECT * FROM user WHERE id = ?').all(id) },
    '../entities/userEarnings': { USER_ID: 'user_id', YEAR: 'year', MONTH: 'month', AMOUNT: 'amount' },
    './calcEarnings': calculator,
    './downloadGr': downloadReport,
    './earningsReview': reviews,
    '../entities/purchaseOrder': { PROVIDER_RAZORPAY: 'razorpay', STATE_PURCHASED: 0 },
    './updateEarnings': { isRunning: () => running },
  });
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
});

const run = (period = HOLD) => recalculate(period.userId, period.year, period.month);
const hold = (code, period = HOLD) => reviews.hold(period.userId, period.year, period.month, code);
const order = (...values) => db.prepare('INSERT INTO purchase_order (plugin_id, provider, state, created_at) VALUES (?, ?, ?, ?)').run(...values);
const noGoogleOrders = () => db.exec('DELETE FROM purchase_order');
const rows = () => db.prepare('SELECT amount, year, month, payment_id FROM user_earnings').all();
const codes = async () => (await reviews.list(7)).map(({ code }) => code);

it('saves a month that was never saved and releases only its calculation hold', async () => {
  await hold('INVALID_GOOGLE_REPORT');
  await hold('INVALID_GOOGLE_REPORT', { ...HOLD, month: 9 });
  expect(await run()).toEqual({ earnings: 321.5, remainingCodes: [] });
  expect(rows()).toEqual([{ amount: 321.5, year: 2026, month: 8, payment_id: null }]);
  expect((await reviews.list(7)).map(({ month }) => month)).toEqual([9]);
  // The held month and the one before it, as in the monthly run.
  expect(downloadReport.mock.calls).toEqual([
    [2026, 9],
    [2026, 8],
  ]);
  const [year, month, user, index] = calculator.total.mock.calls[0];
  expect([year, month, user.id]).toEqual([2026, 8, 7]);
  expect(index).toHaveLength(2);
});

it('recovers a month that the monthly run failed to save', async () => {
  await hold('EARNINGS_RUN_FAILED');
  expect(await run()).toEqual({ earnings: 321.5, remainingCodes: [] });
  expect(rows()).toHaveLength(1);
});

it('updates an unpaid month instead of adding a second row', async () => {
  db.exec('INSERT INTO user_earnings (user_id, year, month, amount) VALUES (7, 2026, 8, 10)');
  await hold('MISSING_RAZORPAY_INR');
  await run();
  expect(rows()).toEqual([{ amount: 321.5, year: 2026, month: 8, payment_id: null }]);
});

it('reads the reports of the previous year for January', async () => {
  const january = { userId: 7, year: 2026, month: 0 };
  reports = { '2026-1': [{}], '2025-12': [{}] };
  await hold('INVALID_GOOGLE_REPORT', january);
  await expect(run(january)).resolves.toMatchObject({ earnings: 321.5 });
});

it.each([
  ['2026-9', Object.assign([], { missing: true })],
  ['2026-9', []],
  ['2026-8', Object.assign([], { missing: true })],
])('keeps the hold when the %s report is missing, because orders would be estimated %#', async (month, report) => {
  reports[month] = report;
  await hold('INVALID_GOOGLE_REPORT');
  await expect(run()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('not available') });
  expect(calculator.total).not.toHaveBeenCalled();
  expect(rows()).toEqual([]);
  expect(await codes()).toEqual(['INVALID_GOOGLE_REPORT']);
});

it('keeps the month held when the calculation still fails', async () => {
  await hold('INVALID_GOOGLE_REPORT');
  const [before] = await reviews.snapshot(7, 2026, 8);
  calculator.total.mockRejectedValue(Object.assign(new Error('Invalid amount for GPA.1'), { code: 'INVALID_GOOGLE_REPORT' }));
  await expect(run()).rejects.toMatchObject({ statusCode: 409, message: 'Invalid amount for GPA.1' });
  expect(rows()).toEqual([]);
  const [after] = await reviews.snapshot(7, 2026, 8);
  expect(after.value).not.toBe(before.value); // An admin's earlier listing is outdated now.
  calculator.total.mockRejectedValue(new Error('Database unavailable'));
  await expect(run()).rejects.not.toHaveProperty('statusCode');
  expect(await codes()).toEqual(['INVALID_GOOGLE_REPORT']);
});

it('never changes a month that is part of a payout', async () => {
  db.exec('INSERT INTO user_earnings (user_id, year, month, amount, payment_id) VALUES (7, 2026, 8, 10, 55)');
  await hold('INVALID_GOOGLE_REPORT');
  await expect(run()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('part of a payout') });
  expect(calculator.total).not.toHaveBeenCalled(); // Calculating corrects order amounts.
  expect(rows()[0].amount).toBe(10);
});

it('does not choose between two rows of the same month', async () => {
  db.exec('INSERT INTO user_earnings (user_id, year, month, amount) VALUES (7, 2026, 8, 10), (7, 2026, 8, 20)');
  await hold('INVALID_GOOGLE_REPORT');
  await expect(run()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('more than once') });
  expect(rows().map(({ amount }) => amount)).toEqual([10, 20]);
});

it('does not overwrite an amount that needs a manual review, but saves a missing month and keeps that review', async () => {
  await hold('INVALID_GOOGLE_REPORT');
  await hold('GOOGLE_PURCHASE_REVIEW_REQUIRED');
  expect(await run()).toEqual({ earnings: 321.5, remainingCodes: ['GOOGLE_PURCHASE_REVIEW_REQUIRED'] });
  await hold('INVALID_GOOGLE_REPORT');
  calculator.total.mockResolvedValue(999);
  await expect(run()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('manual review') });
  expect(rows()).toEqual([{ amount: 321.5, year: 2026, month: 8, payment_id: null }]);
});

it.each([
  [
    'a payout starts',
    () => db.exec('INSERT INTO user_earnings (user_id, year, month, amount, payment_id) VALUES (7, 2026, 8, 10, 55)'),
    'part of a payout',
  ],
  [
    'the monthly run starts',
    () => {
      running = true;
    },
    'in progress',
  ],
])('does not save when %s during the calculation', async (_name, interrupt, message) => {
  await hold('INVALID_GOOGLE_REPORT');
  calculator.total.mockImplementation(async () => {
    interrupt();
    return 321.5;
  });
  await expect(run()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining(message) });
  expect(rows().some(({ amount }) => amount === 321.5)).toBe(false);
  expect(await codes()).toEqual(['INVALID_GOOGLE_REPORT']);
});

it('accepts a month before that had no sales', async () => {
  reports['2026-8'] = [];
  await hold('INVALID_GOOGLE_REPORT');
  await expect(run()).resolves.toMatchObject({ earnings: 321.5 });
});

it.each(['INVALID_GOOGLE_REPORT', 'GOOGLE_PURCHASE_REVIEW_REQUIRED'])('does not release a %s hold raised during the calculation', async (code) => {
  await hold('INVALID_GOOGLE_REPORT');
  calculator.total.mockImplementation(async () => {
    await hold(code);
    return 321.5;
  });
  await expect(run()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('changed') });
  expect(rows()).toEqual([]);
  expect(await codes()).toContain(code);
});

it('saves nothing when its hold cannot be released', async () => {
  await hold('INVALID_GOOGLE_REPORT');
  db.exec("CREATE TRIGGER fail BEFORE DELETE ON app_config BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  await expect(run()).rejects.toThrow('disk failure');
  expect(rows()).toEqual([]);
  expect(await codes()).toEqual(['INVALID_GOOGLE_REPORT']);
});

it.each(['MISSING_RAZORPAY_INR', 'EARNINGS_RUN_FAILED', 'INVALID_GOOGLE_REPORT'])(
  'recovers a %s month without Google orders even when no report was published',
  async (code) => {
    noGoogleOrders();
    order(70, 'razorpay', '0', '2026-09-10 10:00:00');
    for (const state of ['1', '1.0', '2']) order(70, 'google_play', state, '2026-09-10 10:00:00');
    order(80, 'google_play', '0', '2026-09-10 10:00:00'); // Another developer.
    order(70, 'google_play', '0', '2026-08-31 23:59:59');
    order(70, 'google_play', '0', '2026-10-01 00:00:00');
    reports = {};
    await hold(code);
    expect(await run()).toEqual({ earnings: 321.5, remainingCodes: [] });
    expect(downloadReport).not.toHaveBeenCalled();
    expect(calculator.total.mock.calls[0][3]).toHaveLength(0);
  },
);

it.each([
  ['google_play', '0', '2026-09-01 00:00:00'],
  ['google_play', '0.0', '2026-09-30 23:59:59'],
  [null, '0', '2026-09-10 10:00:00'],
])('needs the reports for an order of %s in state %s at %s', async (provider, state, createdAt) => {
  noGoogleOrders();
  order(70, provider, state, createdAt);
  reports = {};
  await hold('EARNINGS_RUN_FAILED');
  await expect(run()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('not available') });
  expect(await codes()).toEqual(['EARNINGS_RUN_FAILED']);
});

it('does not save when a Google order completes while the month is calculated without reports', async () => {
  noGoogleOrders();
  await hold('MISSING_RAZORPAY_INR');
  calculator.total.mockImplementation(async () => {
    order(70, 'google_play', '0', '2026-09-10 10:00:00');
    return 321.5;
  });
  await expect(run()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('completed') });
  expect(rows()).toEqual([]);
  expect(await codes()).toEqual(['MISSING_RAZORPAY_INR']);
});

it('saves one row when two admins recalculate at once', async () => {
  await hold('INVALID_GOOGLE_REPORT');
  const results = await Promise.allSettled([run(), run()]);
  expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(rows()).toHaveLength(1);
});

it('only accepts finished months that are held because of a calculation', async () => {
  await expect(run()).rejects.toMatchObject({ statusCode: 409 });
  await hold('GOOGLE_PURCHASE_REVIEW_REQUIRED');
  await expect(run()).rejects.toMatchObject({ statusCode: 409 });
  for (const month of [10, 11]) {
    await hold('INVALID_GOOGLE_REPORT', { ...HOLD, month });
    await expect(run({ ...HOLD, month })).rejects.toMatchObject({ statusCode: 400 });
  }
  await hold('INVALID_GOOGLE_REPORT', { ...HOLD, userId: 99 });
  await expect(run({ ...HOLD, userId: 99 })).rejects.toMatchObject({ statusCode: 404 });
  expect(downloadReport).not.toHaveBeenCalled();
});
