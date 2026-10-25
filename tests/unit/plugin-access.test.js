import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import { Router } from 'express';
import JSZip from 'jszip';
import * as apiKeyLib from '../../server/lib/apiKey';
import * as pluginSearch from '../../server/lib/pluginSearch';

const filename = path.resolve(import.meta.dirname, '../../server/apis/plugin.js');
const source = fs.readFileSync(filename, 'utf8');
const paidPlugin = { id: 'test.plugin', sku: 'plugin_test', price: 100, user_id: 2, status: 1, status_text: 'approved' };
let plugin;
let order;
let download;
let helpers;
let googlePurchase;
let razorpayPayment;
let router;
let apiKeyAuth;
let sendEmail;
let apiKeyEntity;

beforeEach(() => {
  apiKeyAuth = null;
  sendEmail = vi.fn().mockResolvedValue();
  apiKeyEntity = { addPlugin: vi.fn().mockReturnValue(true) };
  plugin = {
    ID: 'id',
    NAME: 'name',
    AUTHOR: 'author',
    USER_ID: 'user_id',
    STATUS: 'status',
    SUPPORTED_EDITOR: 'supported_editor',
    DOWNLOADS: 'downloads',
    STATUS_APPROVED: 1,
    STATUS_DELETED: 3,
    get minColumns() {
      return ['id', 'price'];
    },
    get: vi.fn().mockImplementation(async () => [{ ...paidPlugin }]),
    increment: vi.fn(),
    count: vi.fn().mockResolvedValue(4),
  };
  order = {
    ID: 'id',
    TOKEN: 'token',
    PROVIDER: 'provider',
    PACKAGE: 'package',
    USER_ID: 'user_id',
    PLUGIN_ID: 'plugin_id',
    STATE: 'state',
    AMOUNT: 'amount',
    STATE_PURCHASED: 0,
    STATE_CANCELED: 1,
    PROVIDER_RAZORPAY: 'razorpay',
    PROVIDER_GOOGLE_PLAY: 'google_play',
    for() {
      return this;
    },
    get: vi.fn().mockResolvedValue([]),
    insert: vi.fn(),
    update: vi.fn(),
  };
  download = {
    CLIENT_IP: 'client_ip',
    PLUGIN_ID: 'plugin_id',
    DEVICE_ID: 'device_id',
    PACKAGE_NAME: 'package_name',
    count: vi.fn().mockResolvedValue(0),
    get: vi.fn().mockResolvedValue([]),
    insert: vi.fn(),
  };
  helpers = {
    getLoggedInUser: vi.fn().mockResolvedValue(null),
    getWebLoggedInUser: vi.fn().mockResolvedValue(null),
    getPluginSKU: (id) => `plugin_${id}`,
    detectUserCurrency: () => ({ code: 'USD' }),
    formatAmount: (amount) => amount.toFixed(2),
  };
  googlePurchase = vi.fn().mockResolvedValue({ data: { purchaseState: 0 } });
  razorpayPayment = vi.fn().mockResolvedValue({ status: 'captured' });
  const dependencies = {
    'node:crypto': {},
    'node:fs': { promises: { writeFile: vi.fn() } },
    'node:path': path,
    jszip: JSZip,
    moment: {},
    express: { Router },
    googleapis: { google: { androidpublisher: () => ({ purchases: { products: { get: googlePurchase } } }) } },
    '../entities/plugin': plugin,
    '../entities/user': {},
    '../entities/purchaseOrder': order,
    '../entities/download': download,
    '../entities/pluginScan': {},
    '../entities/apiKey': apiKeyEntity,
    '../badWords.json': [],
    '../lib/helpers': helpers,
    '../lib/apiKeyAuth': { getApiKeyAuth: async () => apiKeyAuth },
    '../lib/apiKey': apiKeyLib,
    '../lib/razorpay': () => ({ payments: { fetch: razorpayPayment } }),
    '../lib/sendEmail': sendEmail,
    '../lib/exchangeRates': { convertPrice: async (amount) => ({ amount: amount / 10, currency: 'USD', symbol: '$' }) },
    '../lib/modeRegex': {},
    '../lib/pluginScanner': { createKeyedLock: () => (_key, task) => task(), fileInDir: (dir, name) => path.join(dir, name) },
    '../lib/db': {},
    '../lib/pluginLicense': { LICENSES: [], normalizeLicense: (license) => license },
    '../lib/pluginSearch': pluginSearch,
    '../lib/rateLimits': {
      pluginUploadLimiter: (_req, _res, next) => next(),
      pluginAdminLimiter: (_req, _res, next) => next(),
      pluginScanReadLimiter: (_req, _res, next) => next(),
    },
  };
  const module = { exports: {} };
  // Load the real routes, but prohibit any unmocked import from opening the app database or contacting a provider.
  vm.runInNewContext(
    source,
    {
      module,
      __dirname: path.dirname(filename),
      process: { env: { HOST: 'https://acode.app' } },
      require(name) {
        if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
        return dependencies[name];
      },
    },
    { filename },
  );
  router = module.exports;
});

