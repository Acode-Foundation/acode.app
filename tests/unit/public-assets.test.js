const { request } = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sendPublicAsset } = require('../../server/lib/publicAssets');

let directory;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acode-assets-test-'));
  for (const name of ['main.js', 'main.js.br', 'main.js.gz', 'demo.1234abcd.mp4', 'poster.1234abcd.webp'])
    fs.writeFileSync(path.join(directory, name), 'fixture');
});
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
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

it.each(['main.js.br', 'main.js.gz'])('does not expose raw companion %s', (file) => {
  const { res } = serve(file);
  expect(res.sendStatus).toHaveBeenCalledWith(404);
  expect(res.sendFile).not.toHaveBeenCalled();
});
