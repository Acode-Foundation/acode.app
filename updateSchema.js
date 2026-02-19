// biome-ignore lint/style/noCommonJs: can't use import
const db = require('./server/lib/db');

const queries = ['ALTER TABLE sponsor ADD COLUMN tagline TEXT'];

(async () => {
  for (const query of queries) {
    await new Promise((resolve, reject) => {
      try {
        db.exec(query);
        resolve();
      } catch (err) {
        // Ignore errors for columns that already exist
        if (err.message.includes('duplicate column name')) {
          process.stdout.write(`Column already exists, skipping: ${query}\n`);
          resolve();
        } else {
          process.stderr.write(`Error executing query: ${err.message}\n`);
          reject(err);
        }
      }
    });
  }

  await new Promise((resolve, reject) => {
    try {
      db.close();
      process.stdout.write('Database connection closed.\n');
      resolve();
    } catch (err) {
      process.stderr.write(`Error closing database connection: ${err.message}\n`);
      reject(err);
    }
  });

  process.exit(0);
})();
