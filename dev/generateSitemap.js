const fs = require('node:fs');
const puppeteer = require('puppeteer');

const BASE_URL = 'https://acode.app';
const visited = new Set('https://acode.app');
const sitemap = ['https://acode.app'];

async function crawl(url, browser) {
  if (visited.has(url) || !url.startsWith(BASE_URL)) {
    return;
  }

  visited.add(url);
  sitemap.push(url);
  console.info(`Crawling: ${url}`);

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    const links = await page.$$eval('a[href]', (anchors) => anchors.map((a) => new URL(a.getAttribute('href'), location.origin).href));

    await page.close();

    for (const link of links) {
      console.info(`Found link: ${link}`);
      if (!visited.has(link)) {
        await crawl(link, browser);
      }
    }
  } catch (error) {
    console.error(`Failed to crawl ${url}:`, error.message);
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
    // login using test account
    const page = await browser.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await crawl(BASE_URL, browser);
    console.info(`Crawled ${sitemap.length} pages.`);
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap.map((url) => `  <url><loc>${url.replaceAll('&', '&amp;')}</loc></url>`).join('\n')}
</urlset>`;

    fs.writeFileSync('sitemap.xml', sitemapXml);
    process.stdout.write('Sitemap generated successfully!\n');
  } finally {
    await browser.close();
  }
}

generateSitemap();
