import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import express from 'express';
import moment from 'moment';

const root = path.resolve(import.meta.dirname, '../..');

function load(file, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    module,
    console: { log: vi.fn(), error: vi.fn() },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

function harness({ loggedIn = { id: 7 }, userExists = true, failure, holds = [] } = {}) {
  const user = { id: 7, created_at: '2026-01-01' };
  const reviews = load('server/lib/earningsReview.js', {
    'node:crypto': crypto,
    '../entities/entity': {},
    '../entities/appConfig': {
      KEY: 'key',
      VALUE: 'value',
      for() {
        return this;
      },
      get: async () => holds.map(({ year, month }) => ({ key: `earnings-hold:7:${year}:${month}`, value: 'MISSING_RAZORPAY_INR' })),
    },
  });
  const UserEarnings = { get: vi.fn().mockResolvedValue([]) };
  const entity = (rows, fields = {}) => ({
    ...fields,
    for() {
      return this;
    },
    get: vi.fn().mockResolvedValue(rows),
  });
  const orders = entity([{ id: 1, order_id: 'fixture-order', amount: 10, currency: 'USD', provider: 'razorpay', state: 0 }], {
    STATE_PURCHASED: 0,
    PROVIDER_RAZORPAY: 'razorpay',
  });
  const calculator = load('server/lib/calcEarnings.js', {
    './earningsReview': reviews,
    moment,
    '../entities/plugin': entity([{ id: 'fixture-plugin' }]),
    '../entities/download': { count: async () => 0 },
    '../entities/userEarnings': UserEarnings,
    '../entities/purchaseOrder': orders,
    '../entities/razorpayOrder': entity([]),
  });
  if (failure)
    calculator.total = async () => {
      throw failure;
    };
  const dashboard = load('server/lib/developerDashboard.js', {
    './earningsReview': reviews,
    moment,
    '../entities/entity': { execSql: async (sql) => (sql.includes('FROM plugin p') ? [{ id: 'fixture-plugin', price: 100, downloads: 42 }] : []) },
    '../entities/download': {},
    '../entities/pluginScan': {},
    '../../shared/verification': { RECENT_DOWNLOAD_DAYS: 30 },
  });
  const dependencies = {
    express,
    moment,
    'node:crypto': crypto,
    '../password': {},
    '../lib/helpers': {
      getWebLoggedInUser: async () => loggedIn,
      areSameUser: (id, account) => String(id) === String(account.id),
    },
    '../lib/guestOnly': { rejectSignedIn: (_req, _res, next) => next() },
    '../entities/user': entity(userExists ? [user] : []),
    '../entities/userEarnings': UserEarnings,
    '../entities/appConfig': { getPaymentThreshold: async () => 10000 },
    '../lib/calcEarnings': calculator,
    '../lib/earningsReview': reviews,
    '../lib/developerDashboard': dashboard,
    '../lib/rateLimits': Object.fromEntries(
      ['appAuthCodeLimiter', 'appTokenExchangeLimiter', 'appleUnlinkLimiter', 'emailCodeCheckLimiter'].map((name) => [
        name,
        (_req, _res, next) => next(),
      ]),
    ),
    '../lib/emailCode': {},
    '../lib/appleOAuth': {},
  };
  const source = fs.readFileSync(path.join(root, 'server/apis/user.js'), 'utf8');
  for (const [, name] of source.matchAll(/require\('(\.\.\/entities\/[^']+)'\)/g)) dependencies[name] ??= {};
  const router = load('server/apis/user.js', dependencies);
  return async (route, query = { user: '7' }, params = { year: String(moment().year()), month: String(moment().month()) }) => {
    const handler = router.stack.find((layer) => layer.route?.path === route).route.stack.at(-1).handle;
    const res = {
      statusCode: 200,
      // Use Express's actual validation: a string status throws instead of hiding the regression.
      status: express.response.status,
      send: vi.fn(),
    };
    await handler({ query, params }, res);
    return { status: res.statusCode, body: res.send.mock.calls[0]?.[0] };
  };
}

it.each(['/earnings/:year/:month', '/unpaid-earnings'])('returns a readable 409 for missing INR data on %s', async (route) => {
  const response = await harness()(route);
  expect(response.status).toBe(409);
  expect(response.body.error).toContain('Missing INR accounting amounts');
  expect(response.body.error).toContain('earnings held');
});

it('returns dashboard data with unavailable estimates when accounting is held', async () => {
  const response = await harness()('/dashboard');
  expect(response.status).toBe(200);
  expect(response.body.totals).toMatchObject({ plugins: 1, downloads: 42, lifetimeEarnings: null });
  expect(response.body.monthly.at(-1)).toMatchObject({ amount: null, reviewRequired: true });
});

it.each([
  ['missing user parameter', {}, {}, 400],
  ['signed out', { loggedIn: null }, { user: '7' }, 401],
  ['another developer', {}, { user: '8' }, 401],
  ['missing account', { userExists: false }, { user: '7' }, 404],
])('preserves the existing numeric status for %s', async (_label, options, query, status) => {
  expect((await harness(options)('/earnings/:year/:month', query)).status).toBe(status);
});

it.each([
  [{ code: 'UNKNOWN_ACCOUNTING_CODE' }, 500],
  [{ code: 'INVALID_GOOGLE_REPORT', statusCode: 409 }, 409],
  [{ code: 403 }, 403],
  [{ code: 401, statusCode: 409 }, 409],
  [{ code: 200, statusCode: 999 }, 500],
  [{ code: '409', statusCode: '409' }, 500],
])('handles error metadata %j without throwing another error', async (metadata, status) => {
  const failure = Object.assign(new Error('Accounting needs review'), metadata);
  const response = await harness({ failure })('/earnings/:year/:month');
  expect(response).toEqual({ status, body: { error: failure.message } });
});

it('keeps historical holds visible on monthly and unpaid endpoints after the estimate window closes', async () => {
  const request = harness({ holds: [{ year: 2024, month: 9 }] });
  const held = await request('/earnings/:year/:month', { user: '7' }, { year: '2024', month: '9' });
  expect(held.status).toBe(409);
  expect(held.body.error).toContain('2024-10');
  expect((await request('/unpaid-earnings')).status).toBe(409);
  const otherMonth = await request('/earnings/:year/:month', { user: '7' }, { year: '2024', month: '8' });
  expect(otherMonth.status).toBe(200);
});
