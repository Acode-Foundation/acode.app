const path = require('node:path');
const db = require('./lib/db');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const queries = [
  'ALTER TABLE user ADD COLUMN github_id TEXT;',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_user_github_id ON user(github_id);',
  'ALTER TABLE user ADD COLUMN google_id TEXT;',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_user_google_id ON user(google_id);',
  'ALTER TABLE user ADD COLUMN avatar_url TEXT;',
  "ALTER TABLE user ADD COLUMN primary_auth TEXT DEFAULT 'email';",
  'ALTER TABLE user ADD COLUMN x TEXT',
  'ALTER TABLE user ADD COLUMN linkedin TEXT',
];

(async () => {
  for (const query of queries) {
    await new Promise((resolve, reject) => {
      try {
        db.exec(query);
        resolve();
      } catch (err) {
        if (err.message.includes('duplicate column name') || err.message.includes('already exists')) {
          process.stdout.write(`Already exists, skipping: ${query}\n`);
          resolve();
        } else {
          process.stderr.write(`Error executing query: ${err.message}\n`);
          reject(err);
        }
      }
    });
  }
})();
