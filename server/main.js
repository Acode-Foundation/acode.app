/* eslint-disable no-console */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const fileUpload = require('express-fileupload');

const apis = require('./routes/apis');
const setAuth = require('./gapis');

global.ADMIN = 1;
const app = express();

if (process.env.NODE_ENV === 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT);
} else {
  // eslint-disable-next-line global-require
  const https = require('https');
  const privateKey = fs.readFileSync(
    path.resolve(__dirname, '../.vscode/server.key'),
    'utf8',
  );
  const certificate = fs.readFileSync(
    path.resolve(__dirname, '../.vscode/server.crt'),
    'utf8',
  );
  const credentials = {
    key: privateKey,
    cert: certificate,
    passphrase: '1234',
  };
  const httpsServer = https.createServer(credentials, app);
  httpsServer.listen(3001, () => {
    console.log('HTTPS Server running on port 3001');
  });
}

main();

async function main() {
  await setAuth();

  // allow origin https://localhost
  app.use((req, res, next) => {
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
  app.use('/api/*', (req, res) => {
    res.status(404).send({ error: 'Not found' });
  });

  app.get('/((app-ads)|(ads)).txt', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../data/ads.txt'));
  });

  app.get('/.well-known/assetlinks.json', (req, res) => {
    res.send([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.foxdebug.acodefree',
          sha256_cert_fingerprints: [
            '12:66:9B:CA:68:91:87:C3:2A:49:ED:9B:5B:06:3A:06:0E:5B:67:75:34:50:4F:46:DC:DA:A0:AF:71:90:CB:93',
          ],
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

  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, './index.html'));
  });
}
