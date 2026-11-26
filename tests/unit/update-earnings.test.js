import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import moment from 'moment';
import * as paymentMethods from '../../shared/paymentMethods';

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
let method;
let paypalEnabled;
let sendEmail;

beforeEach(() => {
  configuredThreshold = 1000;
  method = { id: 1 };
  paypalEnabled = false;
  sendEmail = vi.fn().mockResolvedValue();
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
  payment = { initiate: vi.fn() };
  exit = vi.fn();
  review = {
    CALCULATION_CODES: ['INVALID_GOOGLE_REPORT', 'MISSING_RAZORPAY_INR', 'EARNINGS_RUN_FAILED'],
    RUN_FAILED: 'EARNINGS_RUN_FAILED',
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
    '../entities/paymentMethod': { ID: 'id', get: async () => [method] },
    './sendEmail': sendEmail,
    '../entities/appConfig': { getPaymentThreshold: async () => configuredThreshold, isPayPalEnabled: async () => paypalEnabled },
    '../../shared/paymentMethods': paymentMethods,
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
  expect(payment.initiate).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});

it('reports unexpected failures of every developer without killing the server', async () => {
  calcEarnings.total.mockRejectedValue(new Error('Database unavailable'));
  await expect(updateEarnings(2026, 9)).rejects.toThrow('failed unexpectedly for users: 1, 2, 3. User 1: Database unavailable');
  expect(calcEarnings.total).toHaveBeenCalledTimes(3);
  expect(earnings.insert).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});

it('continues after an unexpected failure and holds the month that was not saved', async () => {
  users = [
    { id: 2, payment_method_id: 1 },
    { id: 3, payment_method_id: 1 },
  ];
  configuredThreshold = 100;
  calcEarnings.total.mockRejectedValueOnce(new Error('Corrupt row')).mockResolvedValue(100);
  await expect(updateEarnings(2026, 9)).rejects.toThrow('failed unexpectedly for users: 2. User 2: Corrupt row');
  expect(review.hold.mock.calls).toEqual([[2, 2026, 9, 'EARNINGS_RUN_FAILED']]);
  expect(payment.initiate).toHaveBeenCalledOnce();
  expect(payment.initiate.mock.calls[0][0]).toMatchObject({ userId: 3 });
});

it('does not hold a month that was saved before its payout failed', async () => {
  users = [
    { id: 2, payment_method_id: 1 },
    { id: 3, payment_method_id: 1 },
  ];
  configuredThreshold = 100;
  calcEarnings.total.mockResolvedValue(100);
  payment.initiate.mockImplementationOnce(() => {
    throw new Error('Disk failure');
  });
  await expect(updateEarnings(2026, 9)).rejects.toThrow('User 2: Disk failure');
  expect(review.hold).not.toHaveBeenCalled();
  expect(payment.initiate).toHaveBeenCalledTimes(2);
});

it('says which developers could not be held, reports holds too, and keeps the alert short', async () => {
  users = Array.from({ length: 41 }, (_, index) => ({ id: index + 1 }));
  calcEarnings.total.mockImplementation(async (_year, _month, user) => {
    if (user.id === 1) throw Object.assign(new Error('Invalid report'), { code: 'INVALID_GOOGLE_REPORT' });
    throw new Error('Database unavailable');
  });
  review.hold.mockImplementation(async (userId) => {
    if (userId === 41) throw new Error('Read-only database');
  });
  const { message } = await updateEarnings(2026, 9).catch((error) => error);
  expect(message).toContain('holds for users: 1.');
  expect(message).toContain('User 41 could NOT be held; run 2026-10 again before the next payout.');
  expect(message).toContain('And 21 more');
});

it('stops before any developer when the shared data cannot be loaded', async () => {
  review.markPendingExcluded.mockRejectedValue(new Error('Database unavailable'));
  await expect(updateEarnings(2026, 9)).rejects.toThrow('Database unavailable');
  expect(calcEarnings.total).not.toHaveBeenCalled();
  expect(review.hold).not.toHaveBeenCalled();
});

it('includes missing Razorpay order references in the cron alert while continuing other developers', async () => {
  calcEarnings.total.mockImplementation(async (_year, _month, user) => {
    if (user.id === 1) throw Object.assign(new Error('Missing INR basis for order_missing; user 1 held.'), { code: 'MISSING_RAZORPAY_INR' });
    return 100;
  });
  await expect(updateEarnings(2026, 9)).rejects.toThrow('order_missing');
  expect(earnings.insert.mock.calls.map((columns) => columns.find(([key]) => key === 'user_id')[1])).toEqual([2, 3]);
  expect(payment.initiate).not.toHaveBeenCalled();
});

it('uses the current application threshold for payout eligibility, including the exact boundary', async () => {
  users = [{ id: 2, payment_method_id: 1 }];
  configuredThreshold = 101;
  await updateEarnings(2026, 9);
  expect(payment.initiate).not.toHaveBeenCalled();
  configuredThreshold = 100;
  await updateEarnings(2026, 9);
  expect(payment.initiate).toHaveBeenCalledOnce();
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
  expect(payment.initiate).toHaveBeenCalledOnce();
  expect(payment.initiate.mock.calls[0][0]).toMatchObject({
    userId: 2,
    paymentMethodId: 1,
    amount: 100,
    earningIds: [10],
    dateFrom: '2026-10-01',
    dateTo: '2026-10-31',
  });
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
  expect(payment.initiate).not.toHaveBeenCalled();
});

it('reports unexpected failures while loading a balance and still pays later developers', async () => {
  users = [
    { id: 2, payment_method_id: 1 },
    { id: 3, payment_method_id: 1 },
  ];
  configuredThreshold = 100;
  calcEarnings.total.mockResolvedValue(100);
  calcEarnings.unpaid.mockRejectedValueOnce(new Error('Database unavailable'));

  await expect(updateEarnings(2026, 9)).rejects.toThrow('failed unexpectedly for users: 2. User 2: Database unavailable');
  expect(calcEarnings.total).toHaveBeenCalledTimes(2);
  expect(payment.initiate).toHaveBeenCalledOnce();
  expect(payment.initiate.mock.calls[0][0]).toMatchObject({ userId: 3 });
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

it.each([
  ['bank_india', false, true],
  ['bank_overseas', false, true],
  ['paypal', true, true],
  ['paypal', false, false],
  ['wallet', true, false],
])('initiates a payout to %s with PayPal enabled=%s: %s', async (type, enabled, paid) => {
  users = [{ id: 2, name: 'Developer', email: 'dev@example.com', payment_method_id: 1 }];
  configuredThreshold = 100;
  method = { id: 1, type };
  paypalEnabled = enabled;
  await updateEarnings(2026, 9);
  expect(payment.initiate).toHaveBeenCalledTimes(paid ? 1 : 0);
  expect(sendEmail).toHaveBeenCalledTimes(paid ? 0 : 1);
  if (!paid) expect(earnings.update).not.toHaveBeenCalled();
});

it('reports a run as active until it has finished or failed', async () => {
  expect(updateEarnings.isRunning()).toBe(false);
  const failed = updateEarnings(2026, 9);
  expect(updateEarnings.isRunning()).toBe(true);
  await expect(failed).rejects.toThrow('holds for users: 1');
  expect(updateEarnings.isRunning()).toBe(false);
});

it('reports a hold that appears while the payout is created as a hold, not as a failure', async () => {
  users = [
    { id: 2, payment_method_id: 1 },
    { id: 3, payment_method_id: 1 },
  ];
  configuredThreshold = 100;
  calcEarnings.total.mockResolvedValue(100);
  payment.initiate.mockImplementationOnce(() => {
    throw Object.assign(new Error('Held while paying'), { code: 'EARNINGS_UNDER_REVIEW' });
  });
  const { message } = await updateEarnings(2026, 9).catch((error) => error);
  expect(message).toContain('holds for users: 2');
  expect(message).not.toContain('failed unexpectedly');
  expect(review.hold).not.toHaveBeenCalled();
  expect(payment.initiate).toHaveBeenCalledTimes(2);
});

it.each([
  ['paypal', 'PayPal'],
  ['wallet', 'Crypto wallet'],
  ['something_new', 'something_new'],
])('names the unavailable %s method in the email', async (type, label) => {
  users = [{ id: 2, payment_method_id: 1 }];
  configuredThreshold = 100;
  method = { id: 1, type };
  await updateEarnings(2026, 9);
  expect(sendEmail.mock.calls[0][3]).toContain(`default payment method (${label})`);
});

describe('command line', () => {
  async function runCommand(args, complete = true, isMain = true) {
    const module = { exports: {} };
    const process = { argv: ['node', 'updateEarnings', ...args] };
    const error = vi.fn();
    const auth = vi.fn().mockResolvedValue();
    const downloadReport = vi.fn().mockRejectedValue(new Error('Reached the run'));
    const isComplete = vi.fn(() => complete);
    const dependencies = {
      moment,
      'node:path': path,
      dotenv: { config() {} },
      '../lib/gapis': auth,
      './downloadGr': downloadReport,
      './downloadHistory': { isComplete },
      '../../shared/paymentMethods': paymentMethods,
    };
    for (const name of [
      '../entities/plugin',
      '../entities/payment',
      './calcEarnings',
      '../entities/userEarnings',
      '../entities/paymentMethod',
      './sendEmail',
      '../entities/appConfig',
      './earningsReview',
      'node:crypto',
    ])
      dependencies[name] = {};
    const load = (name) => {
      if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
      return dependencies[name];
    };
    load.main = isMain ? module : {};
    vm.runInNewContext(source, { module, process, console: { error, log() {} }, require: load, __dirname: path.dirname(filename) });
    await new Promise((resolve) => setTimeout(resolve));
    return { process, auth, isComplete, downloadReport, error, message: error.mock.calls[0]?.[0].message };
  }

  it('runs a finished month whose downloads are stored', async () => {
    const { auth, isComplete, downloadReport, error, message, process } = await runCommand(['2025', '9']);
    expect(isComplete).toHaveBeenCalledWith(2025, 9);
    expect(auth).toHaveBeenCalledOnce();
    expect(downloadReport).toHaveBeenCalledWith(2025, 10);
    expect(message).toBe('Reached the run');
    expect(error).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it.each([
    [['2025', '12'], true, 'Usage'],
    [['2025', '-1'], true, 'Usage'],
    [['2025', '1.5'], true, 'Usage'],
    [['x', '1'], true, 'Usage'],
    [['2025'], true, 'Usage'],
    [[], true, 'Usage'],
    [['2999', '0'], true, 'finished month'],
    [[String(new Date().getFullYear()), String(new Date().getMonth())], true, 'finished month'],
    [['2025', '9'], false, 'already been deleted'],
  ])('refuses %j with complete downloads: %s', async (args, complete, expected) => {
    const { auth, message, process } = await runCommand(args, complete);
    expect(message).toContain(expected);
    expect(auth).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('does nothing when another program with arguments loads the file', async () => {
    const { auth, message } = await runCommand(['2025', '9'], true, false);
    expect(auth).not.toHaveBeenCalled();
    expect(message).toBeUndefined();
  });
});
