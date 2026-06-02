const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const sqlite3 = require('better-sqlite3');

const BASE_URL = 'https://acode.app';
const visited = new Set();

const DB_FILE = path.resolve(__dirname, '../data/db.sqlite3');
const FAQS_FILE = path.resolve(__dirname, '../data/faqs.json');

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash).toString(36);
}

/**
 * Adds all plugin and FAQ detail-page URLs directly from the database
 * and JSON files, skipping the need to crawl them.
 */
function addPluginAndFaqUrls() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const db = sqlite3(DB_FILE);
      const plugins = db.prepare('SELECT id FROM plugin WHERE status = 1').all();
      for (const { id } of plugins) {
        visited.add(`${BASE_URL}/plugin/${id}`);
      }
      console.info(`Added ${plugins.length} plugin detail pages from DB`);
      db.close();
    }
  } catch (err) {
    console.error('Failed to read plugins from DB:', err.message);
  }

  try {
    if (fs.existsSync(FAQS_FILE)) {
      const faqs = JSON.parse(fs.readFileSync(FAQS_FILE, 'utf8'));
      for (const { q } of faqs) {
        const id = hashString(q);
        visited.add(`${BASE_URL}/faqs/${id}`);
      }
      console.info(`Added ${faqs.length} FAQ detail pages from JSON`);
    }
  } catch (err) {
    console.error('Failed to read FAQs from JSON:', err.message);
  }
}

/**
 * Pages that should NOT appear in sitemap.
 * Includes auth pages, user pages, account pages, admin pages,
 * query-parameter URLs, hash fragments, and non-indexable assets.
 */
const EXCLUDED_PATTERNS = [
  '/login',
  '/register',
  '/logout',
  '/user',
  '/profile',
  '/change-password',
  '/payments',
  '/orders',
  '/earnings',
  '/publish',
  '/add-payment-method',
  '/oauth',
  '/update-plugin-editor',
  '/admin',
  '/become-sponsor',
  '/api',
  '/res/',
  '/plugin-icon/',
  '/plugin/',
  '/faqs/',
  '?redirect=',
  '/src/',
  '.d.ts',
  'license.md',
  'License.md',
  'License',
  'documentation.md',
  'DOCS.md',
  'CONTRIBUTING.md',
];

/**
 * Priority mapping for different page types.
 */
const LANDING_PAGE_PATHS = [
  'android-ide',
  'claude-code-android',
  'codex-android',
  'opencode-android',
  'ai-coding-android',
  'termux-alternative',
  'linux-terminal-android',
  'nodejs-android',
  'npm-android',
  'react-android',
  'nextjs-android',
  'git-android',
  'ssh-android',
  'vscode-alternative-android',
  'cursor-alternative-android',
  'windsurf-alternative-android',
  'spck-alternative',
  'web-development-android',
];

function getPriority(url) {
  const path = new URL(url).pathname;
  if (path === '/' || path === '') return '1.0';
  if (path === '/plugins') return '0.9';
  if (path === '/faqs') return '0.8';
  if (path === '/pro') return '0.9';
  if (path === '/sponsors') return '0.7';
  if (path.startsWith('/plugin/')) return '0.7';
  if (path === '/policy' || path === '/terms' || path === '/refund') return '0.3';
  if (path.startsWith('/faqs/')) return '0.5';
  if (LANDING_PAGE_PATHS.includes(path.replace(/^\//, ''))) return '0.6';
  return '0.5';
}

/**
 * Changefreq mapping for different page types.
 */
function getChangefreq(url) {
  const path = new URL(url).pathname;
  if (path === '/' || path === '') return 'weekly';
  if (path === '/plugins') return 'daily';
  if (path === '/faqs') return 'monthly';
  if (path === '/sponsors') return 'monthly';
  if (path.startsWith('/plugin/')) return 'monthly';
  return 'monthly';
}

function isExcluded(url) {
  if (!url.startsWith(BASE_URL)) return true;
  const path = new URL(url).pathname + new URL(url).search;
  if (path.includes('#')) return true;
  if (path.includes('%22')) return true;
  if (path.endsWith('.js')) return true;
  if (path.endsWith('.css')) return true;
  if (path.endsWith('.png')) return true;
  if (path.endsWith('.jpg')) return true;

  for (const pattern of EXCLUDED_PATTERNS) {
    if (path.toLowerCase().includes(pattern.toLowerCase())) return true;
  }

  return false;
}

function normalizeUrl(url) {
  const u = new URL(url);
  if (u.pathname.endsWith('/') && u.pathname.length > 1) {
    u.pathname = u.pathname.replace(/\/$/, '');
  }
  u.search = '';
  u.hash = '';
  return u.href;
}

async function crawl(url, browser) {
  const normalized = normalizeUrl(url);

  if (visited.has(normalized) || isExcluded(normalized)) {
    return;
  }

  visited.add(normalized);
  console.info(`Crawling: ${normalized}`);

  let links = [];

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'image' || type === 'font' || type === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });
    await page.goto(normalized, { waitUntil: 'networkidle2', timeout: 30000 });
    links = await page.$$eval('a[href]', (anchors) => anchors.map((a) => new URL(a.getAttribute('href'), location.origin).href));
    await page.close();
  } catch (error) {
    console.error(`Failed to crawl ${normalized}: ${error.message}`);
  }

  for (const link of links) {
    const linkNormalized = normalizeUrl(link);
    if (!visited.has(linkNormalized) && !isExcluded(linkNormalized)) {
      await crawl(linkNormalized, browser);
    }
  }
}

async function generateSitemap() {
  const browser = await puppeteer.launch({
    downloadBehavior: {
      policy: 'deny',
    },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
    ignoreDefaultArgs: ['--enable-automation'],
  });

  try {
    await crawl(BASE_URL, browser);

    for (const landingPath of LANDING_PAGE_PATHS) {
      const landingUrl = `${BASE_URL}/${landingPath}`;
      if (!visited.has(landingUrl)) {
        await crawl(landingUrl, browser);
      }
    }

    addPluginAndFaqUrls();

    const sorted = Array.from(visited)
      .filter((url) => url.startsWith(BASE_URL))
      .sort();

    const today = new Date().toISOString().split('T')[0];

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sorted
  .map(
    (url) =>
      `  <url>
    <loc>${url.replaceAll('&', '&amp;')}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${getChangefreq(url)}</changefreq>
    <priority>${getPriority(url)}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>`;

    fs.writeFileSync('sitemap.xml', sitemapXml);
    process.stdout.write(`Sitemap generated with ${sorted.length} URLs!\n`);
  } finally {
    await browser.close();
  }
}

generateSitemap();
