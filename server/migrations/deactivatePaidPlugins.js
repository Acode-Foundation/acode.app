/**
 * One-time migration: deactivate all approved paid plugins.
 * Run once with: node server/migrations/deactivatePaidPlugins.js
 */
const db = require('../lib/db');

const stmt = db.prepare(
  `UPDATE plugin
   SET status = 3,
       status_change_message = 'Paid plugin support has been discontinued. Visit your plugin page to make it free and restore it.'
   WHERE price > 0 AND status = 1`,
);

const result = stmt.run();
console.log(`Deactivated ${result.changes} paid plugin(s).`);
