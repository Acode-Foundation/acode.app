import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import express, { Router } from 'express';

let faqsJson;
let writes;
let user;
let server;
let base;

beforeEach(async () => {
  faqsJson = JSON.stringify({ categories: [{ id: 'general', faqs: [{ q: 'Existing?', a: 'Yes.', tags: [] }] }] });
  writes = [];
  user = null;
  const stubFs = {
    readFileSync: () => faqsJson,
    writeFileSync: (_file, data) => {
      writes.push(data);
      faqsJson = data;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../../server/apis/faqs.js', import.meta.url), 'utf8'), {
    module,
    __dirname: path.resolve('server/apis'),
    require: (name) =>
      ({ 'node:path': path, 'node:fs': stubFs, express: { Router }, '../lib/helpers': { getWebLoggedInUser: async () => user } })[name],
    JSON,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/faqs', module.exports);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/faqs`;
});

afterEach(() => server.close());

function send(method, body) {
  return fetch(method === 'DELETE' ? `${base}?q=Existing%3F` : base, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
}

it('lets anyone read FAQs', async () => {
  const res = await fetch(base);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([{ q: 'Existing?', a: 'Yes.', tags: [] }]);
});

it.each([
  ['signed out', null],
  ['a regular user', { id: 1, isAdmin: false }],
])('refuses changes from %s', async (_label, account) => {
  user = account;
  for (const [method, body] of [
    ['POST', { q: 'New?', a: '<img src=x onerror=alert(1)>' }],
    ['PUT', { old_q: 'Existing?', q: 'Changed?', a: 'No.' }],
    ['DELETE'],
  ]) {
    expect((await send(method, body)).status).toBe(401);
  }
  expect(writes).toEqual([]);
});

it('lets admins add, edit and delete FAQs', async () => {
  user = { id: 1, isAdmin: true };
  expect((await send('POST', { q: 'New?', a: 'Added.' })).status).toBe(200);
  expect((await send('PUT', { old_q: 'Existing?', q: 'Existing?', a: 'Edited.' })).status).toBe(200);
  expect((await send('DELETE')).status).toBe(200);
  expect(JSON.parse(faqsJson).categories[0].faqs).toEqual([{ q: 'New?', a: 'Added.', tags: [] }]);
});
