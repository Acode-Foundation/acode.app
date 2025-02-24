/* eslint-disable no-restricted-syntax */
/* eslint-disable global-require */
/* eslint-disable no-console */
/* eslint-disable import/order */
const db = require('./db');

execQuery(
  [
    'ALTER TABLE plugin ADD COLUMN license TEXT DEFAULT "Unknown"',
    'ALTER TABLE plugin ADD COLUMN contributors TEXT',
    'ALTER TABLE plugin ADD COLUMN changelogs TEXT',
    'ALTER TABLE plugin ADD COLUMN keywords TEXT',
    'ALTER TABLE user ADD COLUMN role TEXT DEFAULT "user"',
  ],
  async () => {
    db.close();
    console.log('Done');
  },
);

/**
 * @param {string[]} queries
 * @param {Function} cb
 */
function execQuery(queries, cb) {
  const query = queries.shift();
  if (!query) {
    if (cb) {
      cb();
    }
    return;
  }

  console.log('Executing:', query);
  db.all(query, [], (err) => {
    if (err) {
      console.warn(err.message);
    }

    execQuery(queries, cb);
  });
}
