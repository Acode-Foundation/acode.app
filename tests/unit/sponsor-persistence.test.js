import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const purchaseRules = require('../../server/lib/sponsorPurchase');
const migration = require('../../server/migrations/021_sponsor_purchase_integrity');
const purchaseTimeMillis = String(Date.UTC(2026, 10, 20));

let db;
let sponsor;

function load(file, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL(`../../server/${file}`, import.meta.url), 'utf8'), {
    module,
    console,
    Date,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

beforeEach(() => {
  vi.useFakeTimers();
  // The real entity implementation only receives this disposable database.
  db = new Database(':memory:');
  db.exec('CREATE TABLE user (id INTEGER PRIMARY KEY)');
  const Entity = load('entities/entity.js', { '../lib/db': db });
  sponsor = load('entities/sponsor.js', { './entity': Entity, '../lib/sponsorPurchase': purchaseRules });
  migration.up(db);
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function purchase(orderId, packageName = 'app.acode') {
  return [
    [sponsor.NAME, 'Sponsor'],
    [sponsor.TOKEN, 'signed'],
    [sponsor.EMAIL, ''],
    [sponsor.ORDER_ID, orderId],
    [sponsor.PACKAGE_NAME, packageName],
    [sponsor.TIER, 'crystal'],
    [sponsor.STATUS, sponsor.STATE_PURCHASED],
    [sponsor.EXPIRES_AT, '2026-12-28T00:00:00.000Z'],
  ];
}

it('inserts one order once, preserving its original details and expiry on retry', async () => {
  expect(await sponsor.insertPurchase(...purchase('order-1'))).toEqual([{ id: 1 }]);
  const retry = purchase('order-1').map(([field, value]) => [field, field === sponsor.EXPIRES_AT ? '2027-01-28T00:00:00.000Z' : value]);
  expect(await sponsor.insertPurchase(...retry)).toEqual([]);
  expect(db.prepare('SELECT id, expires_at FROM sponsor').all()).toEqual([{ id: 1, expires_at: '2026-12-28T00:00:00.000Z' }]);
});

it('allows distinct orders and store packages but suppresses simultaneous duplicate submissions', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => sponsor.insertPurchase(...purchase('order-1'))));
  expect(results.flat()).toHaveLength(1);
  expect(await sponsor.insertPurchase(...purchase('order-2'))).toHaveLength(1);
  expect(await sponsor.insertPurchase(...purchase('order-1', 'com.foxdebug.acode'))).toHaveLength(1);
  expect(db.prepare('SELECT COUNT(*) AS count FROM sponsor').get().count).toBe(3);
});

it('refreshes Apple and Google orders beyond 100 rows while excluding web orders', async () => {
  for (let i = 0; i < 101; i++) await sponsor.insertPurchase(...purchase(`google-${i}`, 'com.foxdebug.acode'));
  for (let i = 0; i < 101; i++) await sponsor.insertPurchase(...purchase(`apple-${i}`));
  await sponsor.insertPurchase(...purchase('web-1', 'web'));
  await sponsor.insertPurchase(...purchase('legacy-1', null));
  const googleGet = vi.fn(async () => ({ data: { purchaseState: 1 } }));
  const appleGet = vi.fn(async () => ({ purchaseState: 1, reason: 'APPLE_REFUND_OR_REVOCATION' }));
  const refresh = load('crons/updateSponsors.js', {
    '../entities/sponsor': sponsor,
    '../lib/sponsorPurchase': purchaseRules,
    '../lib/appleSponsorPurchase': { refreshAppleSponsorPurchase: appleGet },
    '../lib/sponsorError': { logSponsorError: vi.fn() },
    googleapis: { google: { androidpublisher: () => ({ purchases: { products: { get: googleGet } } }) } },
  });
  await refresh();
  expect(googleGet).toHaveBeenCalledTimes(102);
  expect(appleGet).toHaveBeenCalledTimes(101);
  expect(appleGet).toHaveBeenCalledWith('apple-100', 'crystal');
  expect(googleGet.mock.calls.every(([request]) => request.packageName === 'com.foxdebug.acode' || request.packageName === null)).toBe(true);
  expect(db.prepare('SELECT COUNT(*) AS count FROM sponsor WHERE status = 1').get().count).toBe(203);
  expect(db.prepare("SELECT COUNT(*) AS count FROM sponsor WHERE package_name IN ('app.acode', 'web') AND status = 0").get().count).toBe(1);
});

