module.exports = {
  version: 17,
  name: 'add_plugin_featured',
  up(db) {
    const columns = db.prepare('PRAGMA table_info(plugin)').all();
    if (!columns.some((column) => column.name === 'featured')) db.exec('ALTER TABLE plugin ADD COLUMN featured INTEGER NOT NULL DEFAULT 0');
  },
};
