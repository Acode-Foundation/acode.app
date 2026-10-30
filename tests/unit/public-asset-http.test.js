const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const errorHandler = require('../../server/lib/errorHandler');
const { sendPublicAsset } = require('../../server/lib/publicAssets');

let directory;
let server;
let base;
const content = Buffer.from('0123456789');

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acode-asset-http-'));
  for (const name of ['demo.1234abcd.mp4', 'main.js']) fs.writeFileSync(path.join(directory, name), content);
  const app = express();
  app.get('/:name', (req, res, next) => sendPublicAsset(req, res, path.join(directory, path.basename(req.params.name)), next));
  // Use the same error middleware as server/main.js without starting the app
  // or importing its database, migrations, credentials, or external services.
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});

function get(name, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get(`${base}/${name}`, { headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      })
      .on('error', reject);
  });
}

it.each(['demo.1234abcd.mp4', 'main.js'])('preserves a valid byte range for %s', async (name) => {
  const res = await get(name, { Range: 'bytes=2-5' });
  expect(res.status).toBe(206);
  expect(res.headers['content-range']).toBe('bytes 2-5/10');
  expect(res.headers['content-length']).toBe('4');
  expect(res.headers['content-encoding']).toBeUndefined();
  expect(res.body).toBe('2345');
});

it.each(['demo.1234abcd.mp4', 'main.js'])('returns an empty 416, not a JSON 500, for an unsatisfiable range on %s', async (name) => {
  const res = await get(name, { Range: 'bytes=99999-99999' });
  expect(res.status).toBe(416);
  expect(res.headers['content-range']).toBe('bytes */10');
  expect(res.headers['content-encoding']).toBeUndefined();
  expect(res.body).toBe('');
});

it('retains response revalidation with the application middleware installed', async () => {
  const first = await get('demo.1234abcd.mp4');
  expect(first.status).toBe(200);
  expect(first.body).toBe(content.toString());
  expect(first.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  const cached = await get('demo.1234abcd.mp4', { 'If-None-Match': first.headers.etag });
  expect(cached.status).toBe(304);
  expect(cached.body).toBe('');
});

it('delegates errors after headers are sent instead of attempting a second response', () => {
  const error = new Error('Interrupted stream');
  const next = vi.fn();
  const res = { headersSent: true, status: vi.fn() };
  errorHandler(error, {}, res, next);
  expect(next).toHaveBeenCalledExactlyOnceWith(error);
  expect(res.status).not.toHaveBeenCalled();
});
