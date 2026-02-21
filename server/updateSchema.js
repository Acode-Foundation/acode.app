const db = require('./lib/db');

const queries = [];

(async () => {
  for (const query of queries) {
    await new Promise((resolve, reject) => {
      try {
        db.exec(query);
        resolve();
      } catch (err) {
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
})();
