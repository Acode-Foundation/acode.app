const { request } = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { homePosterSrcset, sendPublicAsset } = require('../../server/lib/publicAssets');

let directory;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acode-assets-test-'));
  for (const name of ['main.js', 'main.js.br', 'main.js.gz', 'demo.1234abcd.mp4', 'poster.1234abcd.webp'])
    fs.writeFileSync(path.join(directory, name), 'fixture');
});
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());
function serve(name, headers = {}) {
  const responseHeaders = {};
  const req = { headers, acceptsEncodings: request.acceptsEncodings };
  const res = {
    vary: vi.fn(),
    type: vi.fn(),
    sendStatus: vi.fn(),
    sendFile: vi.fn(),
    setHeader: (key, value) => {
      responseHeaders[key] = value;
    },
  };
  sendPublicAsset(req, res, path.join(directory, name), vi.fn());
  return { res, headers: responseHeaders };
}
it.each([
  ['br, gzip', '.br', 'br'],
  ['gzip, br;q=0', '.gz', 'gzip'],
  ['identity', '', undefined],
  ['br;q=0, gzip;q=0', '', undefined],
])('negotiates %s', (accept, suffix, encoding) => {
  const { res, headers } = serve('main.js', { 'accept-encoding': accept });
  expect(res.sendFile.mock.calls[0][0]).toBe(path.join(directory, `main.js${suffix}`));
  expect(res.vary).toHaveBeenCalledWith('Accept-Encoding');
  expect(res.type).toHaveBeenCalledWith('.js');
  expect(headers['Content-Encoding']).toBe(encoding);
  expect(headers['Cache-Control']).toBe('public, max-age=0, must-revalidate');
});
it('rejects unacceptable encodings and leaves range responses uncompressed', () => {
  expect(serve('main.js', { 'accept-encoding': '*;q=0' }).res.sendStatus).toHaveBeenCalledWith(406);
  const { res, headers } = serve('main.js', { 'accept-encoding': 'gzip', range: 'bytes=0-3' });
  expect(res.sendFile.mock.calls[0][0]).toBe(path.join(directory, 'main.js'));
  expect(headers['Content-Encoding']).toBeUndefined();
});
it.each(['demo.1234abcd.mp4', 'poster.1234abcd.webp'])('serves immutable media without compression: %s', (name) => {
  const { res, headers } = serve(name, { 'accept-encoding': 'br, gzip', range: 'bytes=0-3' });
  expect(res.sendFile.mock.calls[0][0]).toBe(path.join(directory, name));
  expect(headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  expect(headers['Content-Encoding']).toBeUndefined();
});

it('ignores compressed companions left behind by an older build', () => {
  vi.stubEnv('NODE_ENV', 'development');
  const file = path.join(directory, 'updated.js');
  fs.writeFileSync(file, 'new development bundle');
  for (const suffix of ['.br', '.gz']) {
    fs.writeFileSync(file + suffix, 'old production bundle');
    fs.utimesSync(file + suffix, new Date(1000), new Date(1000));
  }
  const { res, headers } = serve('updated.js', { 'accept-encoding': 'br, gzip' });
  expect(res.sendFile.mock.calls[0][0]).toBe(file);
  expect(headers['Content-Encoding']).toBeUndefined();
  expect(serve('updated.js', { 'accept-encoding': 'br, identity;q=0' }).res.sendStatus).toHaveBeenCalledWith(406);
});

it.each(['production', undefined])('serves production companions regardless of write order (NODE_ENV=%s)', (environment) => {
  vi.stubEnv('NODE_ENV', environment);
  const file = path.join(directory, 'reordered.js');
  fs.writeFileSync(file, 'production bundle');
  for (const suffix of ['.br', '.gz']) {
    fs.writeFileSync(file + suffix, 'compressed production bundle');
    fs.utimesSync(file + suffix, new Date(1000), new Date(1000));
  }
  for (const [accept, suffix] of [
    ['br', '.br'],
    ['gzip', '.gz'],
  ]) {
    const { res, headers } = serve('reordered.js', { 'accept-encoding': accept });
    expect(res.sendFile.mock.calls[0][0]).toBe(file + suffix);
    expect(headers['Content-Encoding']).toBe(accept);
  }
});

it('falls back to identity when no compressed companion exists', () => {
  vi.stubEnv('NODE_ENV', 'production');
  fs.writeFileSync(path.join(directory, 'identity.js'), 'uncompressed bundle');
  const { res, headers } = serve('identity.js', { 'accept-encoding': 'br, gzip' });
  expect(res.sendFile.mock.calls[0][0]).toBe(path.join(directory, 'identity.js'));
  expect(headers['Content-Encoding']).toBeUndefined();
});

it.each(['main.js.br', 'main.js.gz'])('does not expose raw companion %s', (file) => {
  const { res } = serve(file);
  expect(res.sendStatus).toHaveBeenCalledWith(404);
  expect(res.sendFile).not.toHaveBeenCalled();
});

it('preloads the built home poster widths in order and skips ambiguous assets', () => {
  const render = require('handlebars').compile(fs.readFileSync(path.resolve(__dirname, '../../server/index.hbs'), 'utf8'));
  const poster = (width, hash) => `acode-poster-${width}.${hash}.webp`;
  for (const width of [1024, 480, 800]) fs.writeFileSync(path.join(directory, poster(width, 'abcd1234')), '');
  const srcset = [480, 800, 1024].map((width) => `/${poster(width, 'abcd1234')} ${width}w`).join(', ');
  expect(homePosterSrcset(directory)).toBe(srcset);
  expect(render({ homePoster: srcset })).toContain(`imagesrcset="${srcset}"`);
  fs.writeFileSync(path.join(directory, poster(800, 'abcd9876')), '');
  expect(homePosterSrcset(directory)).not.toContain('800w');
});
