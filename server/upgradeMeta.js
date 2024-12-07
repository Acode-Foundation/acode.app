/* eslint-disable no-restricted-syntax */
/* eslint-disable global-require */
/* eslint-disable no-console */
/* eslint-disable import/order */
const db = require('./db');

execQuery([
  'DELETE FROM user_earnings WHERE payment_id NOT IN (SELECT id FROM payment);',
  'ALTER TABLE user ADD COLUMN threshold INTEGER DEFAULT 1000;',
], async () => {
  db.close();
  console.log('Done');
});

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
  db.all(query, [], (err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    } else {
      execQuery(queries, cb);
    }
  });
}
