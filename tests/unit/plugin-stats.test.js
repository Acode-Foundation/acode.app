import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import express from 'express';
import { JSDOM } from 'jsdom';
import * as badges from '../../server/lib/pluginBadge';
import pluginStatsCors from '../../server/lib/pluginStatsCors';
import * as rateLimits from '../../server/lib/rateLimits';

const fixture = {
  id: 'test.plugin',
  name: 'Test Plugin',
  version: '1.2.3',
  downloads: '12345',
  votes_up: 24,
  votes_down: 1,
  package_updated_at: '2026-11-18 04:30:00',
  created_at: '2026-10-01 00:00:00',
  updated_at: '2026-11-18 05:00:00',
  user_id: 123,
  author_email: 'private@example.com',
};
const getPublicStats = vi.fn();
let server;
let base;

beforeAll(async () => {
  const filename = path.resolve(import.meta.dirname, '../../server/apis/pluginStats.js');
  const module = { exports: {} };
  const dependencies = {
    express,
    '../entities/plugin': { getPublicStats },
    '../lib/pluginBadge': badges,
    '../lib/rateLimits': rateLimits,
    '../lib/pluginStatsCors': pluginStatsCors,
  };
  // Never load the real entities or open the application database.
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    console: { error: vi.fn() },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unmocked import: ${name}`);
      return dependencies[name];
    },
  });
  const app = express();
  app.use((_req, res, next) => {
    res.set('Access-Control-Allow-Credentials', 'true');
    next();
  });
  const main = fs.readFileSync(path.resolve(import.meta.dirname, '../../server/main.js'), 'utf8');
  const corsStart = main.indexOf('  app.use((_req, res, next) => {');
  vm.runInNewContext(main.slice(corsStart, main.indexOf("  app.get('/p/:id'", corsStart)), {
    app,
    pluginStatsCors,
    ALLOWED_ORIGINS: new Set(['https://acode.app']),
  });
  const pluginApi = express.Router();
  pluginApi.get('/:id', (req, res) => res.json({ plugin: req.params.id }));
  const apiModule = { exports: {} };
  // Load the real mounts to prove that stats have their own namespace.
  vm.runInNewContext(fs.readFileSync(path.resolve(import.meta.dirname, '../../server/routes/apis.js'), 'utf8'), {
    module: apiModule,
    require(name) {
      if (name === 'express') return express;
      if (name === 'node:child_process' || name === '../lib/db') return {};
      if (name === '../apis/pluginStats') return module.exports;
      if (name === '../apis/plugin') return pluginApi;
      if (name.startsWith('../apis/')) return express.Router();
      throw new Error(`Unmocked import: ${name}`);
    },
  });
  app.use('/api', apiModule.exports);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/plugin-stats/test.plugin`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  getPublicStats.mockReset().mockResolvedValue({ ...fixture });
});

it('keeps the plugin API aliases separate from public stats', async () => {
  for (const prefix of ['plugin', 'plugins']) {
    const original = base.replace('/plugin-stats/', `/${prefix}/`);
    expect(await (await fetch(original)).json()).toEqual({ plugin: 'test.plugin' });
    expect((await fetch(`${original}/rating.svg`)).status).toBe(404);
  }
  expect(getPublicStats).not.toHaveBeenCalled();
  expect((await fetch(`${base}/rating.svg`)).status).toBe(200);
});

it('returns only compact public fields with numeric counts, UTC release time and public CORS', async () => {
  const response = await fetch(base, { headers: { Origin: 'https://example.com' } });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(response.headers.get('access-control-expose-headers')).toBe('ETag, Retry-After');
  expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  expect(response.headers.get('cache-control')).toBe('public, max-age=300, must-revalidate');
  expect(await response.json()).toEqual({
    id: 'test.plugin',
    name: 'Test Plugin',
    version: '1.2.3',
    downloads: 12345,
    votes_up: 24,
    votes_down: 1,
    rating: 96,
    updated_at: '2026-11-18T04:30:00.000Z',
  });
  expect(getPublicStats).toHaveBeenCalledWith('test.plugin');
});

