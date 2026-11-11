import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import Handlebars from 'handlebars';

const { createFaqReader } = require('../../server/lib/faqCatalog');
const faqPages = require('../../server/routes/faqPages');
const { hashString, verifiedCategory } = require('../../shared/faqs');

it('serves readable FAQ HTML, picks up edits and distinguishes missing questions from missing data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'faq-pages-'));
  const file = path.join(dir, 'fixture.json');
  const read = createFaqReader(file);
  const template = Handlebars.compile(await fs.readFile(new URL('../../server/index.hbs', import.meta.url), 'utf8'));
  const app = express();
  app.use(
    '/faqs',
    faqPages((_path, page, schema) => template({ ...page, pageSchema: schema && JSON.stringify(schema) }), read),
  );
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/faqs`;
    const faq = { q: 'How?', a: '**Run** this [example](/help):\n\n```sh\necho "$MY_VAR" > result\n```' };
    const id = hashString(faq.q);
    await fs.writeFile(
      file,
      JSON.stringify({ categories: [null, { id: 'empty' }, { id: 'general', faqs: [null, { a: 'No question' }, { q: 'No answer' }, faq] }] }),
    );
    const list = await (await fetch(base)).text();
    const schema = JSON.parse(list.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    expect(schema.mainEntity.map((entry) => entry.name)).toContain(faq.q);
    expect(list).not.toContain('No answer');
    const first = await read();
    expect(await read()).toBe(first);
    const response = await fetch(`${base}/${id}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('<h1>How?</h1>');
    expect(html).toContain('Run this example:');
    expect(html).toContain('$MY_VAR');
    expect(html).toContain('&gt; result');
    expect(html).not.toContain('**Run**');
    const builtIn = hashString(verifiedCategory().faqs[0].q);
    expect((await fetch(`${base}/${builtIn}`)).status).toBe(200);
    await fs.writeFile(file, JSON.stringify({}));
    expect((await fetch(`${base}/${id}`)).status).toBe(404);
    const ios = await fetch(`${base}/${id}?src=ios`, { redirect: 'manual' });
    expect(ios.headers.get('location')).toBe('/faqs?src=ios');
    await fs.unlink(file);
    const partial = await fetch(base);
    expect(partial.status).toBe(200);
    expect(partial.headers.get('cache-control')).toBe('no-store');
    expect(await partial.text()).toContain(`href="/faqs/${builtIn}"`);
    expect((await fetch(`${base}/${builtIn}`)).status).toBe(200);
    const unavailable = await fetch(`${base}/${id}`);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toContain('<h1>Question temporarily unavailable</h1>');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
