module.exports = {
  version: 15,
  name: 'add_download_plugin_created_index',
  up(db) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_download_plugin_created ON download (plugin_id, created_at)');
  },
};
