const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { clearOgImageCache, renderDefaultOgImage } = require('../../server/lib/ogImage');

// Exercise the real route without starting the server or opening its database.
const source = fs.readFileSync(path.resolve(__dirname, '../../server/main.js'), 'utf8');
const route = source.slice(source.indexOf("  app.get('/og/default.png'"), source.indexOf("  app.get('/og/plugin/:id.png'"));
const helpers = source.slice(source.indexOf('function createEtag('), source.indexOf('function getPluginIconPath('));
const sender = source.slice(source.indexOf('function sendOgImage('), source.lastIndexOf('start();'));
let handler;
let count;

beforeEach(() => {
  clearOgImageCache();
  count = vi.fn();
  vm.runInNewContext(
    `${source.match(/const OG_CACHE_CONTROL = .*;/)[0]}\n${source.match(/const DEFAULT_OG_CACHE_CONTROL = .*;/)[0]}\n${helpers}\n${sender}\n${route}`,
    {
      app: {
        get: (_path, callback) => {
          handler = callback;
        },
      },
      Plugin: { count, STATUS: 'status', STATUS_APPROVED: 1 },
      crypto,
      renderDefaultOgImage,
    },
  );
});

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
  await handler({ headers: { 'if-none-match': etag } }, response, next);
  expect(next).not.toHaveBeenCalled();
  return { ...response, headers };
}

it('revalidates the current count before returning 304 and changes ETag with the displayed milestone', async () => {
  count.mockResolvedValueOnce(287).mockResolvedValueOnce(499).mockResolvedValueOnce(500);
  const first = await request();
  expect(first.headers['Cache-Control']).toBe('public, max-age=300, must-revalidate');
  const unchanged = await request(first.headers.ETag);
  expect(unchanged.statusCode).toBe(304);
  expect(unchanged.send).not.toHaveBeenCalled();
  expect(unchanged.headers.ETag).toBe(first.headers.ETag);
  const changed = await request(first.headers.ETag);
  expect(changed.statusCode).toBe(200);
  expect(changed.headers.ETag).not.toBe(first.headers.ETag);
  expect(changed.send).toHaveBeenCalledOnce();
  expect(count).toHaveBeenCalledTimes(3);
  expect(count).toHaveBeenCalledWith(['status', 1]);
});

it('serves a count-free image on count failure and refreshes after recovery', async () => {
  count.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(1000);
  const fallback = await request();
  expect(fallback.send).toHaveBeenCalledWith(await renderDefaultOgImage(null));
  const recovered = await request(fallback.headers.ETag);
  expect(recovered.statusCode).toBe(200);
  expect(recovered.headers.ETag).not.toBe(fallback.headers.ETag);
});
