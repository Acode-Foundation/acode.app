const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createOgImageHandler, OG_CACHE_MS, OG_CACHE_CONTROL } = require('../../server/lib/ogImageResponse');
const { pluginReleaseToken } = require('../../shared/metadataText');
const { publicStats } = require('../../server/lib/pluginBadge');

// Exercise the actual handler without starting the app or loading its database.
const source = fs.readFileSync(path.resolve(__dirname, '../../server/main.js'), 'utf8');
const routeStart = source.lastIndexOf('  app.get(', source.indexOf("'/og/plugin/:id.png'"));
const routeEnd = source.lastIndexOf('  app.get(', source.indexOf("'/og/plugins.png'", routeStart));
const route = source.slice(routeStart, routeEnd);
const fixture = {
  id: 'test.plugin',
  name: 'Test',
  author: 'Author',
  version: '1.2.3',
  downloads: '120',
  votes_up: 9,
  votes_down: 1,
  package_updated_at: '2026-11-18 04:30:00',
};
let handler;
let get;
let render;
let now;

beforeEach(() => {
  now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  get = vi.fn().mockResolvedValue({ ...fixture });
  render = vi.fn(async (input) => Buffer.from(JSON.stringify(input)));
  const Plugin = { getPublicOgData: get };
  vm.runInNewContext(route, {
    app: {
      get: (_path, callback) => {
        handler = callback;
      },
    },
    Plugin,
    publicStats,
    pluginReleaseToken,
    createOgImageHandler,
    getPluginIconPath: () => null,
    renderPluginOgImage: render,
  });
});

afterEach(() => vi.restoreAllMocks());

async function request(etag) {
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send: vi.fn(),
    end: vi.fn(),
  };
  const next = vi.fn();
  await handler(
    {
      params: { id: fixture.id },
      headers: { 'if-none-match': etag },
      get fresh() {
        return Boolean(etag && etag === headers.ETag);
      },
    },
    res,
    next,
  );
  expect(next).not.toHaveBeenCalled();
  return { ...res, headers };
}

it('loads only approved plugin data and passes current public stats to the image renderer', async () => {
  const response = await request();
  expect(get).toHaveBeenCalledWith(fixture.id);
  expect(render).toHaveBeenCalledWith({
    id: fixture.id,
    name: 'Test',
    author: 'Author',
    iconPath: null,
    version: '1.2.3',
    downloads: 120,
    rating: 90,
    updatedAt: fixture.package_updated_at,
  });
  expect(response.headers['Cache-Control']).toBe(OG_CACHE_CONTROL);
});

it('serves cached stats for two days, then refreshes the image in the background', async () => {
  const first = await request();
  get.mockResolvedValue({ ...fixture, version: '1.2.4', downloads: '121', votes_up: 10 });
  now += OG_CACHE_MS - 1;
  const cached = await request(first.headers.ETag);
  expect(cached.statusCode).toBe(304);
  expect(cached.headers.ETag).toBe(first.headers.ETag);
  expect(get).toHaveBeenCalledTimes(1);
  expect(render).toHaveBeenCalledTimes(1);
  now += 1;
  const stale = await request();
  expect(stale.send).toHaveBeenCalledWith(first.send.mock.calls[0][0]);
  await vi.waitFor(async () => {
    const refreshed = await request(first.headers.ETag);
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.headers.ETag).not.toBe(first.headers.ETag);
  });
  expect(get).toHaveBeenCalledTimes(2);
  expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ version: '1.2.4', downloads: 121, rating: 91 }));
});

it('returns 404 without rendering missing or nonpublic plugins', async () => {
  get.mockResolvedValue(undefined);
  expect((await request()).statusCode).toBe(404);
  expect(render).not.toHaveBeenCalled();
});

it.each([
  [{ updated_at: '2099-01-01' }, fixture.package_updated_at],
  [{ package_updated_at: null, updated_at: '2099-01-01' }, fixture.version],
  [{ package_updated_at: null, version: null, created_at: '2026-01-01' }, '2026-01-01'],
])('uses the stable release token instead of mutable row timestamps', async (fields, token) => {
  get.mockResolvedValue({ ...fixture, ...fields });
  await request();
  expect(render).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: token }));
});
