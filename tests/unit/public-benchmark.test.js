const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const Handlebars = require('handlebars');
const { rateLimit } = require('express-rate-limit');
const { JSDOM } = require('jsdom');
const { sendPublicAsset } = require('../../server/lib/publicAssets');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'scripts/benchmark-public-site.cjs'), 'utf8');

// Run the CLI's actual measurement loop with isolated pages, no browser/network/database.
it.each(['baseline', 'optimized'])('finishes every profile when %s has screenshots instead of video', async (withoutVideo) => {
  const pages = [];
  let report;
  const builds = { baseline: {}, optimized: {} };
  const browser = {
    close: vi.fn(),
    newPage: async () => {
      const name = pages.length < 2 ? 'baseline' : 'optimized';
      const dom = new JSDOM(
        `<div id="app"><main id="home"><h1>Acode</h1>${
          name === withoutVideo ? '<div class="screenshots"></div>' : '<div class="home-demo"><img class="home-demo__poster"><video></video></div>'
        }</main></div>`,
      );
      dom.window.metrics = { cls: 0, lcp: 10 };
      dom.window.HTMLElement.prototype.scrollIntoView = () => {};
      const context = vm.createContext({ window: dom.window, document: dom.window.document, innerWidth: 390, performance: { now: () => 100 } });
      const evaluate = (fn) => vm.runInContext(`(${fn.toString()})()`, context);
      const page = {
        setViewport: async () => {},
        createCDPSession: async () => ({ send: async () => {}, on: () => {} }),
        on: () => {},
        evaluateOnNewDocument: async () => {},
        goto: async () => {},
        waitForSelector: async () => {},
        waitForNetworkIdle: async () => {},
        evaluate,
        $eval: async (selector, fn) => fn(dom.window.document.querySelector(selector)),
        tap: vi.fn(async () => dom.window.document.querySelector('.home-demo').classList.add('is-playing')),
        waitForFunction: async (fn) => expect(evaluate(fn)).toBe(true),
        close: vi.fn(() => dom.window.close()),
      };
      pages.push(page);
      return page;
    },
  };
  const process = { exitCode: 0 };
  await vm.runInNewContext(source.slice(source.indexOf('(async () => {')), {
    builds,
    profiles: [
      { name: 'fast', down: 200000, latency: 150 },
      { name: 'slow', down: 50000, latency: 400 },
    ],
    fixture: async () => ({ url: 'http://fixture.invalid', server: { close: (done) => done() } }),
    puppeteer: { launch: async () => browser },
    fs: {
      writeFileSync: (_file, json) => {
        report = JSON.parse(json);
      },
    },
    report: 'unused.json',
    console: { log: () => {}, error: vi.fn() },
    setTimeout: (done) => done(),
    process,
  });
  expect(process.exitCode).toBe(0);
  expect(report.initial).toHaveLength(24);
  expect(report.initial.filter((row) => row.build === withoutVideo).every((row) => row.posterReady === null)).toBe(true);
  expect(report.initial.filter((row) => row.build !== withoutVideo).every((row) => row.posterReady === true)).toBe(true);
  expect(report.video).toHaveLength(4);
  expect(report.video.filter((row) => row.build === withoutVideo).every((row) => row.skipped === 'No demo video in this build')).toBe(true);
  expect(report.video.filter((row) => row.build !== withoutVideo).every((row) => !row.skipped && !row.error)).toBe(true);
  expect(pages.reduce((count, page) => count + page.tap.mock.calls.length, 0)).toBe(2);
  for (const page of pages) expect(page.close).toHaveBeenCalledOnce();
  expect(browser.close).toHaveBeenCalledOnce();
});

it('limits both filesystem routes before reading files, without adding headers to normal responses', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acode-benchmark-'));
  let server;
  try {
    fs.writeFileSync(path.join(directory, 'index.hbs'), '<h1>Fixture</h1>');
    fs.writeFileSync(path.join(directory, 'main.js'), '/* fixture */');
    const build = { dir: directory, template: path.join(directory, 'index.hbs') };
    const existsSync = vi.fn(fs.existsSync);
    const fixtureSource = source.slice(source.indexOf('async function fixture('), source.indexOf('(async () => {'));
    const fixture = vm.runInNewContext(`${fixtureSource}\nfixture`, {
      express,
      Handlebars,
      http,
      path,
      root,
      plugin: {},
      builds: { optimized: build },
      sendPublicAsset,
      fs: { ...fs, existsSync },
      // Exercise the real middleware with a short quota instead of making 1,001 requests.
      rateLimit: (options) => rateLimit({ ...options, limit: 2 }),
    });
    const running = await fixture(build);
    server = running.server;
    const get = (route) =>
      new Promise((resolve, reject) => {
        http
          .get(`${running.url}${route}`, (res) => {
            res.resume();
            res.on('end', () => resolve(res));
            res.on('error', reject);
          })
          .on('error', reject);
      });
    for (const route of ['/plugin-icon/test', '/main.js']) {
      const res = await get(route);
      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.headers).some((name) => /ratelimit/.test(name))).toBe(false);
    }
    expect(existsSync).toHaveBeenCalledTimes(1);
    for (const route of ['/plugin-icon/test', '/main.js']) expect((await get(route)).statusCode).toBe(429);
    expect(existsSync).toHaveBeenCalledTimes(1);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
