import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import { Router } from 'express';

let reviews;
let admin;
let audit;
let request;
let db;
const reviewed = [{ key: 'earnings-hold:7:2026:9:GOOGLE_PURCHASE_REVIEW_REQUIRED', value: 'GOOGLE_PURCHASE_REVIEW_REQUIRED' }];

beforeEach(() => {
  reviews = {
    listAll: vi.fn().mockResolvedValue({
      holds: [{ userId: 7, year: 2026, month: 9, codes: ['GOOGLE_PURCHASE_REVIEW_REQUIRED'], snapshot: reviewed }],
      invalidMarkers: [],
    }),
    clear: vi.fn().mockResolvedValue([{ userId: 7, year: 2026, month: 9, code: 'GOOGLE_PURCHASE_REVIEW_REQUIRED' }]),
  };
  admin = { id: 1, isAdmin: true };
  audit = vi.fn();
  const source = fs.readFileSync(new URL('../../server/apis/admin.js', import.meta.url), 'utf8');
  const dependencies = Object.fromEntries([...source.matchAll(/require\('([^']+)'\)/g)].map(([, name]) => [name, {}]));
  Object.assign(dependencies, {
    'node:path': path,
    express: { Router },
    '../lib/helpers': { getWebLoggedInUser: async () => admin },
    '../lib/earningsReview': reviews,
  });
  const module = { exports: {} };
  vm.runInNewContext(source, {
    __dirname: path.resolve(import.meta.dirname, '../../server/apis'),
    module,
    require: (name) => dependencies[name],
    console: { info: audit, error: vi.fn() },
  });
  const router = module.exports;
  request = async (method = 'delete', params = { userId: '7', year: '2026', month: '9' }, body = { snapshot: reviewed }) => {
    const req = { params, body };
    const res = { statusCode: 200, body: null, headers: {} };
    res.status = (value) => {
      res.statusCode = value;
      return res;
    };
    res.send = (value) => {
      res.body = value;
      return res;
    };
    res.set = (key, value) => {
      res.headers[key] = value;
      return res;
    };
    let authorized = false;
    await router.stack[0].handle(req, res, () => {
      authorized = true;
    });
    if (authorized) {
      const route = router.stack.find(
        (layer) => layer.route?.path === (method === 'get' ? '/earnings-holds' : '/earnings-holds/:userId/:year/:month'),
      );
      await route.route.stack[0].handle(req, res);
    }
    return res;
  };
});

it.each([null, { id: 7, isAdmin: false }])('rejects a non-admin before accessing holds: %j', async (account) => {
  admin = account;
  expect((await request()).statusCode).toBe(401);
  expect((await request('get')).statusCode).toBe(401);
  expect(reviews.clear).not.toHaveBeenCalled();
  expect(reviews.listAll).not.toHaveBeenCalled();
});

it('lists all reasons without caching and clears the explicit zero-based period with an audit log', async () => {
  const listed = await request('get');
  expect(listed.headers['Cache-Control']).toBe('no-store');
  expect(listed.body).toEqual(await reviews.listAll());
  const cleared = await request();
  expect(cleared.body).toEqual({ success: true, clearedCodes: ['GOOGLE_PURCHASE_REVIEW_REQUIRED'] });
  expect(reviews.clear).toHaveBeenCalledWith(7, 2026, 9, reviewed);
  expect(audit).toHaveBeenCalledWith(expect.any(String), 1, 7, 2026, 10, 'GOOGLE_PURCHASE_REVIEW_REQUIRED');
});

it.each([{ userId: 'x' }, { year: 'NaN' }, { year: '1969' }, { month: '12' }, { month: '-1' }, { month: '1.5' }])(
  'rejects malformed period %j',
  async (params) => {
    expect((await request('delete', { userId: '7', year: '2026', month: '9', ...params })).statusCode).toBe(400);
    expect(reviews.clear).not.toHaveBeenCalled();
  },
);

it('does not log a failed clear as successful', async () => {
  reviews.clear.mockRejectedValueOnce(new Error('Fixture database failure'));
  const failed = await request();
  expect(failed.statusCode).toBe(500);
  expect(failed.body.error).toBe('Failed to clear earnings hold');
  expect(audit).not.toHaveBeenCalled();
});

it('returns 409 and does not log success when holds changed after inspection', async () => {
  reviews.clear.mockRejectedValueOnce(
    Object.assign(new Error('Earnings holds changed. Reload and review them before clearing.'), { statusCode: 409 }),
  );
  const res = await request();
  expect(res.statusCode).toBe(409);
  expect(res.body.error).toContain('Reload and review');
  expect(audit).not.toHaveBeenCalled();
});

afterEach(() => {
  db?.close();
  db = undefined;
});

function useRealReviews() {
  db = new Database(':memory:');
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
  const Entity = load('entities/entity.js', { '../lib/db': db });
  const settings = load('entities/appConfig.js', { './entity': Entity, '../../constants.mjs': { PAYMENT_THRESHOLD: 10000 } });
  Object.assign(reviews, load('lib/earningsReview.js', { '../entities/appConfig': settings, '../entities/entity': Entity, 'node:crypto': crypto }));
  return settings;
}

it.each([{}, { snapshot: [] }, { snapshot: [{}] }, { snapshot: null }])('requires a reviewed snapshot: %j', async (body) => {
  const res = await request('delete', undefined, body);
  expect(res.statusCode).toBe(body.snapshot === undefined ? 428 : 400);
  expect(reviews.clear).not.toHaveBeenCalled();
});

it.each(['INVALID_GOOGLE_REPORT', 'GOOGLE_PURCHASE_REVIEW_REQUIRED'])('rejects an earlier GET after a new review event: %s', async (code) => {
  useRealReviews();
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  const before = (await request('get')).body.holds[0];
  await reviews.hold(7, 2026, 9, code);
  const stale = await request('delete', undefined, { snapshot: before.snapshot });
  expect(stale.statusCode).toBe(409);
  expect(await reviews.list(7)).not.toHaveLength(0);
  expect(audit).not.toHaveBeenCalled();
  const fresh = (await request('get')).body.holds[0];
  const cleared = await request('delete', undefined, { snapshot: fresh.snapshot });
  expect(cleared.statusCode).toBe(200);
  expect(cleared.body.clearedCodes.sort()).toEqual([...new Set(['INVALID_GOOGLE_REPORT', code])].sort());
  await expect(reviews.list(7)).resolves.toEqual([]);
});

it('shows malformed markers alongside valid months without allowing them to be cleared', async () => {
  const settings = useRealReviews();
  await reviews.hold(7, 2026, 9, 'INVALID_GOOGLE_REPORT');
  const invalid = { key: 'earnings-hold:7:2026:9:INVALID_REASON', value: 'MISSING_RAZORPAY_INR' };
  await settings.setValue(invalid.key, invalid.value);
  const listed = await request('get');
  expect(listed.statusCode).toBe(200);
  expect(listed.body.holds).toHaveLength(1);
  expect(listed.body.invalidMarkers).toEqual([{ ...invalid, code: 'INVALID_MARKER' }]);
  await expect(reviews.assertClear(7)).rejects.toMatchObject({ code: 'EARNINGS_UNDER_REVIEW' });
  // The malformed row is absent from the valid snapshot, so even clearing that
  // valid subset must fail closed rather than deleting around the corrupt row.
  const subset = await request('delete', undefined, { snapshot: listed.body.holds[0].snapshot });
  expect(subset.statusCode).toBe(409);
  const malformed = await request('delete', undefined, { snapshot: [invalid] });
  expect(malformed.statusCode).toBe(400);
  await expect(settings.getValue(invalid.key)).resolves.toBe(invalid.value);
  expect(audit).not.toHaveBeenCalled();
});
