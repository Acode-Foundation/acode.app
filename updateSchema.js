// biome-ignore lint/style/noCommonJs: can't use import
const db = require('./server/lib/db');

const queries = [
  'ALTER TABLE plugin ADD COLUMN package_updated_at TIMESTAMP',
  'CREATE TRIGGER IF NOT EXISTS plugin_package_updated_at AFTER UPDATE ON plugin FOR EACH ROW WHEN old.version != new.version BEGIN UPDATE plugin SET package_updated_at = current_timestamp WHERE id = old.id; END;',
];

(async () => {
  for (const query of queries) {
    await new Promise((resolve, reject) => {
      db.all(query, [], (err) => {
        if (err) {
          process.stderr.write(`Error executing query: ${err.message}\n`);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  db.close((err) => {
    if (err) {
      process.stderr.write(`Error closing database connection: ${err.message}\n`);
    } else {
      process.stdout.write('Database connection closed.\n');
    }
  });

  process.exit(0);
})();