async function request(routePath, { params = {}, query = {} } = {}) {
  const req = { params, query, headers: {}, ip: '127.0.0.1' };
  const res = { statusCode: 200, send: vi.fn(), sendFile: vi.fn() };
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  const route = router.stack.find((layer) => layer.route?.path === routePath).route;
  await route.stack[0].handle(req, res);
  return res;
}

const downloadPlugin = (query = {}) => request('/download/:id', { params: { id: paidPlugin.id }, query });
const getPlugin = (query = {}) => request('{/:pluginId}', { params: { pluginId: paidPlugin.id }, query });

function expectNoPurchaseActivity() {
  expect(order.get).not.toHaveBeenCalled();
  expect(order.insert).not.toHaveBeenCalled();
  expect(order.update).not.toHaveBeenCalled();
  expect(googlePurchase).not.toHaveBeenCalled();
  expect(razorpayPayment).not.toHaveBeenCalled();
}

describe('paid plugin download access', () => {
  it.each(['web', 'app'])('allows a %s admin without a purchase or token and records the download', async (authType) => {
    helpers.getLoggedInUser.mockResolvedValue({ id: 9, isAdmin: true, authType });
    const res = await downloadPlugin({ device: 'test-device', package: 'com.foxdebug.acode' });

    expect(res.statusCode).toBe(200);
    expect(res.sendFile).toHaveBeenCalledExactlyOnceWith(path.resolve(path.dirname(filename), '../../data/plugins/test.plugin.zip'));
    expectNoPurchaseActivity();
    expect(download.insert).toHaveBeenCalledWith(
      ['plugin_id', paidPlugin.id],
      ['device_id', 'test-device'],
      ['client_ip', '127.0.0.1'],
      ['package_name', 'com.foxdebug.acode'],
    );
    expect(plugin.increment).toHaveBeenCalledWith('downloads', 1, ['id', paidPlugin.id]);
  });

  it.each(['web', 'app'])('does not let a canceled purchase or invalid token block a %s admin', async (authType) => {
    helpers.getLoggedInUser.mockResolvedValue({ id: 9, isAdmin: true, authType });
    order.get.mockResolvedValue([{ id: 10, state: order.STATE_CANCELED }]);
    const res = await downloadPlugin({ token: 'invalid', package: 'com.foxdebug.acode' });
    expect(res.sendFile).toHaveBeenCalledOnce();
    expectNoPurchaseActivity();
  });

  it('allows an admin to download an unpublished package', async () => {
    helpers.getLoggedInUser.mockResolvedValue({ id: 9, isAdmin: true, authType: 'app' });
    plugin.get.mockResolvedValue([{ ...paidPlugin, status: 0, status_text: 'pending' }]);
    expect((await downloadPlugin()).sendFile).toHaveBeenCalledOnce();
  });

  it.each([null, { id: 3, authType: 'app' }, { id: 2, authType: 'web' }])('rejects unpaid non-admin access for %j', async (user) => {
    helpers.getLoggedInUser.mockResolvedValue(user);
    const res = await downloadPlugin({ isAdmin: 'true' });
    expect(res.statusCode).toBe(403);
    expect(res.sendFile).not.toHaveBeenCalled();
    expect(order.insert).not.toHaveBeenCalled();
  });

  it.each(['razorpay', 'google_play'])('retains verification of a valid user-linked %s purchase', async (provider) => {
    helpers.getLoggedInUser.mockResolvedValue({ id: 3, authType: 'app' });
    order.get.mockResolvedValue([{ id: 10, token: 'valid', provider, package: 'com.foxdebug.acode' }]);
    expect((await downloadPlugin()).sendFile).toHaveBeenCalledOnce();
    expect(provider === 'razorpay' ? razorpayPayment : googlePurchase).toHaveBeenCalledOnce();
    expect(order.update).not.toHaveBeenCalled();
  });

  it('still rejects and cancels a revoked user-linked purchase', async () => {
    helpers.getLoggedInUser.mockResolvedValue({ id: 3, authType: 'app' });
    order.get.mockResolvedValue([{ id: 10, token: 'revoked', provider: 'razorpay' }]);
    razorpayPayment.mockResolvedValue({ status: 'refunded' });
    const res = await downloadPlugin();
    expect(res.statusCode).toBe(403);
    expect(res.sendFile).not.toHaveBeenCalled();
    expect(order.update).toHaveBeenCalledWith([['state', 1]], ['id', 10]);
  });

  it('retains Google Play token validation without a user session', async () => {
    const res = await downloadPlugin({ token: 'valid', package: 'com.foxdebug.acode' });
    expect(res.sendFile).toHaveBeenCalledOnce();
    expect(googlePurchase).toHaveBeenCalledWith({ packageName: 'com.foxdebug.acode', productId: paidPlugin.sku, token: 'valid' });
    expect(order.insert).toHaveBeenCalledOnce();
  });

  it('rejects a canceled token purchase before contacting Google Play', async () => {
    order.get.mockResolvedValue([{ state: order.STATE_CANCELED }]);
    const res = await downloadPlugin({ token: 'canceled', package: 'com.foxdebug.acode' });
    expect(res.statusCode).toBe(403);
    expect(res.sendFile).not.toHaveBeenCalled();
    expect(googlePurchase).not.toHaveBeenCalled();
  });

  it('does not let a token recorded for another plugin unlock this one', async () => {
    order.get.mockResolvedValue([{ state: order.STATE_PURCHASED, plugin_id: 'other.plugin' }]);
    const res = await downloadPlugin({ token: 'valid', package: 'com.foxdebug.acode' });
    expect(res.statusCode).toBe(403);
    expect(res.sendFile).not.toHaveBeenCalled();
    expect(googlePurchase).not.toHaveBeenCalled();
  });

  it('accepts a token recorded for this plugin', async () => {
    order.get.mockResolvedValue([{ state: order.STATE_PURCHASED, plugin_id: paidPlugin.id }]);
    const res = await downloadPlugin({ token: 'valid', package: 'com.foxdebug.acode' });
    expect(res.sendFile).toHaveBeenCalledOnce();
    expect(order.insert).not.toHaveBeenCalled();
  });

  it('retains the missing-plugin response for admins', async () => {
    helpers.getLoggedInUser.mockResolvedValue({ id: 9, isAdmin: true });
    plugin.get.mockResolvedValue([]);
    const res = await downloadPlugin();
    expect(res.statusCode).toBe(404);
    expect(res.sendFile).not.toHaveBeenCalled();
  });
});

