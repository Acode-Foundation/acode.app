/* eslint-disable no-console */
require('dotenv').config();
require('./crons');
require('./updateSchema');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const fileUpload = require('express-fileupload');
const Handlebars = require('handlebars');
const markdownToText = require('markdown-to-txt');
const defaultOg = require('./defaultOg.json');
const Plugin = require('./entities/plugin');
const apis = require('./routes/apis');
const setAuth = require('./lib/gapis');

const app = express();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

main();

async function main() {
  await setAuth();

  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://localhost');
    // allow content-type
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-auth-token, X-Requested-With');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // CSRF protection: require a custom header or same-origin on state-changing requests
  // Browsers won't send custom headers on cross-origin form submissions
  // Skip for webhooks (Razorpay sends raw JSON without custom headers)
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }
    // Skip webhook endpoint (receives callbacks from Razorpay servers)
    if (req.path === '/api/razorpay/webhook') {
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
    const origin = req.headers.origin || req.headers.referer || '';
    const host = req.headers.host || '';
    if (origin && (origin.includes(host) || origin.includes('localhost'))) {
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

  app.use(
    express.json({
      limit: '50mb',
    }),
  );

  app.get('/sitemap.xml', (_req, res) => {
    res.setHeader('Content-Type', 'application/xml');
    res.sendFile('sitemap.xml', { root: process.cwd() });
  });

  app.use('/api', apis);
  app.use('/api/*path', (_req, res) => {
    res.status(404).send({ error: 'Not found' });
  });

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

  app.get('/plugin/:id', async (req, res, next) => {
    try {
      const [plugin] = await Plugin.get([Plugin.ID, req.params.id]);
      if (!plugin) {
        next();
        return;
      }

      const template = path.resolve(__dirname, './index.hbs');
      const source = fs.readFileSync(template, 'utf8');
      const templateScript = Handlebars.compile(source);

      res.header('Content-Type', 'text/html;charset=utf-8');
      res.send(
        templateScript({
          title: `${plugin.name} - Acode`,
          description: markdownToText.default(plugin.description),
          icon: `plugin-icon/${plugin.id}`,
          url: `plugin/${plugin.id}`,
          icon_alt: `${plugin.name} icon`,
          site_name: `Acode - ${plugin.name}`,
        }),
      );
    } catch (_error) {
      next();
    }
  });

  app.get('*path', (_req, res) => {
    const template = path.resolve(__dirname, './index.hbs');
    const source = fs.readFileSync(template, 'utf8');
    const templateScript = Handlebars.compile(source);

    res.header('Content-Type', 'text/html;charset=utf-8');
    res.send(templateScript(defaultOg));
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
