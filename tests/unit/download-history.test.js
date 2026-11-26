import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import moment from 'moment';

// The October month is complete until the cleanup of January 1 deletes October 1.
const BEFORE = '2026-12-31T12:00:00';
const AFTER = '2027-01-01T12:00:00';
let db;
let reviews;
let history;
let calcEarnings;
let notifier;
let cleanDb;

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
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(AFTER) });
  db = new Database(':memory:');
  db.exec('CREATE TABLE plugin (id TEXT PRIMARY KEY, user_id INTEGER, status INTEGER); INSERT INTO plugin VALUES (70, 7, 1), (80, 8, 1)');
  const Entity = load('entities/entity.js', { '../lib/db': db });
  const settings = load('entities/appConfig.js', { './entity': Entity, '../../constants.mjs': { PAYMENT_THRESHOLD: 10000 } });
  const Download = load('entities/download.js', { './entity': Entity });
  reviews = load('lib/earningsReview.js', { '../entities/appConfig': settings, '../entities/entity': Entity, 'node:crypto': crypto });
  const plugins = {
    ID: 'id',
    USER_ID: 'user_id',
    for: () => plugins,
    get: async (_c, [, id]) => db.prepare('SELECT id FROM plugin WHERE user_id = ?').all(id),
  };
  calcEarnings = load('lib/calcEarnings.js', {
    moment,
    '../entities/plugin': plugins,
    '../entities/download': Download,
    '../entities/userEarnings': {},
    '../entities/purchaseOrder': { for: () => ({ get: async () => [] }) },
    '../entities/razorpayOrder': {},
    './earningsReview': reviews,
  });
  history = load('lib/downloadHistory.js', {
    moment,
    './db': db,
    './earningsReview': reviews,
    './calcEarnings': calcEarnings,
    '../entities/appConfig': settings,
    '../entities/download': Download,
  });
  notifier = { success: vi.fn(), failure: vi.fn() };
  const other = { delete: vi.fn(), deleteExpiredBefore: vi.fn() };
  cleanDb = load('crons/cleanDb.js', {
    moment,
    '../entities/otp': other,
    '../entities/login': other,
    '../entities/apiKey': other,
    '../entities/download': Download,
    '../entities/razorpayOrder': other,
    '../entities/purchaseOrder': other,
    '../lib/developerDashboard': { DOWNLOAD_RETENTION_DAYS: 91 },
    '../lib/cronNotifier': { createNotifier: () => notifier },
    '../lib/downloadHistory': history,
  });
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
});

const PACKAGE = 'com.foxdebug.acodefree';
const add = (createdAt, count = 1, plugin = '70', app = PACKAGE) => {
  const insert = db.prepare("INSERT INTO download (client_ip, package_name, plugin_id, device_id, created_at) VALUES ('ip', ?, ?, 'device', ?)");
  for (let i = 0; i < count; i += 1) insert.run(app, plugin, createdAt);
};
const stored = () => db.prepare('SELECT COUNT(*) AS count FROM download').get().count;
const kept = () => db.prepare("SELECT key, value FROM app_config WHERE key LIKE 'earnings-downloads:%' ORDER BY key").all();
const october = () => {
  add('2026-10-01 10:00:00', 1000);
  add('2026-10-31 23:59:59', 500);
  add('2026-11-01 00:00:00', 50);
  add('2026-10-15 10:00:00', 400, '80');
  add('2026-10-15 10:00:00', 70, '70', 'com.foxdebug.acode');
};