describe('unapproved packages', () => {
  const unapproved = (status) => ({ ...paidPlugin, price: 0, status, version: '2.0.0' });

  it.each([0, 2, 3])('are not downloadable by other users (status %s)', async (status) => {
    plugin.get.mockResolvedValue([unapproved(status)]);
    for (const user of [null, { id: 3, authType: 'app' }]) {
      helpers.getLoggedInUser.mockResolvedValue(user);
      const res = await downloadPlugin();
      expect(res.statusCode).toBe(404);
      expect(res.sendFile).not.toHaveBeenCalled();
    }
  });

  it('stay downloadable by their owner and by admins', async () => {
    plugin.get.mockResolvedValue([unapproved(0)]);
    helpers.getLoggedInUser.mockResolvedValue({ id: paidPlugin.user_id, authType: 'app' });
    expect((await downloadPlugin()).sendFile).toHaveBeenCalledOnce();
    helpers.getLoggedInUser.mockResolvedValue({ id: 9, isAdmin: true, authType: 'web' });
    expect((await downloadPlugin()).sendFile).toHaveBeenCalledOnce();
  });

  it('are not offered as updates to installed copies', async () => {
    const checkUpdate = () => request('/check-update/:id/:version', { params: { id: paidPlugin.id, version: '1.0.0' } });
    plugin.get.mockResolvedValue([unapproved(3)]);
    expect((await checkUpdate()).send).toHaveBeenCalledWith({ update: false, version: '2.0.0' });
    plugin.get.mockResolvedValue([{ ...unapproved(1) }]);
    expect((await checkUpdate()).send).toHaveBeenCalledWith({ update: true, version: '2.0.0' });
  });
});

