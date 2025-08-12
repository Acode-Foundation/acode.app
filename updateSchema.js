// biome-ignore lint/style/noCommonJs: can't use import
const db = require('./server/lib/db');

const queries = ['ALTER TABLE sponsor ADD COLUMN tagline TEXT'];

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
