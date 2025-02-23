const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const dbFile = path.resolve(__dirname, '../../data/db.sqlite3');

if (!fs.existsSync(dbFile)) {
  fs.writeFileSync(dbFile, '');
}

module.exports = new sqlite3.Database(dbFile);
