const { Router } = require('express');
const { exec } = require('node:child_process');
const db = require('../lib/db');

const apis = Router();

apis.use('/user', require('../apis/user'));
apis.use('/login', require('../apis/login'));
apis.use(['/plugin', '/plugins'], require('../apis/plugin'));
apis.use('/password', require('../apis/password'));
apis.use('/otp', require('../apis/otp'));
apis.use(['/comments', '/comment'], require('../apis/comment'));
apis.use('/faqs', require('../apis/faqs'));
apis.use('/admin', require('../apis/admin'));
apis.use(['/sponsor', '/sponsors'], require('../apis/sponsor'));

// OAuth uses ES6 modules, so we need to dynamically import it
import('../apis/oauth.mjs')
  .then((oauthModule) => {
    apis.use('/oauth', oauthModule.default);
  })
  .catch((err) => {
    console.error('Failed to load OAuth module:', err);
  });

// apis.use('/completion', require('../apis/completion'));

apis.get('/status', (_req, res) => {
  res.json({ status: 'ok' });
});

apis.get('/server-time', (_req, res) => {
  db.all('select current_timestamp as time', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err });
      return;
    }

    res.json(rows[0]);
  });
});

apis.get('/telegram-members-count', async (_req, res) => {
  exec('curl -s https://t.me/foxdebug_acode', (err, stdout, stderr) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: err });
      return;
    }

    if (stderr) {
      console.error(stderr);
      res.status(500).json({ error: stderr });
      return;
    }

    let [, count] = /<div class="tgme_page_extra">(.+) members/i.exec(stdout) || [];
    if (count) {
      count = count.replace(/\D/g, '');
      res.send({
        schemaVersion: 1,
        label: 'Telegram Members',
        message: `${count} members`,
        color: '#24A1DE',
        cacheSeconds: 3600,
      });
    } else {
      res.status(500).send('Not found');
    }
  });
});

module.exports = apis;
