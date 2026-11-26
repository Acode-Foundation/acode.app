import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import moment from 'moment';
import * as googlePurchaseLib from '../../server/lib/googlePurchase';

let db;
let order;
let plugin;
let googleGet;
let sync;
let calcEarnings;
let checkAccounting;
let Entity;
let appConfig;
let reviews;

function load(relativePath, dependencies) {
  const filename = path.resolve(import.meta.dirname, '../../server', relativePath);
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      module,
      console,
      process: { argv: [] },
      require(name) {
        if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
        return dependencies[name];
      },
    },
    { filename },
  );
  return module.exports;
}

beforeEach(() => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-11-20T12:00:00Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db = new Database(':memory:');
  // Real entity queries against an isolated database, never the application's copy.
  db.pragma('foreign_keys = OFF');
  Entity = load('entities/entity.js', { '../lib/db': db });
  order = load('entities/purchaseOrder.js', { './entity': Entity });
  db.prepare(`INSERT INTO purchase_order (id, plugin_id, package, token, order_id, amount, state, created_at)
    VALUES (1, 'test.plugin', 'test.package', 'pending-token', 'GPA.test', 0, 2, '2026-10-31 12:00:00')`).run();
  plugin = { id: 'test.plugin', sku: 'test-sku', price: 100, user_id: 7 };
  const Plugin = {
    ID: 'id',
    SKU: 'sku',
    PRICE: 'price',
    USER_ID: 'user_id',
    for() {
      return this;
    },
    get: vi.fn(async () => [{ ...plugin }]),
  };
  googleGet = vi.fn(async () => ({ data: { purchaseState: 0, orderId: 'GPA.test' } }));
  const userEarnings = load('entities/userEarnings.js', { './entity': Entity });
  appConfig = load('entities/appConfig.js', { './entity': Entity, '../../constants.mjs': { PAYMENT_THRESHOLD: 10000 } });
  reviews = load('lib/earningsReview.js', { '../entities/appConfig': appConfig, '../entities/entity': Entity, 'node:crypto': crypto });
  checkAccounting = load('lib/checkGooglePurchaseAccounting.js', {
    moment,
    '../entities/plugin': Plugin,
    '../entities/userEarnings': userEarnings,
    './earningsReview': reviews,
  });
  const updateOrders = load('lib/updateOrders.js', {
    moment,
    '../entities/purchaseOrder': order,
    '../entities/plugin': Plugin,
    './googlePurchase': googlePurchaseLib,
    './checkGooglePurchaseAccounting': checkAccounting,
  });
  sync = () =>
    updateOrders('2026-11-01', '2026-11-30', {
      androidpublisher: () => ({ purchases: { products: { get: googleGet } } }),
    });
  calcEarnings = load('lib/calcEarnings.js', {
    './earningsReview': {},
    moment,
    '../entities/purchaseOrder': order,
    '../entities/plugin': Plugin,
    '../entities/download': {},
    '../entities/userEarnings': {},
    '../entities/razorpayOrder': {},
  });
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

function savedOrder() {
  return db.prepare('SELECT * FROM purchase_order WHERE id = 1').get();
}

it('recognizes an old pending purchase in its completion month and preserves it on repeat sync', async () => {
  // October is outside the daily window after November 15, but pending orders still need validation.
  await sync();
  expect(savedOrder()).toMatchObject({ state: 0, amount: 100, created_at: '2026-11-20 12:00:00' });
  await expect(calcEarnings.fromPaidPlugins(2026, 9, { id: 7 }, [])).resolves.toBe(0);
  await expect(calcEarnings.fromPaidPlugins(2026, 10, { id: 7 }, [])).resolves.toBe(70);
  await expect(calcEarnings.fromPaidPlugins(2026, 10, { id: 7 }, [{ Description: 'GPA.test', 'Amount (Merchant Currency)': '85' }])).resolves.toBe(
    72.25,
  );
  moment.now.mockReturnValue(Date.parse('2026-11-21T12:00:00Z'));
  await sync();
  expect(savedOrder()).toMatchObject({ state: 0, amount: 85, created_at: '2026-11-20 12:00:00' });
});

it('keeps a valid pending estimate even when the current price is unavailable', async () => {
  db.prepare('UPDATE purchase_order SET amount = 80').run();
  plugin.price = undefined;
  await sync();
  expect(savedOrder()).toMatchObject({ state: 0, amount: 80, created_at: '2026-11-20 12:00:00' });
});

it('does not promote or move an order if its zeroed estimate cannot be restored', async () => {
  plugin.price = undefined;
  await expect(sync()).rejects.toThrow('Google purchase sync failed');
  expect(savedOrder()).toMatchObject({ state: 2, amount: 0, created_at: '2026-10-31 12:00:00' });
  expect(console.error).toHaveBeenCalledWith('Error updating order %s: %s', 'GPA.test', 'Purchase amount unavailable.');
});

it.each([2, 1])('does not recognize earnings while Google reports state %s', async (purchaseState) => {
  googleGet.mockResolvedValue({ data: { purchaseState, orderId: 'GPA.test' } });
  await sync();
  expect(savedOrder()).toMatchObject({ state: purchaseState, amount: 0, created_at: '2026-10-31 12:00:00' });
});

it.each([0, 1])('does not overwrite a concurrent API transition to state %s', async (state) => {
  googleGet.mockImplementation(async () => {
    db.prepare('UPDATE purchase_order SET state = ?, amount = 80, created_at = ? WHERE id = 1').run(state, '2026-11-19 12:00:00');
    return { data: { purchaseState: 0, orderId: 'GPA.test' } };
  });
  await sync();
  expect(savedOrder()).toMatchObject({ state, amount: 80, created_at: '2026-11-19 12:00:00' });
});

it('discards a stale pending response after the API completes the purchase', async () => {
  googleGet.mockImplementation(async () => {
    db.prepare("UPDATE purchase_order SET state = 0, amount = 80, created_at = '2026-11-19 12:00:00'").run();
    return { data: { purchaseState: 2, orderId: 'GPA.test' } };
  });
  await sync();
  expect(savedOrder()).toMatchObject({ state: 0, amount: 80, created_at: '2026-11-19 12:00:00' });
});

it('keeps the estimate when another pending sync zeroes it during validation', async () => {
  db.prepare('UPDATE purchase_order SET amount = 80').run();
  googleGet.mockImplementation(async () => {
    db.prepare('UPDATE purchase_order SET amount = 0').run();
    return { data: { purchaseState: 0, orderId: 'GPA.test' } };
  });
  await sync();
  expect(savedOrder()).toMatchObject({ state: 0, amount: 80, created_at: '2026-11-20 12:00:00' });
});

it('discards validation of a token that was replaced while the provider call was pending', async () => {
  googleGet.mockImplementation(async () => {
    db.prepare("UPDATE purchase_order SET token = 'replacement'").run();
    return { data: { purchaseState: 0, orderId: 'GPA.test' } };
  });
  await sync();
  expect(savedOrder()).toMatchObject({ token: 'replacement', state: 2, amount: 0 });
});

it('includes legacy Google pending rows without pulling Razorpay or old completed rows into the sync', async () => {
  db.prepare('UPDATE purchase_order SET provider = NULL').run();
  db.prepare(`INSERT INTO purchase_order (plugin_id, package, token, amount, state, provider, created_at)
    VALUES ('test.plugin', 'test.package', ?, 100, ?, ?, '2026-10-31 12:00:00')`).run('razorpay', 2, 'razorpay');
  db.prepare(`INSERT INTO purchase_order (plugin_id, package, token, amount, state, provider, created_at)
    VALUES ('test.plugin', 'test.package', ?, 100, ?, ?, '2026-10-31 12:00:00')`).run('completed', 0, 'google_play');
  await sync();
  expect(googleGet).toHaveBeenCalledOnce();
  expect(savedOrder()).toMatchObject({ state: 0, amount: 100 });
});

it.each(['2', '2.0'])('finds and promotes legacy TEXT state %s through the real entity query', async (state) => {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'purchase_order'").get();
  db.exec('DROP TABLE purchase_order');
  db.exec(sql.replace('state INTEGER', 'state TEXT'));
  // Loading the entity must not silently replace the pre-existing TEXT schema.
  load('entities/purchaseOrder.js', { './entity': Entity });
  db.prepare(`INSERT INTO purchase_order (id, plugin_id, package, token, amount, state, created_at)
    VALUES (1, 'test.plugin', 'test.package', 'legacy', 100, ?, '2026-10-31 12:00:00')`).run(state);
  expect(db.prepare('SELECT typeof(state) AS type FROM purchase_order').get().type).toBe('text');
  await sync();
  expect(Number(savedOrder().state)).toBe(0);
  expect(savedOrder()).toMatchObject({ amount: 100, created_at: '2026-11-20 12:00:00' });
});

it.each([null, 42])(
  'completes a pending purchase and holds its developer when a legacy month already has earnings (payment %s)',
  async (paymentId) => {
    db.prepare('INSERT INTO user_earnings (user_id, amount, month, year, payment_id) VALUES (7, 500, 9, 2026, ?)').run(paymentId);
    db.prepare(`INSERT INTO purchase_order (id, plugin_id, package, token, order_id, amount, state, created_at)
    VALUES (2, 'test.plugin', 'test.package', 'other', 'GPA.other', 100, 2, '2026-09-30 12:00:00')`).run();
    await expect(sync()).rejects.toThrow('Google purchase accounting held for review: order 1 (user 7, 2026-10)');
    // The buyer's purchase completes; only the developer's original month is held.
    expect(savedOrder()).toMatchObject({ state: 0, amount: 100, created_at: '2026-11-20 12:00:00' });
    expect(db.prepare('SELECT state FROM purchase_order WHERE id = 2').get().state).toBe(0);
    expect(db.prepare('SELECT amount, payment_id FROM user_earnings').get()).toEqual({ amount: 500, payment_id: paymentId });
    await expect(reviews.list(7)).resolves.toEqual([{ year: 2026, month: 9, code: 'GOOGLE_PURCHASE_REVIEW_REQUIRED' }]);
    // The admin can find the order and its original date, which completion overwrote.
    const original = db.prepare('SELECT order_id, plugin_id FROM purchase_order WHERE id = 1').get();
    expect((await reviews.listAll()).holds[0].orders).toEqual([
      {
        id: 1,
        orderId: original.order_id ?? null,
        pluginId: original.plugin_id,
        createdAt: expect.stringMatching(/^2026-10-/),
        code: 'GOOGLE_PURCHASE_REVIEW_REQUIRED',
      },
    ]);
    // The completed order is not reported again.
    await expect(sync()).resolves.toBeUndefined();
  },
);

it('does not hold a month first calculated after pending orders were excluded', async () => {
  await reviews.markPendingExcluded('2026-11-16 00:00:00');
  db.prepare(`INSERT INTO user_earnings (user_id, amount, month, year, created_at, updated_at)
    VALUES (7, 500, 9, 2026, '2026-11-16 00:00:05', '2026-11-16 00:00:05')`).run();
  await expect(sync()).resolves.toBeUndefined();
  expect(savedOrder()).toMatchObject({ state: 0, amount: 100 });
  await expect(reviews.list(7)).resolves.toEqual([]);
});

it('still holds a legacy month whose row was only marked paid after the cutoff', async () => {
  await reviews.markPendingExcluded('2026-11-16 00:00:00');
  db.prepare(`INSERT INTO user_earnings (user_id, amount, month, year, payment_id, created_at, updated_at)
    VALUES (7, 500, 9, 2026, 42, '2026-10-16 00:00:00', '2026-11-16 00:00:05')`).run();
  await expect(sync()).rejects.toThrow('Google purchase accounting held for review');
  await expect(reviews.list(7)).resolves.toHaveLength(1);
});

it('holds a purchase if its original accounting date is missing', async () => {
  await expect(checkAccounting({ ...savedOrder(), created_at: null })).rejects.toMatchObject({ code: 'GOOGLE_PURCHASE_REVIEW_REQUIRED' });
});

it.each([false, true])('holds when any duplicate earnings row is legacy (legacy inserted first: %s)', async (legacyFirst) => {
  await reviews.markPendingExcluded('2026-11-16 00:00:00');
  const dates = ['2026-11-16 00:00:05', '2026-10-16 00:00:00'];
  if (legacyFirst) dates.reverse();
  for (const date of dates) {
    db.prepare('INSERT INTO user_earnings (user_id, amount, month, year, created_at) VALUES (7, 500, 9, 2026, ?)').run(date);
  }
  await expect(sync()).rejects.toThrow('Google purchase accounting held for review');
  expect(savedOrder().state).toBe(0);
  expect(await reviews.list(7)).toHaveLength(1);
});

it.each(['2026-11-16T00:00:01Z', 'invalid', null])('keeps an older or unknown timestamp held: %s', async (created) => {
  await reviews.markPendingExcluded('2026-11-16 12:00:00');
  db.prepare('INSERT INTO user_earnings (user_id, amount, month, year, created_at) VALUES (7, 500, 9, 2026, ?)').run(created);
  await expect(sync()).rejects.toThrow('Google purchase accounting held for review');
  expect(await reviews.list(7)).toHaveLength(1);
});

it('reports a failed guarded order write while retaining its conservative hold', async () => {
  db.prepare('INSERT INTO user_earnings (user_id, amount, month, year) VALUES (7, 500, 9, 2026)').run();
  vi.spyOn(order, 'update').mockRejectedValueOnce(new Error('Fixture write failure'));
  await expect(sync()).rejects.toThrow('Google purchase sync failed (purchase_order IDs): 1');
  expect(savedOrder().state).toBe(2);
  expect(await reviews.list(7)).toHaveLength(1);
});

it('logs missing developer attribution without inventing a hold owner', async () => {
  plugin.user_id = null;
  await expect(checkAccounting(savedOrder())).resolves.toBeNull();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no developer attribution'), 1, 'test.plugin');
  await expect(reviews.listAll()).resolves.toEqual({ holds: [], invalidMarkers: [] });
});