describe('plugin install entitlement', () => {
  it.each(['web', 'app', undefined])('limits automatic admin ownership to app sessions (authType=%s)', async (authType) => {
    helpers.getLoggedInUser.mockResolvedValue({ id: 9, isAdmin: true, authType });
    const detail = await getPlugin();
    const list = await request('{/:pluginId}');
    const expected = expect.objectContaining({ owned: authType === 'app', price: '10.00', currency: 'USD', currencySymbol: '$' });
    expect(detail.send).toHaveBeenCalledWith(expected);
    expect(list.send).toHaveBeenCalledWith([expected]);
    if (authType === 'app') expectNoPurchaseActivity();
    else expect(order.get).toHaveBeenCalledTimes(2);
    expect(order.insert).not.toHaveBeenCalled();
    expect(order.update).not.toHaveBeenCalled();
  });

  it.each([
    { id: 3, authType: 'web' },
    { id: 3, authType: 'app' },
    { id: 9, isAdmin: true, authType: 'web' },
  ])('uses actual purchases for %j', async (user) => {
    helpers.getLoggedInUser.mockResolvedValue(user);
    expect((await getPlugin()).send).toHaveBeenCalledWith(expect.objectContaining({ owned: false }));
    order.get.mockResolvedValue([{ plugin_id: paidPlugin.id }]);
    expect((await getPlugin()).send).toHaveBeenCalledWith(expect.objectContaining({ owned: true }));
    expect(order.get).toHaveBeenLastCalledWith(
      ['plugin_id'],
      [
        ['user_id', user.id],
        ['plugin_id', [paidPlugin.id], 'IN'],
        ['state', 0],
      ],
    );
    expect((await request('{/:pluginId}')).send).toHaveBeenCalledWith([expect.objectContaining({ owned: true })]);
    expect(order.insert).not.toHaveBeenCalled();
    expect(order.update).not.toHaveBeenCalled();
  });

  it.each(['web', 'app'])('keeps the owned filter purchase-based for %s admins', async (authType) => {
    helpers.getLoggedInUser.mockResolvedValue({ id: 9, isAdmin: true, authType });
    expect((await request('{/:pluginId}', { query: { owned: 'true' } })).send).toHaveBeenCalledWith([]);
    expect(plugin.get).not.toHaveBeenCalled();
    order.get.mockResolvedValue([{ plugin_id: paidPlugin.id }]);
    await request('{/:pluginId}', { query: { owned: 'true' } });
    expect(plugin.get.mock.calls[0][1]).toContainEqual(['id', [paidPlugin.id], 'IN']);
    expect(order.get).toHaveBeenCalledTimes(authType === 'app' ? 2 : 3);
    expect(order.insert).not.toHaveBeenCalled();
  });
});

