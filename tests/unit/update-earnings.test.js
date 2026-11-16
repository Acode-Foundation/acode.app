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

beforeEach(() => {
  calcEarnings = {
    indexReport: vi.fn(() => new Map()),
    total: vi.fn(async (_year, _month, user) => {
      if (user.id === 1) throw Object.assign(new Error('Invalid report for user 1'), { code: 'INVALID_GOOGLE_REPORT' });
      return 100;
    }),
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
  payment = { insert: vi.fn() };
  exit = vi.fn();
  const dependencies = {
    'node:crypto': {},
    moment,
    '../entities/plugin': { getUsersWithPlugin: async () => [{ id: 1 }, { id: 2 }, { id: 3 }] },
    '../entities/payment': payment,
    './downloadGr': async () => [],
    './calcEarnings': calcEarnings,
    '../entities/userEarnings': earnings,
    '../entities/paymentMethod': {},
    './sendEmail': vi.fn(),
    '../../constants.mjs': { PAYMENT_THRESHOLD: 1000 },
    '../entities/appConfig': { getValue: async () => 1000 },
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
