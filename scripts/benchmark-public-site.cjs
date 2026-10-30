// Isolated production benchmark: fixture APIs only, no application server or database.
const root = require('node:path').resolve(__dirname, '..');
const fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const express = require('express'),
  Handlebars = require('handlebars'),
  puppeteer = require('puppeteer');
const { rateLimit } = require('express-rate-limit');
const { sendPublicAsset } = require('../server/lib/publicAssets');
if (!process.argv[2] || !process.argv[3])
  throw new Error('Usage: node scripts/benchmark-public-site.cjs BASELINE_SNAPSHOT OPTIMIZED_PUBLIC_DIR [REPORT_JSON]');
const report = process.argv[4] || require('node:path').join(require('node:os').tmpdir(), 'acode-performance-results.json');
const builds = {
  baseline: { dir: path.resolve(process.argv[2], 'public'), template: path.resolve(process.argv[2], 'index.hbs') },
  optimized: { dir: path.resolve(process.argv[3]), template: path.join(root, 'server/index.hbs') },
};
const profiles = [
  { name: '1.6Mbps', down: 1600000 / 8, latency: 150 },
  { name: '400Kbps', down: 400000 / 8, latency: 400 },
];
const plugin = {
  id: 'fixture.plugin',
  name: 'Example plugin',
  author: 'Fixture author',
  downloads: 12345,
  price: 0,
  status_text: 'Approved',
  supported_editor: 'all',
  votes_up: 10,
  votes_down: 0,
  comment_count: 2,
};
async function fixture(build) {
  const app = express();
  // Allow normal benchmark bursts while bounding filesystem work on loopback.
  // Omit rate-limit headers so they do not inflate transfer measurements.
  app.use(rateLimit({ windowMs: 60000, limit: 1000, standardHeaders: false, legacyHeaders: false }));
  const html = Handlebars.compile(fs.readFileSync(build.template, 'utf8'))({ title: 'Acode performance fixture', adsDisabled: true });
  app.get('/api/login', (_q, r) => r.json({ error: 'Not signed in' }));
  app.get('/api/promotions', (_q, r) => r.json([]));
  app.get('/api/plugins/count', (_q, r) => r.json({ count: 451 }));
  app.get('/api/plugins/home/list', (_q, r) =>
    r.json({ count: 451, plugins: Array.from({ length: 8 }, (_, i) => ({ ...plugin, id: `fixture${i}` })) }),
  );
  app.get('/api/plugin', (_q, r) => r.json([plugin]));
  app.get('/api/sponsors', (_q, r) => r.json([]));
  app.get('/plugin-icon/:id', (_q, r) => r.type('svg').sendFile(path.join(root, 'client/res/logo.svg')));
  app.get('/:filename', (q, r, next) => {
    const file = path.join(build.dir, path.basename(q.params.filename));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
    if (build === builds.optimized) sendPublicAsset(q, r, file, next);
    else r.sendFile(file);
  });
  app.use((_q, r) => r.type('html').send(html));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
(async () => {
  const servers = await Promise.all(Object.values(builds).map(fixture));
  let browser;
  const result = {
    note: 'Local production artifacts and fixture APIs; external font CSS stubbed empty; GitHub, ads and analytics blocked in both builds. 390x844, DPR 1, 4x CPU. No database.',
    initial: [],
    video: [],
  };
  try {
    browser = await puppeteer.launch({ headless: true, protocolTimeout: 300000 });
    for (const [buildIndex, name] of Object.keys(builds).entries())
      for (const profile of profiles) {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
        const cdp = await page.createCDPSession();
        await cdp.send('Network.enable');
        await cdp.send('Network.setBlockedURLs', { urls: ['*://api.github.com/*', '*://*.googlesyndication.com/*', '*://*.google-analytics.com/*'] });
        await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*://fonts.googleapis.com/*' }] });
        cdp.on('Fetch.requestPaused', (e) =>
          cdp.send('Fetch.fulfillRequest', {
            requestId: e.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/css' }],
            body: '',
          }),
        );
        page.on('requestfailed', (r) => console.log('FAILED', r.url(), r.failure()?.errorText));
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: profile.latency,
          downloadThroughput: profile.down,
          uploadThroughput: profile.down,
          connectionType: 'cellular3g',
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await page.evaluateOnNewDocument(() => {
          window.metrics = { cls: 0, lcp: 0 };
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) if (!e.hadRecentInput) window.metrics.cls += e.value;
          }).observe({ type: 'layout-shift', buffered: true });
          new PerformanceObserver((l) => {
            window.metrics.lcp = l.getEntries().at(-1).startTime;
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        });
        let bytes = 0,
          requests = [];
        cdp.on('Network.loadingFinished', (e) => {
          bytes += e.encodedDataLength;
        });
        cdp.on('Network.requestWillBeSent', (e) => requests.push(e.request.url));
        page.on('pageerror', (e) => console.log('PAGE ERROR', name, e.message));
        for (let run = 0; run < 3; run++)
          for (const cache of ['cold', 'warm']) {
            if (cache === 'cold') await cdp.send('Network.clearBrowserCache');
            bytes = 0;
            requests = [];
            await page.goto(servers[buildIndex].url, { waitUntil: 'domcontentloaded', timeout: 90000 });
            await page.waitForSelector('#home h1', { timeout: 90000 });
            const contentMs = await page.evaluate(() => performance.now());
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 90000 });
            const row = await page.evaluate(() => ({
              ...window.metrics,
              posterReady: document.querySelector('.home-demo__poster')?.complete ?? null,
              overflow: document.querySelector('#app').scrollWidth > innerWidth,
            }));
            const item = {
              build: name,
              profile: profile.name,
              run: run + 1,
              cache,
              bytes,
              requests: requests.length,
              contentMs: Math.round(contentMs),
              ...row,
              videoRequests: requests.filter((u) => u.includes('.mp4')).length,
            };
            result.initial.push(item);
            console.log(JSON.stringify(item));
            fs.writeFileSync(report, JSON.stringify(result, null, 2));
          }
        // Dedicated playback measurement, separate from the initial-page runs.
        const hasDemo = await page.evaluate(() => Boolean(document.querySelector('.home-demo video')));
        if (!hasDemo) {
          result.video.push({ build: name, profile: profile.name, skipped: 'No demo video in this build' });
          fs.writeFileSync(report, JSON.stringify(result, null, 2));
          await page.close();
          continue;
        }
        await cdp.send('Network.clearBrowserCache');
        requests = [];
        await page.$eval('.home-demo', (el) => el.scrollIntoView({ block: 'center' }));
        await page.evaluate(() => {
          window.playStarted = performance.now();
          window.waits = 0;
          document.querySelector('video').addEventListener('waiting', () => {
            if (document.querySelector('.home-demo').classList.contains('is-playing')) window.waits++;
          });
        });
        await page.tap('[data-play-demo]');
        let error;
        try {
          await page.waitForFunction(() => document.querySelector('.home-demo').classList.contains('is-playing'), { timeout: 240000 });
        } catch (e) {
          error = e.message;
        }
        const startupMs = await page.evaluate(() => performance.now() - window.playStarted);
        if (!error) await new Promise((resolve) => setTimeout(resolve, 10000));
        const playback = await page.evaluate(() => ({
          bufferingEvents: window.waits,
          readyState: document.querySelector('video').readyState,
          source: document.querySelector('video').currentSrc,
          paused: document.querySelector('video').paused,
        }));
        result.video.push({
          build: name,
          profile: profile.name,
          startupMs: Math.round(startupMs),
          ...playback,
          error,
          uniqueVideoUrls: [...new Set(requests.filter((u) => u.includes('.mp4')))],
        });
        console.log('VIDEO', JSON.stringify(result.video.at(-1)));
        fs.writeFileSync(report, JSON.stringify(result, null, 2));
        await page.close();
      }
  } finally {
    await browser?.close();
    for (const { server } of servers) await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
