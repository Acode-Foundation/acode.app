import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import moment from 'moment';
import * as paymentMethods from '../../shared/paymentMethods';

let db;
let settings;
let reviews;
let earnings;
let calculate;
let run;
let payment;
let dashboard;
let unpaid;
let calculator;
let orders;
let downloadReport;
let Entity;
let users;
const user = { id: 7, payment_method_id: 1 };

function load(file, dependencies) {
  const filename = path.resolve(import.meta.dirname, '../../server', file);
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      module,
      process: { argv: [] },
      console: { log() {}, error() {} },
      require(name) {
        if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
        return dependencies[name];
      },
    },
    { filename },
  );
  return module.exports;
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  Entity = load('entities/entity.js', { '../lib/db': db });
  settings = load('entities/appConfig.js', { './entity': Entity, '../../constants.mjs': { PAYMENT_THRESHOLD: 10000 } });
  await settings.setValue('payment_threshold', 10000);
  reviews = load('lib/earningsReview.js', { '../entities/appConfig': settings, '../entities/entity': Entity, 'node:crypto': crypto });
  earnings = load('entities/userEarnings.js', { './entity': Entity });
  orders = {
    ID: 'id',
    AMOUNT: 'amount',
    STATE_PURCHASED: 0,
    PROVIDER_RAZORPAY: 'razorpay',
    for() {
      return this;
    },
    get: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  };
  calculator = load('lib/calcEarnings.js', {
    moment,
    './earningsReview': reviews,
    '../entities/userEarnings': earnings,
    '../entities/plugin': {
      for() {
        return this;
      },
      get: async () => [{ id: 'fixture.plugin' }],
    },
    '../entities/download': { count: async () => 0 },
    '../entities/purchaseOrder': orders,
    '../entities/razorpayOrder': {},
  });
  unpaid = () => calculator.unpaid(user);
  calculate = vi.fn().mockRejectedValue(Object.assign(new Error('Missing original INR'), { code: 'MISSING_RAZORPAY_INR' }));
  users = [user];
  payment = load('entities/payment.js', {
    './entity': Entity,
    '../lib/db': db,
    '../lib/maskedEmail': load('lib/maskedEmail.js', {}),
    '../lib/earningsReview': reviews,
  });
  vi.spyOn(payment, 'initiate');
  downloadReport = vi.fn().mockResolvedValue([]);
  run = load('lib/updateEarnings.js', {
    moment,
    'node:crypto': { randomInt: () => 123 },
    '../entities/plugin': { getUsersWithPlugin: async () => users },
    '../entities/payment': payment,
    '../entities/paymentMethod': { ID: 'id', get: async () => [{ id: 1 }] },
    '../entities/userEarnings': earnings,
    '../entities/appConfig': settings,
    './earningsReview': reviews,
    './downloadGr': downloadReport,
    '../../shared/paymentMethods': paymentMethods,
    './sendEmail': vi.fn(),
    './calcEarnings': { ...calculator, total: calculate },
  });
  const { getDeveloperDashboard } = load('lib/developerDashboard.js', {
    moment,
    './earningsReview': reviews,
    '../entities/entity': {},
    '../entities/download': { OLDEST_QUERY: 'SELECT created_at FROM download ORDER BY id LIMIT 1' },
    '../entities/pluginScan': {},
    '../../shared/verification': { RECENT_DOWNLOAD_DAYS: 30 },
  });
  dashboard = (date) =>
    getDeveloperDashboard(user, {
      now: moment(date),
      estimateEarnings: async () => 0,
      executeQuery: async (sql, values) => {
        if (sql.includes('FROM user_earnings')) return db.prepare(sql).all(...values);
        return sql.includes('FROM plugin p') ? [{ id: 'fixture.plugin', price: 100, downloads: 42 }] : [];
      },
    });
});
afterEach(() => db.close());