it('recovers missing expiry once after verified payment and preserves expired terms', async () => {
  vi.setSystemTime(new Date('2026-11-28T00:00:00Z'));
  await sponsor.insertPurchase(...purchase('legacy', 'com.foxdebug.acode'));
  db.prepare('UPDATE sponsor SET status = 2, expires_at = NULL WHERE id = 1').run();
  await sponsor.refreshPurchase(1, { purchaseState: 2 });
  expect(db.prepare('SELECT expires_at FROM sponsor WHERE id = 1').get().expires_at).toBeNull();
  await sponsor.refreshPurchase(1, { purchaseState: 0, orderId: 'completed', purchaseTimeMillis });
  expect(db.prepare('SELECT status, order_id, expires_at FROM sponsor WHERE id = 1').get()).toEqual({
    status: 0,
    order_id: 'completed',
    expires_at: '2026-12-20T00:00:00.000Z',
  });
  vi.setSystemTime(new Date('2027-01-28T00:00:00Z'));
  await Promise.all([
    sponsor.refreshPurchase(1, { purchaseState: 0, purchaseTimeMillis }),
    sponsor.refreshPurchase(1, { purchaseState: 0, purchaseTimeMillis }),
  ]);
  expect(db.prepare('SELECT expires_at FROM sponsor WHERE id = 1').get().expires_at).toBe('2026-12-20T00:00:00.000Z');
});

it('the cron repairs pending and already-purchased rows with missing expiry, but never unpaid rows', async () => {
  vi.setSystemTime(new Date('2026-11-28T00:00:00Z'));
  for (const id of ['pending', 'purchased', 'cancelled', 'unpaid']) await sponsor.insertPurchase(...purchase(id, 'com.foxdebug.acode'));
  db.exec("UPDATE sponsor SET expires_at = NULL, token = order_id, status = CASE WHEN order_id = 'purchased' THEN 0 ELSE 2 END");
  const refresh = load('crons/updateSponsors.js', {
    '../entities/sponsor': sponsor,
    '../lib/sponsorPurchase': purchaseRules,
    '../lib/appleSponsorPurchase': { refreshAppleSponsorPurchase: vi.fn() },
    '../lib/sponsorError': { logSponsorError: vi.fn() },
    googleapis: {
      google: {
        androidpublisher: () => ({
          purchases: {
            products: {
              get: async ({ token }) => ({
                data: { purchaseState: { cancelled: 1, unpaid: 2 }[token] ?? 0, orderId: token, purchaseTimeMillis },
              }),
            },
          },
        }),
      },
    },
  });
  await refresh();
  expect(db.prepare('SELECT order_id, expires_at FROM sponsor ORDER BY id').all()).toEqual([
    { order_id: 'pending', expires_at: '2026-12-20T00:00:00.000Z' },
    { order_id: 'purchased', expires_at: '2026-12-20T00:00:00.000Z' },
    { order_id: 'cancelled', expires_at: null },
    { order_id: 'unpaid', expires_at: null },
  ]);
});

it('adds the reason column and indexes order lookups without allowing duplicates', async () => {
  db.exec('ALTER TABLE sponsor DROP COLUMN reason');
  migration.up(db);
  migration.up(db);
  expect(
    db
      .prepare('PRAGMA table_info(sponsor)')
      .all()
      .some((column) => column.name === 'reason'),
  ).toBe(true);
  await sponsor.insertPurchase(...purchase('order-1'));
  expect(db.prepare("EXPLAIN QUERY PLAN SELECT * FROM sponsor WHERE package_name = 'app.acode' AND order_id = 'order-1'").all()[0].detail).toContain(
    'idx_sponsor_purchase_unique',
  );
  expect(() => db.exec("INSERT INTO sponsor (name, token, email, package_name, order_id) VALUES ('n', '', '', 'app.acode', 'order-1')")).toThrow(
    'UNIQUE',
  );
});

it('preserves historical duplicates but blocks new duplicate inserts and key changes', async () => {
  db.exec('DROP INDEX idx_sponsor_purchase_unique');
  db.exec(
    "INSERT INTO sponsor (name, token, email, package_name, order_id) VALUES ('a', '', '', 'app.acode', 'old'), ('b', '', '', 'app.acode', 'old')",
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    migration.up(db);
    migration.up(db);
    expect(db.prepare('SELECT name FROM sponsor ORDER BY id').all()).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(() => db.exec("INSERT INTO sponsor (name, token, email, package_name, order_id) VALUES ('c', '', '', 'app.acode', 'old')")).toThrow(
      'Duplicate',
    );
    await sponsor.insertPurchase(...purchase('new'));
    expect(() => db.exec("UPDATE sponsor SET order_id = 'old' WHERE order_id = 'new'")).toThrow('Duplicate');
    db.exec("UPDATE sponsor SET status = 1, order_id = 'old' WHERE order_id = 'old'");
    expect(db.prepare("EXPLAIN QUERY PLAN SELECT id FROM sponsor WHERE package_name = 'app.acode' AND order_id = 'old'").all()[0].detail).toContain(
      'idx_sponsor_purchase_lookup',
    );
  } finally {
    warn.mockRestore();
  }
});

