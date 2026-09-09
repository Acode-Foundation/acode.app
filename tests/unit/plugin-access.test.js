import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Router } from 'express';

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

beforeEach(() => {
  plugin = {
    ID: 'id',
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
    detectUserCurrency: () => ({ code: 'USD' }),
    formatAmount: (amount) => amount.toFixed(2),
  };
  googlePurchase = vi.fn().mockResolvedValue({ data: { purchaseState: 0 } });
  razorpayPayment = vi.fn().mockResolvedValue({ status: 'captured' });
  const dependencies = {
    'node:fs': {},
    'node:path': path,
    jszip: {},
    moment: {},
    express: { Router },
    googleapis: { google: { androidpublisher: () => ({ purchases: { products: { get: googlePurchase } } }) } },
    '../entities/plugin': plugin,
    '../entities/user': {},
    '../entities/purchaseOrder': order,
    '../entities/download': download,
    '../badWords.json': [],
    '../lib/helpers': helpers,
    '../lib/razorpay': () => ({ payments: { fetch: razorpayPayment } }),
    '../lib/sendEmail': vi.fn(),
    '../lib/exchangeRates': { convertPrice: async (amount) => ({ amount: amount / 10, currency: 'USD', symbol: '$' }) },
    '../lib/modeRegex': {},
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

  it('retains the missing-plugin response for admins', async () => {
    helpers.getLoggedInUser.mockResolvedValue({ id: 9, isAdmin: true });
    plugin.get.mockResolvedValue([]);
    const res = await downloadPlugin();
    expect(res.statusCode).toBe(404);
    expect(res.sendFile).not.toHaveBeenCalled();
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
