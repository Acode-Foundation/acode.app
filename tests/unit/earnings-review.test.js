import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import moment from 'moment';

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
  const Entity = load('entities/entity.js', { '../lib/db': db });
  settings = load('entities/appConfig.js', { './entity': Entity, '../../constants.mjs': { PAYMENT_THRESHOLD: 10000 } });
  await settings.setValue('payment_threshold', 10000);
  reviews = load('lib/earningsReview.js', { '../entities/appConfig': settings });
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
  payment = { ID: 'id', AMOUNT: 'amount', insert: vi.fn() };
  downloadReport = vi.fn().mockResolvedValue([]);
  run = load('lib/updateEarnings.js', {
    moment,
    'node:crypto': { randomInt: () => 123 },
    '../entities/plugin': { getUsersWithPlugin: async () => [user] },
    '../entities/payment': payment,
    '../entities/paymentMethod': { ID: 'id', get: async () => [{ id: 1 }] },
    '../entities/userEarnings': earnings,
    '../entities/appConfig': settings,
    './earningsReview': reviews,
    './downloadGr': downloadReport,
    './sendEmail': vi.fn(),
    './calcEarnings': { ...calculator, total: calculate },
  });
  const { getDeveloperDashboard } = load('lib/developerDashboard.js', {
    moment,
    './earningsReview': reviews,
    '../entities/entity': {},
    '../entities/download': {},
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
  const reloaded = load('lib/earningsReview.js', { '../entities/appConfig': settings });
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
  expect(payment.insert).not.toHaveBeenCalled();
  await expect(reviews.list(7)).resolves.toEqual([{ year: 2026, month: 9, code: 'MISSING_RAZORPAY_INR' }]);
  await expect(reviews.assertClear(70)).rejects.toThrow('2026-10');
  await run(2026, 9);
  expect(payment.insert).toHaveBeenCalledOnce();
  expect(payment.insert.mock.calls[0]).toContainEqual(['amount', 140]);
  await expect(reviews.assertClear(70)).rejects.toThrow('2026-10');
});

it('does not clear a marker when recalculation succeeds but the monthly write fails', async () => {
  await reviews.hold(7, 2026, 9, 'MISSING_RAZORPAY_INR');
  calculate.mockResolvedValue(70);
  vi.spyOn(earnings, 'insert').mockRejectedValue(new Error('Fixture write failure'));
  await expect(run(2026, 9)).rejects.toThrow('Fixture write failure');
  await expect(reviews.assertClear(7, 2026, 9)).rejects.toMatchObject({ statusCode: 409 });
  expect(payment.insert).not.toHaveBeenCalled();
});

it('reads all held months without the API pagination limit and leaves settings alone', async () => {
  for (let i = 0; i < 101; i++) await reviews.hold(7, 2000 + Math.floor(i / 12), i % 12, 'INVALID_GOOGLE_REPORT');
  expect(await reviews.list(7)).toHaveLength(101);
  await reviews.clear(7, 2000, 0);
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

  await expect(run(2026, 9)).rejects.toBe(failure);
  expect(db.prepare('SELECT amount, payment_id FROM user_earnings').all()).toEqual([{ amount: 50, payment_id: null }]);
  await expect(reviews.assertClear(7, 2026, 9)).rejects.toMatchObject({ statusCode: 409 });
  expect(payment.insert).not.toHaveBeenCalled();

  await run(2026, 9);
  expect(orders.update).toHaveBeenLastCalledWith(['amount', 200], ['id', 1]);
  await expect(reviews.list(7)).resolves.toEqual([]);
  expect(db.prepare('SELECT amount, payment_id FROM user_earnings').all()).toEqual([{ amount: 170, payment_id: 123 }]);
  expect(payment.insert).toHaveBeenCalledOnce();
  expect(payment.insert.mock.calls[0]).toContainEqual(['amount', 170]);
});