describe('plugin list sorting and filters', () => {
  const listOptions = async (query) => {
    await request('{/:pluginId}', { query });
    return plugin.get.mock.calls.at(-1)[2];
  };
  const listWhere = async (query) => {
    await request('{/:pluginId}', { query });
    return plugin.get.mock.calls.at(-1)[1];
  };

  it.each(['popular', 'downloads', 'trending', 'rating'])('puts public featured plugins first and boosts verified authors in %s', async (sort) => {
    const db = new Database(':memory:');
    try {
      db.exec(`CREATE TABLE listing (id TEXT, downloads TEXT, author_verified INTEGER, votes_up INTEGER, votes_down INTEGER,
          comment_count INTEGER DEFAULT 0, updated_at TEXT DEFAULT '2026-01-01', status INTEGER DEFAULT 1, featured INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE download (plugin_id TEXT, created_at TEXT);
        INSERT INTO listing (id, downloads, author_verified, votes_up, votes_down) VALUES
          ('verified', '90', 1, 8, 12), ('regular', '100', 0, 9, 13), ('strong', '150', 0, 15, 0), ('small', '9', NULL, 0, 1);`);
      const insert = db.prepare("INSERT INTO download VALUES (?, datetime('now'))");
      for (const [id, count] of [
        ['verified', 9],
        ['regular', 10],
        ['strong', 16],
        ['small', 1],
      ]) {
        for (let i = 0; i < count; i++) insert.run(id);
      }
      const { orderBy } = await listOptions({ orderBy: sort });
      const rankedIds = () =>
        db
          .prepare(`SELECT id FROM listing ORDER BY ${orderBy.join(',')}`)
          .all()
          .map((r) => r.id);
      expect(rankedIds()).toEqual(['strong', 'verified', 'regular', 'small']);
      db.prepare('UPDATE listing SET featured = 1 WHERE id IN (?, ?)').run('regular', 'small');
      expect(rankedIds()).toEqual(['regular', 'small', 'strong', 'verified']);
      db.prepare('UPDATE listing SET status = 2 WHERE id IN (?, ?)').run('regular', 'small');
      expect(rankedIds()).toEqual(['strong', 'verified', 'regular', 'small']);
    } finally {
      db.close();
    }
  });

  it.each(['trending', 'rating', 'updated', 'newest', 'name'])('supports the %s sort', async (orderBy) => {
    const { orderBy: sort } = await listOptions({ orderBy });
    expect(Array.isArray(sort)).toBe(true);
    expect(sort).not.toEqual((await listOptions({})).orderBy);
  });

  it.each(['popular', 'trending', 'downloads', 'rating', 'updated', 'newest', 'name'])(
    'ends the %s sort with the unique id so pages stay stable',
    async (orderBy) => {
      expect((await listOptions({ orderBy })).orderBy.at(-1)).toBe('id ASC');
    },
  );

  it.each(['unknown', 'constructor', '__proto__'])('falls back to popular for %s', async (orderBy) => {
    expect((await listOptions({ orderBy })).orderBy).toEqual((await listOptions({})).orderBy);
  });

  it('searches names, ids, keywords and authors, closest matches first in the default order', async () => {
    const where = await listWhere({ name: 'Python LSP' });
    expect(where).toEqual(expect.arrayContaining(pluginSearch.pluginSearchWhere('Python LSP')));
    expect(where).toContainEqual(['keywords', 'LSP', 'LIKE']);
    const popular = await listOptions({ name: 'Python LSP' });
    const rank = pluginSearch.pluginSearchRank('Python LSP');
    expect(popular.orderBy).toEqual([...rank.orderBy, ...(await listOptions({})).orderBy]);
    expect(popular.orderValues).toEqual(['Python LSP', 'Python LSP%', '%Python LSP%', '%Python%', '%LSP%', '%Python LSP%']);
    expect(await listOptions({ name: 'Python LSP', orderBy: 'updated' })).not.toHaveProperty('orderValues');
    expect(await listOptions({ name: 'mode:python' })).not.toHaveProperty('orderValues');
  });

  it('filters by price', async () => {
    expect(await listWhere({ price: 'free' })).toContainEqual(['IFNULL(price, 0)', 0]);
    expect(await listWhere({ price: 'paid' })).toContainEqual(['IFNULL(price, 0)', 0, '>']);
    expect(await listWhere({ price: 'other' })).not.toContainEqual(expect.arrayContaining(['IFNULL(price, 0)']));
  });

  it.each(['/api/plugin', '/api/plugins'])('keeps the home plugin detail reachable through %s', async (prefix) => {
    plugin.get.mockResolvedValue([{ ...paidPlugin, id: 'home', price: 0 }]);
    const mounted = Router();
    mounted.use(prefix, router);
    const result = await new Promise((resolve, reject) => {
      const res = { send: resolve, status: () => res };
      mounted.handle({ method: 'GET', url: `${prefix}/home`, query: {}, headers: {} }, res, reject);
    });
    expect(result).toMatchObject({ id: 'home', price: 0 });
    expect(plugin.count).not.toHaveBeenCalled();
  });

  it('returns only home card fields for up to 12 public plugins, even for an admin', async () => {
    helpers.getLoggedInUser.mockResolvedValue({ id: 9, isAdmin: true, authType: 'web' });
    const cards = [{ id: 'example', name: 'Example', author: 'Author', downloads: '100' }];
    plugin.get.mockResolvedValue(cards);
    const res = await request('/home/list', { query: { limit: '1000', page: '2', status: '3' } });
    expect(plugin.count).toHaveBeenCalledWith(['status', 1]);
    expect(plugin.get).toHaveBeenCalledWith(['id', 'name', 'author', 'downloads'], ['status', 1], {
      limit: 12,
      orderBy: (await listOptions({ orderBy: 'downloads' })).orderBy,
    });
    expect(res.send).toHaveBeenCalledWith({ count: 4, plugins: cards });
  });
});

