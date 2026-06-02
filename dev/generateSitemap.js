const fs = require('node:fs');
const puppeteer = require('puppeteer');

const BASE_URL = 'https://acode.app';
const visited = new Set();
// const sitemapEntries = [];

/**
 * Pages that should NOT appear in sitemap.
 * Includes auth pages, user pages, account pages, admin pages,
 * query-parameter URLs, hash fragments, and non-indexable assets.
 */
const EXCLUDED_PATTERNS = [
  '/login',
  '/register',
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

  // BASE_URL is already added via visited.add(normalized) above

  console.info(`Crawling: ${normalized}`);

  try {
    const page = await browser.newPage();
    await page.goto(normalized, { waitUntil: 'networkidle2', timeout: 30000 });
    const links = await page.$$eval('a[href]', (anchors) => anchors.map((a) => new URL(a.getAttribute('href'), location.origin).href));

    await page.close();

    for (const link of links) {
      const linkNormalized = normalizeUrl(link);
      if (!visited.has(linkNormalized) && !isExcluded(linkNormalized)) {
        await crawl(linkNormalized, browser);
      }
    }
  } catch (error) {
    console.error(`Failed to crawl ${normalized}:`, error.message);
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
