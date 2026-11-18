const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createOgImageHandler, OG_CACHE_MS, OG_CACHE_CONTROL } = require('../../server/lib/ogImageResponse');
const { clearOgImageCache, renderDefaultOgImage } = require('../../server/lib/ogImage');

// Exercise the real route without starting the server or opening its database.
const source = fs.readFileSync(path.resolve(__dirname, '../../server/main.js'), 'utf8');
const routeStart = source.lastIndexOf('  app.get(', source.indexOf("'/og/default.png'"));
const routeEnd = source.lastIndexOf('  app.get(', source.indexOf("'/og/plugin/:id.png'"));
const route = source.slice(routeStart, routeEnd);
let handler;
let count;
let now;

beforeEach(() => {
  clearOgImageCache();
  now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  count = vi.fn();
  vm.runInNewContext(route, {
    app: {
      get: (_path, callback) => {
        handler = callback;
      },
    },
    Plugin: { count, STATUS: 'status', STATUS_APPROVED: 1 },
    createOgImageHandler,
    renderDefaultOgImage,
  });
});

afterEach(() => vi.restoreAllMocks());

async function request(etag) {
  const headers = {};
  const response = {
    statusCode: 200,
    setHeader: (name, value) => {
      headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    end: vi.fn(),
    send: vi.fn(),
  };
  const next = vi.fn();
  await handler(
    {
      headers: { 'if-none-match': etag },
      get fresh() {
        return Boolean(etag && etag === headers.ETag);
      },
    },
    response,
    next,
  );
  expect(next).not.toHaveBeenCalled();
  return { ...response, headers };
}

it('serves cached default cards and refreshes the count after two days', async () => {
  count.mockResolvedValueOnce(287).mockResolvedValueOnce(500);
  const first = await request();
  expect(first.headers['Cache-Control']).toBe(OG_CACHE_CONTROL);
  const unchanged = await request(first.headers.ETag);
  expect(unchanged.statusCode).toBe(304);
  expect(count).toHaveBeenCalledTimes(1);
  now += OG_CACHE_MS;
  const stale = await request();
  expect(stale.headers.ETag).toBe(first.headers.ETag);
  await vi.waitFor(async () => {
    const changed = await request(first.headers.ETag);
    expect(changed.statusCode).toBe(200);
    expect(changed.headers.ETag).not.toBe(first.headers.ETag);
  });
  expect(count).toHaveBeenCalledTimes(2);
  expect(count).toHaveBeenCalledWith(['status', 1]);
});

it('serves a count-free image on count failure and refreshes after recovery', async () => {
  count.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(1000);
  const fallback = await request();
  expect(fallback.headers['Cache-Control']).toBe('no-store');
  expect(fallback.send).toHaveBeenCalledWith(await renderDefaultOgImage(null));
  const cached = await request();
  expect(cached.headers.ETag).toBe(fallback.headers.ETag);
  expect(count).toHaveBeenCalledTimes(1);
  now += 60000;
  await request();
  await vi.waitFor(async () => {
    const recovered = await request(fallback.headers.ETag);
    expect(recovered.statusCode).toBe(200);
    expect(recovered.headers.ETag).not.toBe(fallback.headers.ETag);
  });
});
