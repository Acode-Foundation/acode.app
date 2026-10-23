import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import importPromotions from '../../server/lib/importPromotions';
import createRedirect from '../../server/lib/promotionRedirect';
import store from '../../server/lib/promotions';
import migration from '../../server/migrations/018_import_promotions';

let db;
let directory;
const promo = (label = 'Example') => ({
  label,
  url: 'https://example.com/?campaign=one',
  icon: 'https://example.com/icon.png',
  link_text: 'Description',
});
const request = (headers = {}, source = 'app_https') => ({ method: 'GET', query: { source }, headers });
function loadEntity(filename, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL(`../../server/entities/${filename}.js`, import.meta.url), 'utf8'), {
    module,
    console,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unmocked entity dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}
function initializeEntities() {
  const Entity = loadEntity('entity', { '../lib/db': db });
  const Promotion = loadEntity('promotion', { './entity': Entity });
  const PromotionClickDay = loadEntity('promotionClickDay', { './entity': Entity, './promotion': Promotion });
  return { Promotion, PromotionClickDay };
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'promotions-test-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeEntities();
  db.exec('CREATE TABLE app_config(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  migration.up(db, path.join(directory, 'missing.json'));
});
afterEach(() => {
  db.close();
  fs.rmSync(directory, { recursive: true });
  vi.unstubAllEnvs();
});
it('imports once, keeps order and archives excess entries', () => {
  const file = path.join(directory, 'legacy.json');
  fs.writeFileSync(file, JSON.stringify(['a', 'b', 'c', 'd'].map((name) => ({ ...promo(name), url: `https://${name}.example` }))));
  migration.up(db, file);
  migration.up(db, file);
  expect(store.listPromotions(false, db).map((row) => row.label)).toEqual(['a', 'b', 'c']);
  expect(store.listPromotions(true, db).map((row) => row.label)).toEqual(['d']);
  expect(JSON.parse(fs.readFileSync(file))).toHaveLength(4);
});
it('leaves invalid imports pending without partially writing or blocking migration completion', async () => {
  const file = path.join(directory, 'invalid.json');
  const existing = store.savePromotion(promo('Existing'), db);
  for (const content of ['{', JSON.stringify([promo('Valid'), { ...promo('Invalid'), icon: 'not a URL' }])]) {
    fs.writeFileSync(file, content);
    expect(migration.up(db, file)).toMatchObject({ status: 'invalid', imported: 0, filename: file });
    expect(store.listPromotions(false, db)).toEqual([existing]);
    expect(db.prepare('SELECT * FROM app_config').all()).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../../server/lib/migrationRunner.js', import.meta.url), 'utf8'), {
    module,
    __dirname: path.resolve('server/lib'),
    console: { log() {}, error() {} },
    require(name) {
      if (name === './db') return db;
      if (name === 'node:fs') return { existsSync: () => true, readdirSync: () => ['018_import_promotions.js'] };
      if (name === 'node:path') return path;
      if (path.basename(name) === '018_import_promotions.js') return { ...migration, up: (db) => migration.up(db, file) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  await module.exports.run();
  expect(db.prepare('SELECT version FROM schema_version WHERE version=18').get()).toEqual({ version: 18 });
  fs.writeFileSync(file, JSON.stringify([{ ...promo('Recovered'), url: 'https://recovered.example' }]));
  expect(importPromotions(db, file)).toMatchObject({ status: 'complete', imported: 1 });
  expect(importPromotions(db, file)).toMatchObject({ status: 'complete', imported: 0 });
  expect(store.listPromotions(false, db).map((row) => row.label)).toEqual(['Existing', 'Recovered']);
});
it('keeps unreadable files pending and does not let tracking configuration block imports', () => {
  expect(importPromotions(db, directory)).toMatchObject({ status: 'unreadable', imported: 0 });
  expect(db.prepare('SELECT * FROM app_config').all()).toEqual([]);
  vi.stubEnv('PROMOTION_TRACKING_ORIGIN', 'invalid configuration');
  const file = path.join(directory, 'valid.json');
  fs.writeFileSync(file, JSON.stringify([promo()]));
  expect(importPromotions(db, file)).toMatchObject({ status: 'complete', imported: 1 });
});
it('preserves IDs, caps active records and archives/restores without losing clicks', () => {
  const rows = store.savePromotions([promo('a'), promo('b'), promo('c')], db);
  const id = rows[0].id;
  store.recordClick(id, request(), db);
  rows[0].label = 'Edited';
  expect(store.savePromotions(rows, db)[0].id).toBe(id);
  for (const invalid of [[...rows, promo()], [rows[0], rows[0]], [{ ...promo(), id: 'missing' }], [{ ...promo(), url: 'javascript:alert(1)' }]]) {
    expect(() => store.savePromotions(invalid, db)).toThrow();
    expect(store.listPromotions(false, db)).toHaveLength(3);
  }
  store.savePromotions(rows.slice(1), db);
  expect(store.listPromotions(true, db)[0].id).toBe(id);
  store.savePromotions(rows, db);
  expect(store.analytics(id, db).total).toBe(1);
});
it('saves one promotion without changing other cards or its analytics', () => {
  const rows = store.savePromotions([promo('a'), promo('b'), promo('c')], db);
  store.recordClick(rows[0].id, request(), db);
  const updated = store.savePromotion({ ...rows[0], label: 'Edited' }, db);
  expect(updated.id).toBe(rows[0].id);
  expect(updated.label).toBe('Edited');
  expect(store.listPromotions(false, db).slice(1)).toEqual(rows.slice(1));
  expect(store.analytics(updated.id, db).total).toBe(1);
  expect(() => store.savePromotion(promo('fourth'), db)).toThrow('Only three');
  expect(() => store.savePromotion({ ...rows[0], id: 'missing' }, db)).toThrow('Unknown promotion ID');
  expect(() => store.savePromotion({ ...rows[0], archived: 'false' }, db)).toThrow('Invalid archive status');
});
it('archives, creates and restores individual promotions within the active limit', () => {
  const rows = store.savePromotions([promo('a'), promo('b'), promo('c')], db);
  const archived = store.savePromotion({ ...rows[0], archived: 1 }, db);
  expect(store.listPromotions(true, db)).toEqual([archived]);
  const created = store.savePromotion(promo('new'), db);
  expect(created.id).toBeTruthy();
  expect(() => store.savePromotion({ ...archived, archived: 0 }, db)).toThrow('Only three');
  expect(store.listPromotions(true, db)).toEqual([archived]);
  store.savePromotion({ ...created, archived: 1 }, db);
  expect(store.savePromotion({ ...archived, archived: 0 }, db).id).toBe(rows[0].id);
  expect(store.listPromotions(false, db).map((row) => row.id)).toEqual([rows[1].id, rows[2].id, rows[0].id]);
});
it('separates origin and OS, aggregates atomically and fills zero days', () => {
  const [{ id }] = store.savePromotions([promo()], db);
  const now = new Date('2026-10-23T12:00:00Z');
  const req = request({ 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile' });
  expect(store.clickContext(req)).toEqual({ origin: 'https://localhost', device: 'Mobile', os: 'iOS' });
  store.recordClick(id, req, db, now);
  store.recordClick(id, req, db, now);
  const analytics = store.analytics(id, db, now);
  expect(analytics.total).toBe(2);
  expect(analytics.recent).toBe(2);
  expect(analytics.daily).toHaveLength(30);
  expect(analytics.daily.at(-1).count).toBe(2);
  expect(analytics.daily[0].count).toBe(0);
  expect(analytics.operatingSystems).toEqual([{ name: 'iOS', count: 2 }]);
  expect(store.clickContext(request({}, 'garbage'))).toEqual({ origin: 'unknown', os: 'Unknown', device: 'Unknown' });
});
it('does not count HEAD, prefetch or recognized bot requests', () => {
  const [{ id }] = store.savePromotions([promo()], db);
  for (const req of [
    { ...request(), method: 'HEAD' },
    request({ 'sec-purpose': 'prefetch' }),
    request({ purpose: 'prefetch' }),
    request({ 'user-agent': 'Googlebot' }),
  ])
    store.recordClick(id, req, db);
  expect(store.analytics(id, db).total).toBe(0);
});
it('keeps archived redirects working and redirects despite counter failures', () => {
  const [{ id }] = store.savePromotions([promo()], db);
  store.savePromotions([], db);
  const res = { set: vi.fn(), redirect: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() };
  const next = vi.fn();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  createRedirect(
    () => db,
    () => {
      throw new Error('disk full');
    },
  )({ ...request(), params: { id } }, res, next);
  expect(res.redirect).toHaveBeenCalledWith(302, promo().url);
  expect(next).not.toHaveBeenCalled();
  createRedirect(() => db)({ ...request(), params: { id: 'missing' } }, res, next);
  expect(res.status).toHaveBeenCalledWith(404);
  log.mockRestore();
});
it('requires an explicit valid tracking origin and rejects tracking paths regardless of case', () => {
  for (const value of ['', 'not a URL', 'ftp://go.acode.app', 'https://go.acode.app/p/123']) {
    vi.stubEnv('PROMOTION_TRACKING_ORIGIN', value);
    expect(() => store.trackingOrigin()).toThrow();
  }
  vi.stubEnv('PROMOTION_TRACKING_ORIGIN', 'https://tracking.example');
  for (const host of ['go.acode.app', 'go.dev.acode.app', 'acode.app', 'dev.acode.app', 'tracking.example']) {
    for (const prefix of ['p', 'P'])
      expect(() => store.savePromotion({ ...promo(), url: `https://${host}/${prefix}/self` }, db)).toThrow(store.PromotionValidationError);
  }
  expect(store.listPromotions(false, db)).toEqual([]);
});
it('returns safe validation errors and delegates unexpected admin failures to the server handler', () => {
  const source = fs.readFileSync(new URL('../../server/apis/admin.js', import.meta.url), 'utf8');
  const snippet = source.slice(source.indexOf("router.put('/promotions'"), source.indexOf('const modePluginsFile'));
  const promotionStore = {
    ...store,
    savePromotions: (items) => store.savePromotions(items, db),
    savePromotion: (item) => store.savePromotion(item, db),
    analytics: (id) => store.analytics(id, db),
  };
  let handler;
  vm.runInNewContext(snippet, {
    router: {
      put: (_path, callback) => {
        handler = callback;
      },
    },
    promotionStore,
  });
  const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
  for (const body of [undefined, {}, { promotion: { ...promo(), url: 'javascript:alert(1)' } }]) {
    const res = response();
    const next = vi.fn();
    handler({ body }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/Promotions must be an array|Invalid url URL/);
    expect(next).not.toHaveBeenCalled();
  }
  const res = response();
  handler({ body: { promotion: promo() } }, res, vi.fn());
  expect(res.json.mock.calls[0][0].promotion).toMatchObject({ label: 'Example' });
  const failure = new Error('Internal database details');
  promotionStore.savePromotion = () => {
    throw failure;
  };
  const failedResponse = response();
  const next = vi.fn();
  handler({ body: { promotion: promo() } }, failedResponse, next);
  expect(next).toHaveBeenCalledWith(failure);
  expect(failedResponse.json).not.toHaveBeenCalled();
});
it('uses configured tracking origin and exact source matching', () => {
  vi.stubEnv('PROMOTION_TRACKING_ORIGIN', 'https://go.dev.acode.app');
  vi.stubEnv('HOST', 'https://dev.acode.app');
  expect(store.trackingOrigin()).toBe('https://go.dev.acode.app');
  expect(store.sourceForRequest(request({ origin: 'acode://localhost' }))).toBe('app_acode');
  expect(store.sourceForRequest(request({ referer: 'https://dev.acode.app/plugins' }))).toBe('web');
  expect(store.sourceForRequest(request({ origin: 'https://localhost.evil.example' }))).toBe('unknown');
  expect(() => store.validatePromotions([{ ...promo(), url: 'https://go.dev.acode.app/p/123' }])).toThrow();
});

it('public API preserves legacy fields, emits tracking URLs and never exposes analytics or destinations', () => {
  vi.stubEnv('PROMOTION_TRACKING_ORIGIN', 'https://go.dev.acode.app');
  vi.stubEnv('HOST', 'https://dev.acode.app');
  store.savePromotions([promo()], db);
  let handler;
  const router = {
    get: (path, callback) => {
      expect(path).toBe('/');
      handler = callback;
    },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../../server/apis/promotions.js', import.meta.url), 'utf8'), {
    module: { exports: {} },
    require: (name) => {
      if (name === '../entities/promotionClickDay') return initializeEntities().PromotionClickDay;
      if (name === 'express') return { Router: () => router };
      if (name === '../lib/promotions') return { ...store, listPromotions: () => store.listPromotions(false, db) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const res = { set: vi.fn(), json: vi.fn() };
  const next = vi.fn();
  handler(request({ origin: 'https://localhost' }), res, next);
  const [row] = res.json.mock.calls[0][0];
  expect(Object.keys(row).sort()).toEqual(['icon', 'id', 'label', 'link_text', 'url']);
  expect(row.url).toBe(`https://go.dev.acode.app/p/${row.id}?source=app_https`);
  expect(row.label).toBe(promo().label);
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(next).not.toHaveBeenCalled();
});

it('entity initialization creates tables idempotently and preserves existing records and counters', async () => {
  const [{ id }] = store.savePromotions([promo()], db);
  store.recordClick(id, request(), db);
  const { Promotion, PromotionClickDay } = initializeEntities();
  expect(Promotion.table).toBe('promotion');
  expect(PromotionClickDay.table).toBe('promotion_click_day');
  expect(await Promotion.get([Promotion.ID, id])).toMatchObject([{ id, label: 'Example' }]);
  expect(await PromotionClickDay.get([PromotionClickDay.PROMOTION_ID, id], { orderBy: 'day DESC' })).toMatchObject([{ clicks: 1 }]);
  expect(store.analytics(id, db).total).toBe(1);
});

it('retries a missing import even after migration 18 was recorded and preserves existing promotions', () => {
  const file = path.join(directory, 'late.json');
  expect(migration.up(db, file).status).toBe('missing');
  expect(db.prepare('SELECT * FROM app_config').all()).toEqual([]);
  const [existing] = store.savePromotions([promo('Existing')], db);
  fs.writeFileSync(file, JSON.stringify([promo('Must not overwrite'), { ...promo('Imported'), url: 'https://second.example' }]));
  expect(migration.up(db, file).imported).toBe(1);
  const rows = store.listPromotions(false, db);
  expect(rows[0]).toMatchObject({ id: existing.id, label: 'Existing' });
  expect(rows[1].label).toBe('Imported');
  store.savePromotions([], db);
  expect(migration.up(db, file).imported).toBe(0);
  expect(store.listPromotions(false, db)).toEqual([]);
});
it('preserves full active slots and archives recovered JSON entries without overwriting records', () => {
  const existing = store.savePromotions(
    ['one', 'two', 'three'].map((name) => ({ ...promo(name), url: `https://${name}.example` })),
    db,
  );
  const file = path.join(directory, 'recover.json');
  fs.writeFileSync(file, JSON.stringify([{ ...promo('Recovered'), url: 'https://recovered.example' }]));
  expect(migration.up(db, file).imported).toBe(1);
  expect(store.listPromotions(false, db).map((row) => row.id)).toEqual(existing.map((row) => row.id));
  expect(store.listPromotions(true, db)[0].label).toBe('Recovered');
});