it('keeps the whole month of a held developer before its first day is deleted', async () => {
  october();
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  const expected = await calcEarnings.fromDownloads(2026, 9, { id: 7 });
  expect(expected).toBe(18);
  await cleanDb();
  expect(kept()).toEqual([{ key: 'earnings-downloads:7:2026:9', value: '18' }]);
  expect(history.isComplete(2026, 9)).toBe(false);
  expect(history.keptEarnings(7, 2026, 9)).toBe(18);
  expect(history.keptEarnings(8, 2026, 9)).toBeNull();
  // The total is the same as before the cleanup, however long the month stays held.
  expect(await calcEarnings.total(2026, 9, { id: 7 }, [], history.keptEarnings(7, 2026, 9))).toBe(18);
  expect(await calcEarnings.total(2026, 9, { id: 7 }, [])).toBe(6);
  vi.setSystemTime(new Date('2027-02-10T12:00:00'));
  await cleanDb();
  expect(history.keptEarnings(7, 2026, 9)).toBe(18);
  expect(await reviews.list(7)).toHaveLength(1);
});

it('keeps nothing while the downloads of the month are not deleted yet', async () => {
  vi.setSystemTime(new Date(BEFORE));
  october();
  add('2026-10-01 00:00:00');
  const before = stored();
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  await cleanDb();
  expect(kept()).toEqual([]);
  expect(stored()).toBe(before);
  expect(history.isComplete(2026, 9)).toBe(true);
});

it('keeps a total of zero, and every held month and developer', async () => {
  october();
  add('2026-09-30 10:00:00', 1000);
  await reviews.hold(7, 2026, 8, 'EARNINGS_RUN_FAILED');
  await reviews.hold(8, 2026, 9, 'MISSING_RAZORPAY_INR');
  await reviews.hold(99, 2026, 9, 'MISSING_RAZORPAY_INR');
  await cleanDb();
  // September had already lost its first days.
  expect(kept()).toEqual([
    { key: 'earnings-downloads:8:2026:9', value: '4.8' },
    { key: 'earnings-downloads:99:2026:9', value: '0' },
  ]);
  expect(history.keptEarnings(99, 2026, 9)).toBe(0);
});

it('never keeps the rest of a month that already lost downloads', async () => {
  add('2026-10-02 00:00:00', 1000);
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  vi.setSystemTime(new Date('2027-01-03T12:00:00'));
  await cleanDb();
  expect(kept()).toEqual([]);
  expect(stored()).toBe(0);
});

it('deletes nothing when the earnings cannot be kept, and tries again on the next run', async () => {
  october();
  const before = stored();
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  db.exec("CREATE TRIGGER fail BEFORE INSERT ON app_config WHEN NEW.key LIKE 'earnings-downloads:%' BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  await cleanDb(); // The rest of the cleanup still runs.
  expect(stored()).toBe(before);
  expect(notifier.failure).toHaveBeenCalledOnce();
  db.exec('DROP TRIGGER fail');
  await cleanDb();
  expect(stored()).toBeLessThan(before);
  expect(notifier.success).toHaveBeenCalledOnce();
  expect(history.keptEarnings(7, 2026, 9)).toBe(18);
});

it.each([
  [0, 2026, 9],
  [7, 2026, 12],
  ['7:2026:9:x', 2026, 9],
])('rejects the period %s %s %s', (userId, year, month) => {
  expect(() => history.keptEarnings(userId, year, month)).toThrow('Invalid earnings review');
});

it('names the damaged record', () => {
  db.exec("INSERT INTO app_config (key, value) VALUES ('earnings-downloads:7:2026:9', '-1')");
  expect(() => history.keptEarnings(7, 2026, 9)).toThrow(expect.objectContaining({ statusCode: 409, key: 'earnings-downloads:7:2026:9' }));
});

it('reports a failed deletion', async () => {
  october();
  db.exec("CREATE TRIGGER fail BEFORE DELETE ON download BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  await cleanDb();
  expect(notifier.failure).toHaveBeenCalledOnce();
  expect(notifier.success).not.toHaveBeenCalled();
});

it('counts a month as incomplete when no download shows that it is complete', () => {
  expect(history.isComplete(2026, 9)).toBe(false);
  add('2026-10-02 00:00:00');
  expect(history.isComplete(2026, 9)).toBe(false);
  expect(history.isComplete(2026, 10)).toBe(true);
});
