const { Router } = require('express');
const { exec } = require('node:child_process');
const db = require('../lib/db');

const apis = Router();

apis.use('/user', require('../apis/user'));
apis.use('/login', require('../apis/login'));
apis.use('/plugins?', require('../apis/plugin'));
apis.use('/password', require('../apis/password'));
apis.use('/otp', require('../apis/otp'));
apis.use('/comments?', require('../apis/comment'));
apis.use('/faqs', require('../apis/faqs'));
apis.use('/admin', require('../apis/admin'));
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

    const [, count] = /<div class="tgme_page_extra">(.+) members/i.exec(stdout) || [];
    if (count) {
      res.send(count.replace(/\D/g, ''));
    } else {
      res.status(500).send('Not found');
    }
  });
});

module.exports = apis;