it.each(['MISSING_RAZORPAY_INR', 'INVALID_GOOGLE_REPORT'])('keeps %s visible across month/year rollover until a successful retry', async (code) => {
  calculate.mockRejectedValue(Object.assign(new Error('Needs review'), { code }));
  await expect(run(2026, 9)).rejects.toThrow('holds for users: 7');
  expect(db.prepare('SELECT * FROM user_earnings').all()).toEqual([]);
  // A newly loaded helper sees the persisted marker, without process-local state.
  const reloaded = load('lib/earningsReview.js', { '../entities/appConfig': settings, '../entities/entity': Entity, 'node:crypto': crypto });
  await expect(reloaded.assertClear(7, 2026, 9)).rejects.toMatchObject({ statusCode: 409 });
  for (const date of ['2026-11-20', '2026-12-01', '2027-01-01']) {
    const data = await dashboard(date);
    expect(data.monthly.find((row) => row.year === 2026 && row.month === 9)).toMatchObject({ amount: null, reviewRequired: true });
    expect(data.totals).toMatchObject({ lifetimeEarnings: null, downloads: 42 });
    await expect(unpaid()).rejects.toMatchObject({ code: 'EARNINGS_UNDER_REVIEW', statusCode: 409 });
  }
  calculate.mockResolvedValue(70);
  await run(2026, 9);
  await expect(reloaded.list(7)).resolves.toEqual([]);
  expect((await dashboard('2027-01-01')).monthly.find((row) => row.year === 2026 && row.month === 9)).toMatchObject({
    amount: 70,
    reviewRequired: false,
  });
  await expect(unpaid()).resolves.toMatchObject({ earnings: 70 });
});

it('keeps lifetime and unpaid totals unavailable even after a hold leaves the 12-month chart', async () => {
  await reviews.hold(7, 2024, 0, 'INVALID_GOOGLE_REPORT');
  const data = await dashboard('2026-12-01');
  expect(data.monthly.every((row) => !row.reviewRequired)).toBe(true);
  expect(data.totals.lifetimeEarnings).toBeNull();
  await expect(unpaid()).rejects.toThrow('2024-01');
});

it('preserves other users/months and prevents payouts while any older month remains held', async () => {
  await settings.setValue('payment_threshold', 1);
  await reviews.hold(7, 2026, 9, 'MISSING_RAZORPAY_INR');
  await reviews.hold(7, 2026, 10, 'INVALID_GOOGLE_REPORT');
  await reviews.hold(70, 2026, 9, 'INVALID_GOOGLE_REPORT');
  calculate.mockResolvedValue(70);
  await expect(run(2026, 10)).rejects.toThrow('2026-10');
  expect(payment.initiate).not.toHaveBeenCalled();
  await expect(reviews.list(7)).resolves.toEqual([{ year: 2026, month: 9, code: 'MISSING_RAZORPAY_INR' }]);
  await expect(reviews.assertClear(70)).rejects.toThrow('2026-10');
  await run(2026, 9);
  expect(payment.initiate).toHaveBeenCalledOnce();
  expect(payment.initiate.mock.calls[0][0]).toMatchObject({ amount: 140 });
  await expect(reviews.assertClear(70)).rejects.toThrow('2026-10');
});

it('does not clear a marker when recalculation succeeds but the monthly write fails', async () => {
  await reviews.hold(7, 2026, 9, 'MISSING_RAZORPAY_INR');
  calculate.mockResolvedValue(70);
  vi.spyOn(earnings, 'insert').mockRejectedValue(new Error('Fixture write failure'));
  await expect(run(2026, 9)).rejects.toThrow('Fixture write failure');
  await expect(reviews.assertClear(7, 2026, 9)).rejects.toMatchObject({ statusCode: 409 });
  expect((await reviews.list(7)).map(({ code }) => code).sort()).toEqual(['EARNINGS_RUN_FAILED', 'MISSING_RAZORPAY_INR']);
  expect(payment.initiate).not.toHaveBeenCalled();
});

it('reads all held months without the API pagination limit and leaves settings alone', async () => {
  for (let i = 0; i < 101; i++) await reviews.hold(7, 2000 + Math.floor(i / 12), i % 12, 'INVALID_GOOGLE_REPORT');
  expect(await reviews.list(7)).toHaveLength(101);
  await reviews.clear(7, 2000, 0, await reviews.snapshot(7, 2000, 0));
  expect(await reviews.list(7)).toHaveLength(100);
  expect(await settings.getPaymentThreshold()).toBe(10000);
});

