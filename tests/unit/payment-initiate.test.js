import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';

let db;
let Payment;
let reviews;

function load(file, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL(`../../server/${file}`, import.meta.url), 'utf8'), {
    module,
    console,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE user (id INTEGER PRIMARY KEY);
    CREATE TABLE payment_method (id INTEGER PRIMARY KEY);
    INSERT INTO user VALUES (7), (8);
    INSERT INTO payment_method VALUES (3);`);
  const Entity = load('entities/entity.js', { '../lib/db': db });
  const settings = load('entities/appConfig.js', { './entity': Entity, '../../constants.mjs': { PAYMENT_THRESHOLD: 10000 } });
  reviews = load('lib/earningsReview.js', { '../entities/appConfig': settings, '../entities/entity': Entity, 'node:crypto': crypto });
  Payment = load('entities/payment.js', {
    './entity': Entity,
    '../lib/db': db,
    '../lib/maskedEmail': load('lib/maskedEmail.js', {}),
    '../lib/earningsReview': reviews,
  });
  load('entities/userEarnings.js', { './entity': Entity });
  db.exec(`INSERT INTO user_earnings (id, user_id, year, month, amount) VALUES (1, 7, 2026, 8, 100), (2, 7, 2026, 9, 50), (3, 8, 2026, 9, 70)`);
});

afterEach(() => db.close());

const payout = (extra) => ({
  id: 55,
  userId: 7,
  amount: 150,
  paymentMethodId: 3,
  dateFrom: '2026-09-01',
  dateTo: '2026-10-31',
  earningIds: [1, 2],
  ...extra,
});
const payments = () => db.prepare('SELECT id, user_id, amount, status, payment_method_id, date_from, date_to FROM payment').all();
const paidIds = () => db.prepare('SELECT id, payment_id FROM user_earnings WHERE payment_id IS NOT NULL ORDER BY id').all();

it('creates the payout and marks exactly its earnings', () => {
  Payment.initiate(payout());
  expect(payments()).toEqual([{ id: 55, user_id: 7, amount: 150, status: 2, payment_method_id: 3, date_from: '2026-09-01', date_to: '2026-10-31' }]);
  expect(paidIds()).toEqual([
    { id: 1, payment_id: 55 },
    { id: 2, payment_id: 55 },
  ]);
});

it('creates no payout when marking its earnings fails', () => {
  db.exec(`CREATE TRIGGER fail BEFORE UPDATE ON user_earnings WHEN new.id = 2 BEGIN SELECT RAISE(ABORT, 'disk failure'); END`);
  expect(() => Payment.initiate(payout())).toThrow('disk failure');
  expect(payments()).toEqual([]);
  expect(paidIds()).toEqual([]);
});

it('never pays the same earnings twice', () => {
  Payment.initiate(payout());
  expect(() => Payment.initiate(payout({ id: 56 }))).toThrow('Nothing was paid');
  expect(payments()).toHaveLength(1);
});

it.each([
  ['some were paid in the meantime', { earningIds: [1, 2] }, 'UPDATE user_earnings SET payment_id = 9 WHERE id = 1'],
  ['some belong to someone else', { earningIds: [1, 3] }],
  ['some no longer exist', { earningIds: [1, 99] }],
  ['there are none', { earningIds: [] }],
])('creates no payout when %s', (_name, extra, change) => {
  if (change) {
    db.exec("INSERT INTO payment (id, user_id, amount, payment_method_id, date_from, date_to) VALUES (9, 7, 1, 3, '2026-01-01', '2026-01-31')");
    db.exec(change);
  }
  const before = payments();
  const paidBefore = paidIds();
  expect(() => Payment.initiate(payout(extra))).toThrow('Nothing was paid');
  expect(payments()).toEqual(before);
  expect(paidIds()).toEqual(paidBefore);
});

it('marks nothing when the payout itself cannot be created', () => {
  expect(() => Payment.initiate(payout({ paymentMethodId: 404 }))).toThrow();
  expect(payments()).toEqual([]);
  expect(paidIds()).toEqual([]);
});

it.each([
  ['another month of the developer was held', () => reviews.hold(7, 2025, 0, 'GOOGLE_PURCHASE_REVIEW_REQUIRED')],
  ['a damaged hold exists', () => db.prepare("INSERT INTO app_config (key, value) VALUES ('earnings-hold:7:bad', 'BAD')").run()],
])('pays nothing when %s after the balance was calculated', async (_name, hold) => {
  await hold();
  expect(() => Payment.initiate(payout())).toThrow(expect.objectContaining({ code: 'EARNINGS_UNDER_REVIEW' }));
  expect(payments()).toEqual([]);
  expect(paidIds()).toEqual([]);
});

it.each([
  [
    'both rows are unpaid',
    () => db.exec('INSERT INTO user_earnings (id, user_id, year, month, amount) VALUES (4, 7, 2026, 9, 50)'),
    { earningIds: [1, 2, 4], amount: 200 },
  ],
  ['only one of them is selected', () => db.exec('INSERT INTO user_earnings (id, user_id, year, month, amount) VALUES (4, 7, 2026, 9, 50)'), {}],
  [
    'the other one was paid before',
    () =>
      db.exec(`INSERT INTO payment (id, user_id, amount, payment_method_id, date_from, date_to) VALUES (9, 7, 50, 3, '2026-10-01', '2026-10-31');
        INSERT INTO user_earnings (id, user_id, year, month, amount, payment_id) VALUES (4, 7, 2026, 9, 50, 9)`),
    {},
  ],
])('never pays a month that was saved twice when %s', (_name, duplicate, extra) => {
  duplicate();
  const before = [payments(), paidIds()];
  expect(() => Payment.initiate(payout(extra))).toThrow(
    expect.objectContaining({ code: 'EARNINGS_UNDER_REVIEW', message: expect.stringContaining('saved more than once for 2026-10') }),
  );
  expect([payments(), paidIds()]).toEqual(before);

  db.exec('DELETE FROM user_earnings WHERE id = 4');
  Payment.initiate(payout());
  expect(payments().some(({ id }) => id === 55)).toBe(true);
});

it('is not affected by duplicate months of someone else or of months that are not being paid', () => {
  db.exec(`INSERT INTO payment (id, user_id, amount, payment_method_id, date_from, date_to) VALUES (9, 7, 50, 3, '2025-01-01', '2025-01-31');
    INSERT INTO user_earnings (user_id, year, month, amount, payment_id) VALUES (8, 2026, 9, 70, NULL), (7, 2025, 0, 25, 9), (7, 2025, 0, 25, 9)`);
  Payment.initiate(payout());
  expect(payments()).toHaveLength(2);
});

it('accepts a difference of one paisa from rounding', () => {
  Payment.initiate(payout({ amount: 150.01 }));
  expect(payments()).toHaveLength(1);
});

it('ignores holds of other developers, even when their id starts with the same digits', async () => {
  await reviews.hold(70, 2026, 8, 'INVALID_GOOGLE_REPORT');
  await reviews.hold(8, 2026, 8, 'INVALID_GOOGLE_REPORT');
  Payment.initiate(payout());
  expect(payments()).toHaveLength(1);
});

it.each([140, 150.02, 149.98, NaN, undefined])('pays nothing when the amount %s is not the sum of its earnings', (amount) => {
  expect(() => Payment.initiate(payout({ amount }))).toThrow();
  expect(payments()).toEqual([]);
  expect(paidIds()).toEqual([]);
});

it('accepts sums of fractional amounts as the balance calculation rounds them', () => {
  db.exec('UPDATE user_earnings SET amount = 0.1 WHERE id = 1; UPDATE user_earnings SET amount = 0.2 WHERE id = 2');
  Payment.initiate(payout({ amount: 0.3 }));
  expect(payments()[0].amount).toBe(0.3);
});