it('records Apple cancellation reasons and reversals without extending the existing term', async () => {
  await sponsor.insertPurchase(...purchase('appstore:Production:42'));
  await sponsor.refreshPurchase(1, { purchaseState: 1, reason: 'APPLE_REFUND_OR_REVOCATION', purchaseTimeMillis });
  expect(db.prepare('SELECT status, reason, expires_at FROM sponsor').get()).toEqual({
    status: 1,
    reason: 'APPLE_REFUND_OR_REVOCATION',
    expires_at: '2026-12-28T00:00:00.000Z',
  });
  await sponsor.refreshPurchase(1, { purchaseState: 0, purchaseTimeMillis });
  expect(db.prepare('SELECT status, reason, expires_at FROM sponsor').get()).toEqual({
    status: 0,
    reason: null,
    expires_at: '2026-12-28T00:00:00.000Z',
  });
});

it.each([
  [{ code: 'APPLE_STORE_CONFIG_MISSING' }, 1],
  [{ httpStatusCode: 401 }, 1],
  [{ httpStatusCode: 403 }, 1],
  [{ code: 'ETIMEDOUT' }, 3],
  [{ name: 'TypeError' }, 3],
  [{ httpStatusCode: 429 }, 3],
  [{ httpStatusCode: 503 }, 3],
  [{ httpStatusCode: 400, apiError: 4000006 }, 5],
  [{ httpStatusCode: 404 }, 5],
  [{ code: 'INVALID_SPONSOR_PURCHASE' }, 5],
])('limits Apple service failures (%j), preserves rows and continues Google', async (error, attempts) => {
  for (let i = 0; i < 5; i++) await sponsor.insertPurchase(...purchase(`apple-${i}`));
  await sponsor.insertPurchase(...purchase('google-1', 'com.foxdebug.acode'));
  const appleGet = vi.fn().mockRejectedValue(Object.assign(new Error('provider failure'), error));
  const googleGet = vi.fn(async () => ({ data: { purchaseState: 1 } }));
  const log = vi.fn();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const refresh = load('crons/updateSponsors.js', {
    '../entities/sponsor': sponsor,
    '../lib/sponsorPurchase': purchaseRules,
    '../lib/sponsorError': { logSponsorError: log },
    '../lib/appleSponsorPurchase': { refreshAppleSponsorPurchase: appleGet },
    googleapis: { google: { androidpublisher: () => ({ purchases: { products: { get: googleGet } } }) } },
  });
  await refresh();
  expect(appleGet).toHaveBeenCalledTimes(attempts);
  expect(googleGet).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledTimes(attempts);
  expect(warn).toHaveBeenCalledTimes(attempts < 5 ? 1 : 0);
  expect(db.prepare('SELECT status FROM sponsor ORDER BY id').all()).toEqual([...Array.from({ length: 5 }, () => ({ status: 0 })), { status: 1 }]);
  await refresh();
  expect(appleGet).toHaveBeenCalledTimes(attempts * 2);
});

it('resets the Apple failure budget after a successful lookup', async () => {
  for (let i = 0; i < 6; i++) await sponsor.insertPurchase(...purchase(`apple-${i}`));
  const error = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
  const appleGet = vi.fn().mockRejectedValue(error);
  appleGet.mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockResolvedValueOnce({ purchaseState: 1 });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const refresh = load('crons/updateSponsors.js', {
    '../entities/sponsor': sponsor,
    '../lib/sponsorPurchase': purchaseRules,
    '../lib/sponsorError': { logSponsorError: vi.fn() },
    '../lib/appleSponsorPurchase': { refreshAppleSponsorPurchase: appleGet },
    googleapis: { google: { androidpublisher: () => ({ purchases: { products: { get: vi.fn() } } }) } },
  });
  await refresh();
  expect(appleGet).toHaveBeenCalledTimes(6);
  expect(warn).toHaveBeenCalledOnce();
  expect(db.prepare('SELECT status FROM sponsor WHERE id = 3').get().status).toBe(1);
});

it('logs cron errors through the receipt-safe logger and continues to the next order', async () => {
  await sponsor.insertPurchase(...purchase('one', 'com.foxdebug.acode'));
  await sponsor.insertPurchase(...purchase('two', 'com.foxdebug.acode'));
  const error = Object.assign(new Error('secret-receipt'), { config: { params: { token: 'secret-receipt' } } });
  const googleGet = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValueOnce({ data: { purchaseState: 1 } });
  const log = vi.fn();
  const refresh = load('crons/updateSponsors.js', {
    '../entities/sponsor': sponsor,
    '../lib/sponsorPurchase': purchaseRules,
    '../lib/appleSponsorPurchase': { refreshAppleSponsorPurchase: vi.fn() },
    '../lib/sponsorError': { logSponsorError: log },
    googleapis: { google: { androidpublisher: () => ({ purchases: { products: { get: googleGet } } }) } },
  });
  await refresh();
  expect(log).toHaveBeenCalledWith('refresh', error);
  expect(googleGet).toHaveBeenCalledTimes(2);
  expect(db.prepare('SELECT status FROM sponsor WHERE id = 2').get().status).toBe(1);
});