it('preserves the monthly amount and hold when a Google amount write fails, then recovers on retry', async () => {
  await settings.setValue('payment_threshold', 1);
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  await earnings.insert([earnings.USER_ID, 7], [earnings.YEAR, 2026], [earnings.MONTH, 9], [earnings.AMOUNT, 50]);
  orders.get.mockResolvedValue([{ id: 1, order_id: 'GPA.fixture', provider: 'google_play', state: 0, amount: 100 }]);
  downloadReport.mockImplementation(async (_year, month) =>
    month === 10 ? [{ Description: 'GPA.fixture', 'Amount (Merchant Currency)': 200 }] : [],
  );
  calculate.mockImplementation(calculator.total);
  const failure = new Error('Fixture Google amount write failure');
  orders.update.mockRejectedValueOnce(failure);

  await expect(run(2026, 9)).rejects.toThrow('User 7: Fixture Google amount write failure');
  expect((await reviews.list(7)).map(({ code }) => code)).toContain('EARNINGS_RUN_FAILED');
  expect(db.prepare('SELECT amount, payment_id FROM user_earnings').all()).toEqual([{ amount: 50, payment_id: null }]);
  await expect(reviews.assertClear(7, 2026, 9)).rejects.toMatchObject({ statusCode: 409 });
  expect(payment.initiate).not.toHaveBeenCalled();

  await run(2026, 9);
  expect(orders.update).toHaveBeenLastCalledWith(['amount', 200], ['id', 1]);
  await expect(reviews.list(7)).resolves.toEqual([]);
  expect(db.prepare('SELECT amount, payment_id FROM user_earnings').all()).toEqual([{ amount: 170, payment_id: 123 }]);
  expect(payment.initiate).toHaveBeenCalledOnce();
  expect(payment.initiate.mock.calls[0][0]).toMatchObject({ amount: 170 });
});

it('lists holds per developer and across developers for admins', async () => {
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  await reviews.hold(17, 2026, 8, 'GOOGLE_PURCHASE_REVIEW_REQUIRED');
  await reviews.markPendingExcluded('2026-11-16 00:00:00');
  await expect(reviews.list(7)).resolves.toEqual([{ year: 2026, month: 9, code: 'INVALID_GOOGLE_REPORT' }]);
  const all = (await reviews.listAll()).holds;
  expect(all).toHaveLength(2);
  expect(all).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ userId: 7, year: 2026, month: 9, codes: ['INVALID_GOOGLE_REPORT'] }),
      expect.objectContaining({ userId: 17, year: 2026, month: 8, codes: ['GOOGLE_PURCHASE_REVIEW_REQUIRED'] }),
    ]),
  );
});

it('records the pending-exclusion cutoff only once', async () => {
  await reviews.markPendingExcluded('2026-11-16 00:00:00');
  await reviews.markPendingExcluded('2026-12-16 00:00:00');
  await expect(reviews.pendingExcludedSince()).resolves.toBe('2026-11-16 00:00:00');
});

it('atomically preserves concurrent hold reasons and the first cutoff', async () => {
  await Promise.all([
    reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT'),
    reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT'),
    reviews.hold(7, 2026, 9, 'GOOGLE_PURCHASE_REVIEW_REQUIRED'),
  ]);
  expect((await reviews.list(7)).map((hold) => hold.code).sort()).toEqual(['GOOGLE_PURCHASE_REVIEW_REQUIRED', 'INVALID_GOOGLE_REPORT']);
  await Promise.all([reviews.markPendingExcluded('2026-11-16 00:00:00'), reviews.markPendingExcluded('2026-11-16 00:00:01')]);
  await expect(reviews.pendingExcludedSince()).resolves.toBe('2026-11-16 00:00:00');
});

it.each([null, 42])('does not recalculate or release a manually held month (payment %s)', async (paymentId) => {
  // Existing unsuffixed markers must remain valid without a migration.
  await settings.setValue('earnings-hold:7:2026:9', 'GOOGLE_PURCHASE_REVIEW_REQUIRED');
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  db.prepare('INSERT INTO user_earnings (user_id, year, month, amount, payment_id) VALUES (7, 2026, 9, 70, ?)').run(paymentId);
  db.prepare('INSERT INTO user_earnings (user_id, year, month, amount) VALUES (7, 2026, 10, 12000)').run();
  calculate.mockResolvedValue(0);
  await expect(run(2026, 9)).rejects.toThrow('holds for users: 7');
  expect(calculate).not.toHaveBeenCalled();
  expect(db.prepare('SELECT amount, payment_id FROM user_earnings WHERE month = 9').get()).toEqual({ amount: 70, payment_id: paymentId });
  expect(payment.initiate).not.toHaveBeenCalled();
  expect(await reviews.list(7)).toHaveLength(2);
});

