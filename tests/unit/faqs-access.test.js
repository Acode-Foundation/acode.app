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
  expect((await fetch(base, { method: 'HEAD' })).status).toBe(200);
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

it.each(['POST', 'PUT', 'DELETE'])('rejects an incomplete admin %s request without writing FAQ data', async (method) => {
  user = { isAdmin: true };
  const res = await fetch(base, { method });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBeTruthy();
  expect(writes).toEqual([]);
});

it('lets admins add, edit and delete FAQs', async () => {
  user = { id: 1, isAdmin: true };
  expect((await send('POST', { q: 'New?', a: 'Added.' })).status).toBe(200);
  expect((await send('PUT', { old_q: 'Existing?', q: 'Existing?', a: 'Edited.' })).status).toBe(200);
  expect((await send('DELETE')).status).toBe(200);
  expect(JSON.parse(faqsJson).categories[0].faqs).toEqual([{ q: 'New?', a: 'Added.', tags: [], platform: 'both' }]);
});

it.each(['flat', 'categorized'])('filters %s FAQs by the explicit platform, retaining untagged entries on both', async (shape) => {
  const faqs = [
    { q: 'Legacy Android wording?', a: 'An untagged FAQ defaults to both.' },
    { q: 'Shared?', a: 'Yes.', platform: 'both' },
    { q: 'Storage access?', a: 'Android instructions.', platform: 'android' },
    { q: 'Files app?', a: 'iOS instructions.', platform: 'ios' },
  ];
  const categories = faqs.map((faq, index) => ({ id: String(index), name: 'Category', faqs: [faq] }));
  faqsJson = JSON.stringify(shape === 'flat' ? faqs : { categories });
  const original = faqsJson;
  for (const platform of [undefined, 'both', 'ios', 'android']) {
    const query = platform ? `?platform=${platform}` : '';
    const expected = !platform || platform === 'both' ? faqs : [...faqs.slice(0, 2), faqs[platform === 'ios' ? 3 : 2]];
    const res = await fetch(`${base}${query}`, {
      headers: { Origin: 'https://localhost', 'User-Agent': 'Mozilla/5.0 (iPhone)' },
    });
    expect(await res.json()).toEqual([...expected].reverse());
    expect((await fetch(`${base}${query}`, { method: 'HEAD' })).headers.get('etag')).toBe(res.headers.get('etag'));
    if (shape === 'categorized') {
      const grouped = await (await fetch(`${base}?categories=1${platform ? `&platform=${platform}` : ''}`)).json();
      expect(grouped).toEqual(categories.filter((category) => expected.includes(category.faqs[0])));
    }
  }
  expect(writes).toEqual([]);
  expect(faqsJson).toBe(original);
});

it.each(['flat', 'categorized'])('saves and edits platform settings in %s FAQs without losing tags', async (shape) => {
  user = { isAdmin: true };
  const existing = { q: 'Existing?', a: 'Yes.', tags: ['files'], platform: 'ios' };
  faqsJson = JSON.stringify(
    shape === 'flat'
      ? [existing]
      : {
          categories: [
            { id: 'general', faqs: [existing] },
            { id: 'other', faqs: [] },
          ],
        },
  );
  const readFaqs = () => {
    const data = JSON.parse(faqsJson);
    return Array.isArray(data) ? data : data.categories.flatMap((category) => category.faqs);
  };
  // Older editors that omit the field must not reset a saved restriction.
  expect((await send('PUT', { old_q: 'Existing?', q: 'Existing?', a: 'Edited.' })).status).toBe(200);
  expect(readFaqs()).toEqual([{ ...existing, a: 'Edited.' }]);
  for (const platform of ['android', 'ios', 'both', '']) {
    expect((await send('POST', { q: `New ${platform}?`, a: 'Added.', platform })).status).toBe(200);
    expect(readFaqs().find((faq) => faq.q === `New ${platform}?`).platform).toBe(platform || 'both');
    expect((await send('PUT', { old_q: 'Existing?', q: 'Existing?', a: 'Edited.', category: 'other', platform })).status).toBe(200);
    expect(readFaqs().find((faq) => faq.q === 'Existing?')).toEqual({ ...existing, a: 'Edited.', platform: platform || 'both' });
  }
  if (shape === 'categorized') expect(JSON.parse(faqsJson).categories[1].faqs).toHaveLength(1);
});

it('rejects invalid platform inputs before saving and leaves admin authorization intact', async () => {
  user = { isAdmin: true };
  for (const platform of ['windows', 'IOS', false, null, ['ios'], { ios: true }]) {
    for (const method of ['POST', 'PUT']) {
      expect((await send(method, { old_q: 'Existing?', q: 'Existing?', a: 'Changed.', platform })).status).toBe(400);
    }
  }
  for (const query of ['platform=windows', 'platform=', 'platform=ios&platform=android']) {
    expect((await fetch(`${base}?${query}`)).status).toBe(400);
  }
  user = null;
  expect((await send('POST', { q: 'New?', a: 'No.', platform: 'ios' })).status).toBe(401);
  expect(writes).toEqual([]);
});
