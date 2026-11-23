import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import moment from 'moment';

const filename = path.resolve(import.meta.dirname, '../../server/lib/updateEarnings.js');
const source = fs.readFileSync(filename, 'utf8');
let calcEarnings;
let earnings;
let payment;
let updateEarnings;
let exit;
let configuredThreshold;
let users;
let review;

beforeEach(() => {
  configuredThreshold = 1000;
  users = [{ id: 1 }, { id: 2 }, { id: 3 }];
  calcEarnings = {
    indexReport: vi.fn(() => new Map()),
    total: vi.fn(async (_year, _month, user) => {
      if (user.id === 1) throw Object.assign(new Error('Invalid report for user 1'), { code: 'INVALID_GOOGLE_REPORT' });
      return 100;
    }),
    unpaid: vi.fn(async () => ({ ids: [10], earnings: 100, from: moment('2026-10-01'), to: moment('2026-10-31') })),
  };
  earnings = {
    USER_ID: 'user_id',
    YEAR: 'year',
    MONTH: 'month',
    AMOUNT: 'amount',
    get: vi.fn().mockResolvedValue([]),
    insert: vi.fn(),
    update: vi.fn(),
  };
  payment = { USER_ID: 'user_id', insert: vi.fn() };
  exit = vi.fn();
  review = {
    CALCULATION_CODES: ['INVALID_GOOGLE_REPORT', 'MISSING_RAZORPAY_INR'],
    hold: vi.fn(),
    clearCalculated: vi.fn(),
    assertRecalculable: vi.fn(),
    assertClear: vi.fn(),
    markPendingExcluded: vi.fn(),
  };
  const dependencies = {
    './earningsReview': review,
    'node:crypto': { randomInt: () => 123 },
    moment,
    '../entities/plugin': { getUsersWithPlugin: async () => users },
    '../entities/payment': payment,
    './downloadGr': async () => [],
    './calcEarnings': calcEarnings,
    '../entities/userEarnings': earnings,
    '../entities/paymentMethod': { ID: 'id', get: async () => [{ id: 1 }] },
    './sendEmail': vi.fn(),
    '../entities/appConfig': { getPaymentThreshold: async () => configuredThreshold },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      module,
      process: { argv: [], exit },
      console: { log: vi.fn(), error: vi.fn() },
      require(name) {
        if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
        return dependencies[name];
      },
    },
    { filename },
  );
  updateEarnings = module.exports;
});

it('holds only the affected developer and reports holds to the cron wrapper after processing everyone else', async () => {
  await expect(updateEarnings(2026, 9)).rejects.toThrow('holds for users: 1');
  expect(calcEarnings.indexReport).toHaveBeenCalledOnce();
  expect(calcEarnings.total).toHaveBeenCalledTimes(3);
  const index = calcEarnings.indexReport.mock.results[0].value;
  expect(calcEarnings.total.mock.calls.every((args) => args[3] === index)).toBe(true);
  expect(earnings.insert.mock.calls.map((columns) => columns.find(([key]) => key === 'user_id')[1])).toEqual([2, 3]);
  expect(earnings.update).not.toHaveBeenCalled();
  expect(payment.insert).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});

it('propagates unexpected failures without killing the server', async () => {
  calcEarnings.total.mockRejectedValue(new Error('Database unavailable'));
  await expect(updateEarnings(2026, 9)).rejects.toThrow('Database unavailable');
  expect(earnings.insert).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});

it('includes missing Razorpay order references in the cron alert while continuing other developers', async () => {
  calcEarnings.total.mockImplementation(async (_year, _month, user) => {
    if (user.id === 1) throw Object.assign(new Error('Missing INR basis for order_missing; user 1 held.'), { code: 'MISSING_RAZORPAY_INR' });
    return 100;
  });
  await expect(updateEarnings(2026, 9)).rejects.toThrow('order_missing');
  expect(earnings.insert.mock.calls.map((columns) => columns.find(([key]) => key === 'user_id')[1])).toEqual([2, 3]);
  expect(payment.insert).not.toHaveBeenCalled();
});

