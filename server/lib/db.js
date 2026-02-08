const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('better-sqlite3');

const dbFile = path.resolve(__dirname, '../../data/db.sqlite3');

if (!fs.existsSync(dbFile)) {
  fs.writeFileSync(dbFile, '');
}

module.exports = sqlite3(dbFile);
