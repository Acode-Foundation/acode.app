const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

async function run() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const appliedRows = db.prepare('SELECT version FROM schema_version').all();
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  if (appliedSet.size === 0) {
    const bootstrap = db.prepare('INSERT OR IGNORE INTO schema_version (version, name) VALUES (?, ?)');
    for (let v = 1; v <= 7; v++) {
      bootstrap.run(v, `legacy_${String(v).padStart(2, '0')}`);
    }
    for (let v = 1; v <= 7; v++) {
      appliedSet.add(v);
    }
    console.log('Bootstrapped schema_version with existing migrations (1-7)');
  }

  const dir = path.resolve(__dirname, '../migrations');
  if (!fs.existsSync(dir)) {
    console.log('No migrations directory found');
    return;
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort();

  for (const file of files) {
    const migration = require(path.join(dir, file));
    if (appliedSet.has(migration.version)) continue;

    const apply = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_version (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    });

    try {
      apply();
      console.log(`Migration ${migration.version}: ${migration.name} applied`);
    } catch (err) {
      console.error(`Migration ${migration.version}: ${migration.name} failed:`, err.message);
      throw err;
    }
  }
}

module.exports = { run };
