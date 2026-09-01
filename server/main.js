/* eslint-disable no-console */
require('dotenv').config();

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const fileUpload = require('express-fileupload');
const Handlebars = require('handlebars');
const defaultOg = require('./defaultOg.json');
const { pluginRevision } = require('../shared/ogImage.json');
const { createProfileMetadata } = require('../shared/metadataText');
const { getMetadata, getPluginsMetadata, getFaqsMetadata, FALLBACK_TITLE } = require('./routeMetadata');
const Plugin = require('./entities/plugin');
const User = require('./entities/user');
const { getLoggedInUser } = require('./lib/helpers');
const apis = require('./routes/apis');
const oauth = require('./apis/oauth');
const setAuth = require('./lib/gapis');
const migrationRunner = require('./lib/migrationRunner');
const { renderDefaultOgImage, renderPluginOgImage } = require('./lib/ogImage');
const { createMetadataContext, createPluginDescription, getPublicOrigin, localizeStructuredData, publicUrl } = require('./lib/publicMetadata');

const app = express();

const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = new Set(['https://localhost', 'https://acode.app']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LEGACY_NATIVE_CSRF_EXEMPT_PATHS = new Set(['/api/plugin/order', '/api/plugin/refund', '/api/sponsor', '/api/login']);
const PLUGIN_ICONS = path.resolve(__dirname, '../data/icons');
const OG_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';
const PUBLIC_ORIGIN = getPublicOrigin();
const renderIndexTemplate = compileTemplate('index.hbs');
const renderLandingTemplate = compileTemplate('landing.hbs');

function isSameOriginRequest(req) {
  const host = req.headers.host;
  if (!host) return false;

  const requestHost = host.toLowerCase();
  const origin = req.headers.origin;
  if (origin && hasMatchingHost(origin, requestHost)) return true;

  const referer = req.headers.referer;
  return Boolean(referer && hasMatchingHost(referer, requestHost));
}

function hasMatchingHost(value, requestHost) {
  try {
    return new URL(value).host.toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

function isLegacyNativeRequest(req) {
  return LEGACY_NATIVE_CSRF_EXEMPT_PATHS.has(req.path) && isNativeWebViewOrigin(req.headers.origin) && isNativeWebViewOrigin(req.headers.referer);
}

function isNativeWebViewOrigin(value) {
  if (!value || value === 'null') return true;

  try {
    const { protocol, hostname } = new URL(value);
    return protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

async function main() {
  app.set('trust proxy', 1);

  await setAuth();

  app.use((_req, res, next) => {
    const origin = _req.headers.origin;
    if (ALLOWED_ORIGINS.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Headers', 'Content-Type, x-auth-token, X-Requested-With');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Inject Link headers for AI crawler and sitemap discovery
  app.use((_req, res, next) => {
    res.setHeader(
      'Link',
      [`<${publicUrl('/llms.txt', PUBLIC_ORIGIN)}>; rel="llms.txt"`, `<${publicUrl('/sitemap.xml', PUBLIC_ORIGIN)}>; rel="sitemap"`].join(', '),
    );
    next();
  });

  // CSRF protection: require a custom header or same-origin on state-changing requests
  // Browsers won't send custom headers on cross-origin form submissions
  // Skip for webhooks (Razorpay sends raw JSON without custom headers)
  app.use((req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    // Skip webhook endpoint (receives callbacks from Razorpay servers)
    if (req.path === '/api/razorpay/webhook') {
      next();
      return;
    }
    // Older native app builds do not send browser Origin/Referer or CSRF headers.
    if (isLegacyNativeRequest(req)) {
      next();
      return;
    }
    // Accept if custom header is present (triggers CORS preflight for cross-origin)
    if (req.headers['x-auth-token'] || req.headers['x-requested-with']) {
      next();
      return;
    }
    // Accept if Content-Type is application/json (requires CORS preflight)
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      next();
      return;
    }
    // For form submissions (multipart/urlencoded), verify Origin/Referer is same-site
    if (isSameOriginRequest(req)) {
      next();
      return;
    }
    res.status(403).send({ error: 'Forbidden: CSRF validation failed' });
  });

  app.use(cookieParser());
  app.use(
    fileUpload({
      abortOnLimit: true,
      limits: {
        fileSize: 50 * 1024 * 1024, // 50 MB
      },
    }),
  );

  // Must come before express.json() to preserve raw body for Razorpay signature verification
  app.use('/api/razorpay/webhook', express.raw({ type: 'application/json' }));

  // Skip json parsing for webhook — raw parser already consumed the body
  app.use((req, res, next) => {
    if (req.path === '/api/razorpay/webhook') return next();
    express.json({ limit: '50mb' })(req, res, next);
  });

  app.get('/sitemap.xml', (_req, res) => {
    res.setHeader('Content-Type', 'application/xml');
    res.sendFile('sitemap.xml', { root: process.cwd() });
  });

  app.get('/robots.txt', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.sendFile('robots.txt', { root: process.cwd() });
  });

  app.get('/llms.txt', (_req, res) => {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile('llms.txt', { root: process.cwd() });
  });

  app.get('/og/default.png', async (req, res, next) => {
    try {
      const etag = createEtag('acode-default-og-v1');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      const image = await renderDefaultOgImage();
      sendOgImage(res, image, etag);
    } catch (error) {
      next(error);
    }
  });

  app.get('/og/plugin/:id.png', async (req, res, next) => {
    try {
      const id = req.params.id;
      const [plugin] = await Plugin.for('internal').get(
        [Plugin.ID, Plugin.NAME, Plugin.AUTHOR, Plugin.STATUS, Plugin.UPDATED_AT, Plugin.PACKAGE_UPDATED_AT],
        [
          [Plugin.ID, id],
          [Plugin.STATUS, Plugin.STATUS_APPROVED],
        ],
      );
      if (!plugin) {
        res.status(404).send({ error: 'Plugin not found' });
        return;
      }

      const version = plugin.package_updated_at || plugin.updated_at || 'latest';
      const etag = createEtag(`plugin-og:${pluginRevision}:${plugin.id}:${plugin.name}:${plugin.author}:${version}`);
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }

      const image = await renderPluginOgImage({
        id: plugin.id,
        name: plugin.name,
        author: plugin.author,
        iconPath: getPluginIconPath(plugin.id),
        version,
      });
      sendOgImage(res, image, etag);
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', apis);
  app.use('/api/*path', (_req, res) => {
    res.status(404).send({ error: 'Not found' });
  });

  app.use('/oauth', oauth);

  app.get('/.well-known/assetlinks.json', (_req, res) => {
    res.send([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.foxdebug.acodefree',
          sha256_cert_fingerprints: ['12:66:9B:CA:68:91:87:C3:2A:49:ED:9B:5B:06:3A:06:0E:5B:67:75:34:50:4F:46:DC:DA:A0:AF:71:90:CB:93'],
        },
      },
    ]);
  });

  app.get('/.well-known/apple-developer-merchantid-domain-association', (_req, res) => {
    res.send(
      '7b2276657273696f6e223a312c227073704964223a2231454442463046444246354641323036354532393937394332374437434337433935333431423445303635424438443838333136353830323230303941353732222c22637265617465644f6e223a313734393634363735323534317d',
    );
  });

  app.get('/schema/:type/v:version.json', (req, res) => {
    const { type, version } = req.params;
    if (!['plugin'].includes(type)) {
      res.status(404).send({ error: 'Schema not found' });
      return;
    }
    const file = path.resolve(__dirname, `./schemas/${type}.v${version}.json`);
    if (fs.existsSync(file)) {
      res.header('Content-Type', 'application/schema+json');
      const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
      res.send(schema);
      return;
    }
    res.status(404).send({ error: 'Schema not found' });
  });

  app.get('/res/:filename', (req, res) => {
    if (!/\.(png|jpg|jpeg|ico|svg|webp)$/.test(req.params.filename)) {
      res.status(404).send({ error: 'File not found' });
      return;
    }
    const file = path.resolve(__dirname, `../public/${req.params.filename}`);
    if (fs.existsSync(file)) {
      res.sendFile(file);
      return;
    }
    res.status(404).send({ error: 'File not found' });
  });

  app.get('/sponsor/image/:filename', async (req, res) => {
    const { filename } = req.params;
    const imagePath = path.resolve(__dirname, '../data/sponsors', filename);

    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.sendFile(imagePath);
  });

  app.get('/manifest.json', (_req, res) => {
    res.sendFile(path.resolve(__dirname, './manifest.json'));
  });

  app.get('/:filename', (req, res, next) => {
    if (['app-ads.txt', 'ads.txt'].includes(req.params.filename)) {
      res.sendFile(path.resolve(__dirname, '../data/ads.txt'));
      return;
    }

    const file = path.resolve(__dirname, `../public/${req.params.filename}`);
    if (fs.existsSync(file)) {
      res.sendFile(file);
      return;
    }
    next();
  });

  app.get('/plugin-icon/:id', (req, res) => {
    const file = path.resolve(__dirname, `../data/icons/${req.params.id}.png`);
    if (fs.existsSync(file)) {
      res.sendFile(file);
      return;
    }
    res.status(404).send({ error: 'Plugin not found' });
  });

  app.get(['/plugin/:id', '/plugin/:id/:section'], async (req, res, next) => {
    try {
      const [plugin] = await Plugin.get([Plugin.ID, req.params.id]);
      if (!plugin) {
        next();
        return;
      }

      const loggedInUser = await getLoggedInUser(req);
      const isOwner = loggedInUser && loggedInUser.id === plugin.user_id;

      if (plugin.status === Plugin.STATUS_DELETED && !loggedInUser?.isAdmin) {
        next();
        return;
      }

      if (plugin.status !== Plugin.STATUS_APPROVED && !loggedInUser?.isAdmin && !isOwner) {
        next();
        return;
      }

      const canonicalPath = `/plugin/${plugin.id}`;
      const pageDesc = createPluginDescription(plugin.description, `${plugin.name} is a plugin for Acode.`);
      const imagePath =
        plugin.status === Plugin.STATUS_APPROVED
          ? `/og/plugin/${encodeURIComponent(plugin.id)}.png?v=${encodeURIComponent(plugin.package_updated_at || plugin.updated_at || plugin.version || 'latest')}&r=${pluginRevision}`
          : defaultOg.image_path;

      res.header('Content-Type', 'text/html;charset=utf-8');
      res.send(
        renderIndexTemplate({
          ...createMetadataContext(defaultOg, { canonicalPath, imagePath, origin: PUBLIC_ORIGIN }),
          title: `${plugin.name} — Acode Plugin`,
          description: pageDesc,
          image_alt: `${plugin.name} plugin for Acode`,
          site_name: 'Acode',
          robots: 'index, follow',
          pageSchema: safeSchema(
            JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: plugin.name,
              applicationCategory: 'DeveloperApplication',
              operatingSystem: 'Android',
              description: pageDesc,
              url: publicUrl(canonicalPath, PUBLIC_ORIGIN),
            }),
          ),
          orgSchema: null,
        }),
      );
    } catch (_error) {
      next();
    }
  });

  // Landing pages — fully server-rendered for SEO
  const LANDING_PAGE_PATHS = [
    'claude-code-android',
    'codex-android',
    'opencode-android',
    'termux-alternative',
    'android-ide',
    'ai-coding-android',
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

  for (const landingPath of LANDING_PAGE_PATHS) {
    app.get(`/${landingPath}`, (_req, res) => {
      const pageFile = path.resolve(__dirname, `./landing-pages/${landingPath}.json`);
      if (!fs.existsSync(pageFile)) {
        res.status(404).send({ error: 'Page not found' });
        return;
      }
      const pageData = JSON.parse(fs.readFileSync(pageFile, 'utf8'));
      const canonicalPath = `/${landingPath}`;

      res.header('Content-Type', 'text/html;charset=utf-8');
      res.send(
        renderLandingTemplate({
          ...createMetadataContext(defaultOg, { canonicalPath, origin: PUBLIC_ORIGIN }),
          ...pageData,
          pageSchema: pageData.pageSchema ? safeSchema(localizeStructuredData(pageData.pageSchema, PUBLIC_ORIGIN)) : null,
        }),
      );
    });
  }

  // Plugins page — dynamic count from DB
  app.get('/plugins', async (_req, res) => {
    const pluginsMeta = await getPluginsMetadata();
    const metadata = getMetadata('/plugins');

    res.header('Content-Type', 'text/html;charset=utf-8');
    res.send(
      renderIndexTemplate({
        ...createMetadataContext(defaultOg, { canonicalPath: '/plugins', origin: PUBLIC_ORIGIN }),
        title: pluginsMeta.title,
        description: pluginsMeta.description,
        image_alt: pluginsMeta.title,
        robots: 'index, follow',
        pageSchema: metadata?.schema ? safeSchema(JSON.stringify(metadata.schema)) : null,
        orgSchema: null,
      }),
    );
  });

  // FAQs page — dynamic schema from data/faqs.json
  app.get('/faqs', (_req, res) => {
    const faqMeta = getFaqsMetadata();

    res.header('Content-Type', 'text/html;charset=utf-8');
    res.send(
      renderIndexTemplate({
        ...createMetadataContext(defaultOg, { canonicalPath: '/faqs', origin: PUBLIC_ORIGIN }),
        title: faqMeta.title,
        description: faqMeta.description,
        robots: 'index, follow',
        pageSchema: faqMeta.schema ? safeSchema(JSON.stringify(faqMeta.schema)) : null,
        orgSchema: null,
      }),
    );
  });

  app.get('/profile/:userId', async (req, res, next) => {
    if (!/^\d+$/.test(req.params.userId)) {
      next();
      return;
    }

    const [user] = await User.get([User.ID, User.NAME], [User.ID, req.params.userId]);
    if (!user) {
      next();
      return;
    }

    const profileMeta = createProfileMetadata(user.name);
    res.header('Content-Type', 'text/html;charset=utf-8');
    res.send(
      renderIndexTemplate({
        ...createMetadataContext(defaultOg, { canonicalPath: `/profile/${user.id}`, origin: PUBLIC_ORIGIN }),
        title: profileMeta.title,
        description: profileMeta.description,
        image_alt: profileMeta.title,
        robots: 'index, follow',
        pageSchema: null,
        orgSchema: null,
      }),
    );
  });

  app.get('*path', (req, res) => {
    const metadata = getMetadata(req.path, PUBLIC_ORIGIN);
    const context = metadata
      ? {
          ...createMetadataContext(defaultOg, { canonicalPath: req.path, origin: PUBLIC_ORIGIN }),
          title: metadata.title,
          description: metadata.description,
          image_alt: metadata.iconAlt || metadata.title || defaultOg.image_alt,
          robots: 'index, follow',
          pageSchema: metadata.schema ? safeSchema(JSON.stringify(metadata.schema)) : null,
          orgSchema: metadata.orgSchema ? JSON.stringify(metadata.orgSchema) : null,
        }
      : {
          ...createMetadataContext(defaultOg, { canonicalPath: req.path, origin: PUBLIC_ORIGIN }),
          title: FALLBACK_TITLE,
          robots: 'index, follow',
          orgSchema: null,
          pageSchema: null,
        };

    res.header('Content-Type', 'text/html;charset=utf-8');
    res.send(renderIndexTemplate(context));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.message === 'Unexpected end of form') {
      res.status(400).send({ error: 'Upload was interrupted. Please try again.' });
      return;
    }
    console.error('Unhandled error:', err);
    res.status(500).send({ error: 'Internal server error' });
  });
}

async function start() {
  await migrationRunner.run();
  require('./crons');
  await main();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

/**
 * Escape JSON-LD string for safe embedding inside a <script> tag.
 * Prevents </script> and similar sequences in schema text from
 * prematurely terminating the JSON-LD script tag.
 */
function safeSchema(jsonString) {
  if (!jsonString) return null;
  return jsonString.replace(/<\//g, '<\\/');
}

function compileTemplate(filename) {
  const templatePath = path.resolve(__dirname, filename);
  return Handlebars.compile(fs.readFileSync(templatePath, 'utf8'));
}

function createEtag(value) {
  return `"${crypto.createHash('sha256').update(value).digest('base64url')}"`;
}

function getPluginIconPath(id) {
  const iconPath = path.resolve(PLUGIN_ICONS, `${id}.png`);
  if (!iconPath.startsWith(`${PLUGIN_ICONS}${path.sep}`) || !fs.existsSync(iconPath)) return null;
  return iconPath;
}

function sendOgImage(res, image, etag) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', OG_CACHE_CONTROL);
  res.setHeader('ETag', etag);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(image);
}

start();
