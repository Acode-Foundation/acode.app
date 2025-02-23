/* eslint-disable no-console */
require('dotenv').config();
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

global.ADMIN = 1;
const app = express();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

main();

async function main() {
  await setAuth();

  // allow origin https://localhost
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://localhost');
    // allow content-type
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  app.use(cookieParser());
  app.use(
    fileUpload({
      limits: {
        fileSize: 50 * 1024 * 1024, // 50 MB
      },
    }),
  );
  app.use(express.json());
  app.use('/api', apis);
  app.use('/api/*', (_req, res) => {
    res.status(404).send({ error: 'Not found' });
  });

  app.get('/((app-ads)|(ads)).txt', (_req, res) => {
    res.sendFile(path.resolve(__dirname, '../data/ads.txt'));
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

  app.get('/manifest.json', (_req, res) => {
    res.sendFile(path.resolve(__dirname, './manifest.json'));
  });

  app.get('/:filename', (req, res, next) => {
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

  app.get('*', (_req, res) => {
    const template = path.resolve(__dirname, './index.hbs');
    const source = fs.readFileSync(template, 'utf8');
    const templateScript = Handlebars.compile(source);

    res.header('Content-Type', 'text/html;charset=utf-8');
    res.send(templateScript(defaultOg));
  });
}