describe('plugin list query parsing', () => {
  it('ignores repeated params instead of failing on an array', async () => {
    const res = await request('{/:pluginId}', { query: { name: ['mode:js', 'x'], orderBy: ['name'], price: ['free'] } });
    expect(res.statusCode).toBe(200);
    const [, where, options] = plugin.get.mock.calls.at(-1);
    expect(where).not.toContainEqual(expect.arrayContaining(['name']));
    expect(where).not.toContainEqual(expect.arrayContaining(['IFNULL(price, 0)']));
    expect(options.orderBy).toEqual(expect.arrayContaining([expect.stringContaining('votes_up *')]));
  });

  it('passes page and limit as positive integers only', async () => {
    await request('{/:pluginId}', { query: { page: '2', limit: '30' } });
    expect(plugin.get.mock.calls.at(-1)[2]).toMatchObject({ page: 2, limit: 30 });
    await request('{/:pluginId}', { query: { page: '-1', limit: 'abc' } });
    expect(plugin.get.mock.calls.at(-1)[2]).toMatchObject({ page: undefined, limit: undefined });
  });
});

describe('publishing with an API key', () => {
  const owner = { id: 2, name: 'Dev', email: 'dev@example.com', isAdmin: false, authType: 'api_key' };
  const keyFor = (pluginIds, scopes = [apiKeyLib.SCOPE_PLUGIN_PUBLISH]) => ({
    key: { id: 1, user_id: 2, name: 'Release <CI>', token_prefix: 'acode_Ab12', scopes, plugin_ids: pluginIds },
    user: owner,
  });

  beforeEach(() => {
    plugin.get.mockResolvedValue([{ ...paidPlugin, version: '1.0.0', name: 'Test', price: 100 }]);
  });

  async function publish(manifest, { method = 'put', authorization = 'Bearer acode_key', body = {}, files = {} } = {}) {
    const zip = new JSZip();
    zip.file('plugin.json', JSON.stringify({ id: paidPlugin.id, name: 'Test', main: 'main.js', version: '0.9.0', price: 100, ...manifest }));
    zip.file('icon.png', 'icon');
    zip.file('readme.md', '# Test');
    for (const [name, content] of Object.entries(files)) zip.file(name, content);
    const req = {
      headers: { authorization },
      ip: '203.0.113.9',
      files: { plugin: { data: await zip.generateAsync({ type: 'nodebuffer' }) } },
      body,
    };
    const res = { statusCode: 200, send: vi.fn() };
    res.status = vi.fn((code) => {
      res.statusCode = code;
      return res;
    });
    const route = router.stack.find((layer) => layer.route?.path === '/' && layer.route.methods[method]).route;
    await route.stack.at(-1).handle(req, res);
    return res;
  }

  it('passes a rejected key error through without falling back to the session', async () => {
    apiKeyAuth = { status: 401, error: 'Invalid API key.' };
    helpers.getWebLoggedInUser.mockResolvedValue(owner);
    expect((await publish()).statusCode).toBe(401);
    expect(helpers.getWebLoggedInUser).not.toHaveBeenCalled();
  });

  it('requires the publish scope', async () => {
    apiKeyAuth = keyFor([paidPlugin.id], []);
    expect((await publish()).statusCode).toBe(403);
  });

  it('only publishes plugins the key was created for', async () => {
    apiKeyAuth = keyFor(['other.plugin']);
    const res = await publish();
    expect(res.statusCode).toBe(403);
    expect(res.send.mock.calls[0][0].error).toMatch(/cannot publish/);
  });

  it('explains that keys cannot submit plugins that do not exist yet', async () => {
    apiKeyAuth = keyFor(['other.plugin']);
    plugin.get.mockResolvedValue([]);
    const res = await publish();
    expect(res.statusCode).toBe(403);
    expect(res.send.mock.calls[0][0]).toMatchObject({ code: 'plugin_not_found', error: expect.stringMatching(/doesn't exist yet/) });
  });

  it('refuses price changes', async () => {
    apiKeyAuth = keyFor([paidPlugin.id]);
    expect((await publish({ price: 200 })).statusCode).toBe(403);
    expect((await publish({ price: 0 })).statusCode).toBe(403);
  });

  it('lets an allowed key through to the normal update checks', async () => {
    apiKeyAuth = keyFor([paidPlugin.id]);
    const res = await publish();
    expect(res.statusCode).toBe(400);
    expect(res.send.mock.calls[0][0].error).toMatch(/greater than the current version/);
    expect(helpers.getWebLoggedInUser).not.toHaveBeenCalled();
  });

  it('emails the owner, naming the key and IP, when a key updates a plugin', async () => {
    Object.assign(plugin, { PRICE: 'price', DESCRIPTION: 'description', update: vi.fn() });
    apiKeyAuth = keyFor([paidPlugin.id]);
    const res = await publish({ version: '1.0.0' });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledOnce());
    const [to, , subject, html] = sendEmail.mock.calls[0];
    expect(to).toBe(owner.email);
    expect(subject).toContain('with an API key');
    expect(html).toContain('Release &lt;CI&gt;');
    expect(html).toContain('acode_Ab12');
    expect(html).toContain('203.0.113.9');
  });

  it('does not send key notices for website uploads', async () => {
    Object.assign(plugin, { PRICE: 'price', DESCRIPTION: 'description', update: vi.fn() });
    helpers.getWebLoggedInUser.mockResolvedValue(owner);
    const res = await publish({ version: '1.0.0' }, { authorization: undefined });
    expect(res.send.mock.calls[0][0]).toEqual({ message: 'Plugin updated successfully' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['the uploaded text over the zip file', { changelogs: 'From CI' }, 'From CI'],
    ['the zip file when no text is uploaded', {}, 'From zip'],
  ])('records one changelog for a new plugin, preferring %s', async (_case, body, expected) => {
    Object.assign(plugin, { CHANGELOGS: 'changelogs', insert: vi.fn() });
    apiKeyAuth = keyFor([], [apiKeyLib.SCOPE_PLUGIN_CREATE]);
    plugin.get.mockResolvedValueOnce([]);
    await publish({ price: 0 }, { method: 'post', body, files: { 'changelogs.md': 'From zip' } });
    const changelogColumns = plugin.insert.mock.calls[0].filter(([column]) => column === 'changelogs');
    expect(changelogColumns).toEqual([['changelogs', expected]]);
  });

  it.each([
    ['adds the new plugin to the key', true, undefined],
    ['warns when the key is full', false, expect.stringMatching(/already covers 100 plugins.*Create a new key/)],
  ])('after a key submits a plugin, %s', async (_case, added, warning) => {
    Object.assign(plugin, { insert: vi.fn() });
    apiKeyEntity.addPlugin.mockReturnValue(added);
    apiKeyAuth = keyFor([], [apiKeyLib.SCOPE_PLUGIN_CREATE, apiKeyLib.SCOPE_PLUGIN_PUBLISH]);
    plugin.get.mockResolvedValueOnce([]);
    const res = await publish({ price: 0 }, { method: 'post' });
    expect(apiKeyEntity.addPlugin).toHaveBeenCalledWith(1, paidPlugin.id, apiKeyLib.MAX_PLUGINS_PER_KEY);
    expect(res.send.mock.calls[0][0]).toEqual({ message: 'Plugin uploaded successfully', ...(warning && { warning }) });
  });

  it('needs the opt-in submit permission to create plugins', async () => {
    helpers.getWebLoggedInUser.mockResolvedValue(owner);
    apiKeyAuth = keyFor([paidPlugin.id]);
    const res = await publish({ price: 0 }, { method: 'post' });
    expect(res.statusCode).toBe(403);
    expect(res.send.mock.calls[0][0].error).toMatch(/cannot submit new plugins/);
    expect(helpers.getWebLoggedInUser).not.toHaveBeenCalled();
  });

  it.each([
    ['a free', 'key', 0],
    ['a paid', 'web', 100],
  ])('rejects %s plugin whose SKU another plugin already uses', async (_case, auth, price) => {
    Object.assign(plugin, { SKU: 'sku', insert: vi.fn() });
    if (auth === 'key') apiKeyAuth = keyFor([], [apiKeyLib.SCOPE_PLUGIN_CREATE]);
    else helpers.getWebLoggedInUser.mockResolvedValue({ ...owner, authType: 'web' });
    plugin.get.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'victim.plugin' }]);
    const res = await publish({ price }, { method: 'post', authorization: auth === 'key' ? 'Bearer acode_key' : undefined });
    expect(res.statusCode).toBe(400);
    expect(res.send.mock.calls[0][0].error).toMatch(/can't be used/);
    expect(plugin.get).toHaveBeenLastCalledWith(['id'], ['sku', `plugin_${paidPlugin.id}`]);
    expect(plugin.insert).not.toHaveBeenCalled();
  });

  it('refuses paid submissions and lets free ones through to the normal checks', async () => {
    apiKeyAuth = keyFor([], [apiKeyLib.SCOPE_PLUGIN_CREATE]);
    plugin.get.mockResolvedValueOnce([]);
    const paid = await publish({ price: 100 }, { method: 'post' });
    expect(paid.statusCode).toBe(403);
    expect(paid.send.mock.calls[0][0].error).toMatch(/Paid plugins/);
    const res = await publish({ price: 0 }, { method: 'post' });
    expect(res.statusCode).toBe(400);
    expect(res.send.mock.calls[0][0].error).toMatch(/already exists/);
  });
});

describe('registering a Play SKU', () => {
  it('refuses a SKU stored for another plugin before contacting Google Play', async () => {
    Object.assign(plugin, { SKU: 'sku' });
    plugin.get.mockResolvedValue([{ id: 'victim.plugin' }]);
    await expect(router.registerSKU('Test', paidPlugin.id, 100)).rejects.toThrow(/belongs to another plugin/);
    expect(plugin.get).toHaveBeenCalledWith(['id'], ['sku', `plugin_${paidPlugin.id}`]);
  });
});