it('allows conditional-read preflights through the global handler only for the public stats namespace', async () => {
  const headers = {
    Origin: 'https://example.com',
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'if-none-match,cache-control,pragma',
  };
  const allowed = await fetch(base, { method: 'OPTIONS', headers });
  expect(allowed.status).toBe(204);
  expect(allowed.headers.get('access-control-allow-origin')).toBe('*');
  expect(allowed.headers.get('access-control-allow-headers').toLowerCase()).toBe('if-none-match, cache-control, pragma');
  expect(allowed.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS');
  expect(allowed.headers.has('access-control-allow-credentials')).toBe(false);
  for (const prefix of ['plugin', 'plugin-stats-private']) {
    const privateApi = await fetch(base.replace('plugin-stats', prefix), { method: 'OPTIONS', headers });
    expect(privateApi.headers.has('access-control-allow-origin')).toBe(false);
  }
  expect(getPublicStats).not.toHaveBeenCalled();
});

it.each([
  ['downloads', 'downloads: 12,345'],
  ['rating', 'rating: 96%'],
  ['version', 'version: 1.2.3'],
  ['updated', 'updated: 2026-11-18'],
])('serves a valid accessible SVG for %s', async (metric, title) => {
  const response = await fetch(`${base}/${metric}.svg`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('image/svg+xml');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  const dom = new JSDOM(await response.text(), { contentType: 'image/svg+xml' });
  expect(dom.window.document.querySelector('title').textContent).toBe(title);
  expect(dom.window.document.documentElement.getAttribute('aria-label')).toBe(title);
  dom.window.close();
});

it('escapes stored text so a version cannot inject SVG elements or attributes', async () => {
  getPublicStats.mockResolvedValue({ ...fixture, version: '<script>&"\'\u0001' });
  const response = await fetch(`${base}/version.svg`);
  const dom = new JSDOM(await response.text(), { contentType: 'image/svg+xml' });
  expect(dom.window.document.querySelector('script')).toBeNull();
  expect(dom.window.document.querySelector('title').textContent).toBe('version: <script>&"\'');
  dom.window.close();
});

it('represents no reviews as unrated, preserves zero approval and falls back to creation time', () => {
  const stats = badges.publicStats({ ...fixture, downloads: null, votes_up: null, votes_down: null, package_updated_at: null });
  expect(stats).toMatchObject({ downloads: 0, rating: null, updated_at: '2026-10-01T00:00:00.000Z' });
  expect(badges.pluginBadge(stats, 'rating')).toContain('rating: unrated');
  expect(badges.publicStats({ ...fixture, votes_up: 0 }).rating).toBe(0);
});

it('uses ETags for unchanged stats and serves changed data after revalidation', async () => {
  const first = await fetch(base);
  // Undici otherwise adds no-cache to conditional requests, forcing Express to return 200.
  const headers = { 'If-None-Match': first.headers.get('etag'), 'Cache-Control': 'max-age=0' };
  expect((await fetch(base, { headers })).status).toBe(304);
  getPublicStats.mockResolvedValue({ ...fixture, downloads: '12346' });
  const changed = await fetch(base, { headers });
  expect(changed.status).toBe(200);
  expect((await changed.json()).downloads).toBe(12346);
  const head = await fetch(`${base}/rating.svg`, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
});

it('rejects unknown metrics and invalid IDs before reading stats', async () => {
  expect((await fetch(`${base}/__proto__.svg`)).status).toBe(400);
  expect((await fetch(base.replace('test.plugin', 'bad!'))).status).toBe(404);
  expect(getPublicStats).not.toHaveBeenCalled();
});

it('returns uncached errors for missing or nonpublic plugins and hides internal failures', async () => {
  getPublicStats.mockResolvedValue(undefined);
  for (const suffix of ['', '/version.svg']) {
    const missing = await fetch(`${base}${suffix}`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(await missing.text()).toContain('Plugin not found');
  }
  getPublicStats.mockRejectedValue(new Error('private database details'));
  const failed = await fetch(base);
  expect(failed.status).toBe(503);
  expect(failed.headers.get('cache-control')).toBe('no-store');
  expect(await failed.json()).toEqual({ error: 'Plugin stats unavailable' });
});

it('requires approved status and binds the ID in the lightweight entity lookup', async () => {
  // biome-ignore lint/complexity/noStaticOnlyClass: Mock the base class without opening a database.
  class Entity {
    static execSqlGet = vi.fn().mockResolvedValue(fixture);
  }
  const filename = path.resolve(import.meta.dirname, '../../server/entities/plugin.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require(name) {
      if (name !== './entity') throw new Error(`Unmocked import: ${name}`);
      return Entity;
    },
  });
  await module.exports.getPublicStats("test' OR 1=1 --");
  const [sql, values] = Entity.execSqlGet.mock.calls[0];
  expect(sql).toMatch(/FROM plugin WHERE id = \? AND status = \?/);
  expect(sql).not.toMatch(/JOIN|\*/i);
  expect(values).toEqual(["test' OR 1=1 --", 1]);
});