it('automatic clearing removes calculation reasons but preserves legacy and new manual holds', async () => {
  await settings.setValue('earnings-hold:7:2026:9', 'GOOGLE_PURCHASE_REVIEW_REQUIRED');
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  await reviews.hold(7, 2026, 9, 'MISSING_RAZORPAY_INR');
  await reviews.hold(7, 2026, 9, 'GOOGLE_PURCHASE_REVIEW_REQUIRED');
  await reviews.hold(7, 2026, 10, 'INVALID_GOOGLE_REPORT');
  await reviews.hold(70, 2026, 9, 'INVALID_GOOGLE_REPORT');
  await reviews.clearCalculated(7, 2026, 9);
  expect((await reviews.list(7)).filter((hold) => hold.month === 9).map((hold) => hold.code)).toEqual(['GOOGLE_PURCHASE_REVIEW_REQUIRED']);
  expect(await reviews.snapshot(7, 2026, 9)).toHaveLength(2);
  await reviews.clear(7, 2026, 9, await reviews.snapshot(7, 2026, 9));
  await expect(reviews.list(7)).resolves.toEqual([{ year: 2026, month: 10, code: 'INVALID_GOOGLE_REPORT' }]);
  expect(await reviews.list(70)).toHaveLength(1);
  await settings.setValue('earnings-hold:7:2026:8', 'INVALID_GOOGLE_REPORT');
  await reviews.clearCalculated(7, 2026, 8);
  expect((await reviews.list(7)).some((hold) => hold.month === 8)).toBe(false);
});

it('rejects a stale admin snapshot without deleting old or newly arrived holds', async () => {
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  const before = await reviews.snapshot(7, 2026, 9);
  await reviews.hold(7, 2026, 9, 'GOOGLE_PURCHASE_REVIEW_REQUIRED');
  await expect(reviews.clear(7, 2026, 9, before)).rejects.toMatchObject({ statusCode: 409 });
  expect(await reviews.snapshot(7, 2026, 9)).toHaveLength(2);
  const refreshed = await reviews.snapshot(7, 2026, 9);
  const removed = await reviews.clear(7, 2026, 9, refreshed);
  expect(removed.map((hold) => hold.code).sort()).toEqual(['GOOGLE_PURCHASE_REVIEW_REQUIRED', 'INVALID_GOOGLE_REPORT']);
  await expect(reviews.list(7)).resolves.toEqual([]);
});

it('rejects a changed legacy reason even when the marker count is unchanged', async () => {
  await settings.setValue('earnings-hold:7:2026:9', 'INVALID_GOOGLE_REPORT');
  const before = await reviews.snapshot(7, 2026, 9);
  await settings.setValue('earnings-hold:7:2026:9', 'GOOGLE_PURCHASE_REVIEW_REQUIRED');
  await expect(reviews.clear(7, 2026, 9, before)).rejects.toMatchObject({ statusCode: 409 });
  await expect(reviews.list(7)).resolves.toEqual([{ year: 2026, month: 9, code: 'GOOGLE_PURCHASE_REVIEW_REQUIRED' }]);
});

it('deduplicates listings without discarding raw markers needed for atomic clearing', async () => {
  await settings.setValue('earnings-hold:7:2026:9', 'INVALID_GOOGLE_REPORT');
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  await reviews.hold(70, 2026, 9, 'INVALID_GOOGLE_REPORT');
  await expect(reviews.list(7)).resolves.toEqual([{ year: 2026, month: 9, code: 'INVALID_GOOGLE_REPORT' }]);
  expect((await reviews.listAll()).holds).toHaveLength(2);
  const before = await reviews.snapshot(7, 2026, 9);
  expect(before).toHaveLength(2);
  expect(await reviews.clear(7, 2026, 9, before)).toHaveLength(2);
  await expect(reviews.list(7)).resolves.toEqual([]);
  expect(await reviews.list(70)).toHaveLength(1);
});

it.each([
  ['earnings-hold:7:2026:9:INVALID_GOOGLE_REPORT', 'MISSING_RAZORPAY_INR'],
  ['earnings-hold:7:2026:12', 'INVALID_GOOGLE_REPORT'],
])('isolates malformed marker %s while preserving the affected developer hold', async (marker, reason) => {
  await settings.setValue(marker, reason);
  users = [user, { id: 8 }];
  calculate.mockResolvedValue(70);
  await expect(unpaid()).rejects.toMatchObject({ code: 'EARNINGS_UNDER_REVIEW', statusCode: 409 });
  await expect(run(2026, 9)).rejects.toThrow('holds for users: 7');
  expect(calculate.mock.calls.map((args) => args[2].id)).toEqual([8]);
  expect(db.prepare('SELECT user_id, amount FROM user_earnings').all()).toEqual([{ user_id: 8, amount: 70 }]);
  expect(payment.initiate).not.toHaveBeenCalled();
  await expect(settings.getValue(marker)).resolves.toBe(reason);
  await expect(reviews.list(7)).rejects.toMatchObject({ code: 'EARNINGS_UNDER_REVIEW' });
});