it('uses the current application threshold for payout eligibility, including the exact boundary', async () => {
  users = [{ id: 2, payment_method_id: 1 }];
  configuredThreshold = 101;
  await updateEarnings(2026, 9);
  expect(payment.insert).not.toHaveBeenCalled();
  configuredThreshold = 100;
  await updateEarnings(2026, 9);
  expect(payment.insert).toHaveBeenCalledOnce();
});

it('continues later developers when balance loading discovers a hold', async () => {
  users = [
    { id: 1, payment_method_id: 1 },
    { id: 2, payment_method_id: 1 },
  ];
  configuredThreshold = 100;
  calcEarnings.total.mockResolvedValue(100);
  calcEarnings.unpaid.mockRejectedValueOnce(Object.assign(new Error('New hold for 2026-09'), { code: 'EARNINGS_UNDER_REVIEW' }));

  await expect(updateEarnings(2026, 9)).rejects.toThrow('holds for users: 1');
  expect(calcEarnings.total.mock.calls.map((args) => args[2].id)).toEqual([1, 2]);
  expect(calcEarnings.unpaid.mock.calls.map(([user]) => user.id)).toEqual([1, 2]);
  expect(payment.insert).toHaveBeenCalledOnce();
  expect(payment.insert.mock.calls[0]).toContainEqual(['user_id', 2]);
  expect(review.assertClear).not.toHaveBeenCalled(); // unpaid owns the hold check for payable accounts.
  expect(review.hold).not.toHaveBeenCalled(); // Do not mislabel this successfully calculated month as held.
});

it('still reports existing holds for developers without a payment method', async () => {
  users = [{ id: 2 }, { id: 3 }];
  review.assertClear.mockRejectedValueOnce(Object.assign(new Error('Older month held'), { code: 'EARNINGS_UNDER_REVIEW' }));

  await expect(updateEarnings(2026, 9)).rejects.toThrow('holds for users: 2');
  expect(review.assertClear.mock.calls).toEqual([[2], [3]]);
  expect(calcEarnings.total).toHaveBeenCalledTimes(2);
  expect(calcEarnings.unpaid).not.toHaveBeenCalled();
  expect(payment.insert).not.toHaveBeenCalled();
});

it('does not suppress unexpected failures while loading a balance', async () => {
  users = [
    { id: 2, payment_method_id: 1 },
    { id: 3, payment_method_id: 1 },
  ];
  calcEarnings.unpaid.mockRejectedValueOnce(new Error('Database unavailable'));

  await expect(updateEarnings(2026, 9)).rejects.toThrow('Database unavailable');
  expect(calcEarnings.total).toHaveBeenCalledOnce();
  expect(payment.insert).not.toHaveBeenCalled();
});

it('records the pending-exclusion cutoff before saving any earnings row', async () => {
  await expect(updateEarnings(2026, 9)).rejects.toThrow('holds for users: 1');
  expect(review.markPendingExcluded).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/));
  expect(review.markPendingExcluded.mock.invocationCallOrder[0]).toBeLessThan(earnings.insert.mock.invocationCallOrder[0]);
});

it('continues other developers without recalculating a manually held month', async () => {
  review.assertRecalculable.mockRejectedValueOnce(Object.assign(new Error('Manual review required'), { code: 'EARNINGS_UNDER_REVIEW' }));
  await expect(updateEarnings(2026, 9)).rejects.toThrow('holds for users: 1');
  expect(calcEarnings.total.mock.calls.map((args) => args[2].id)).toEqual([2, 3]);
  expect(review.hold).not.toHaveBeenCalled();
  expect(review.clearCalculated.mock.calls).toEqual([
    [2, 2026, 9],
    [3, 2026, 9],
  ]);
});
