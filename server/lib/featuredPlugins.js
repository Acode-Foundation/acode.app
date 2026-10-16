const MAX_FEATURED_PLUGINS = 3;
const FEATURED_PLUGIN_IDS_SQL = "SELECT value FROM json_each((SELECT value FROM app_config WHERE key = 'featured_plugins'))";

function getFeaturedPluginIds(db = require('./db')) {
  return db
    .prepare(`SELECT id FROM plugin WHERE status = 1 AND id IN (${FEATURED_PLUGIN_IDS_SQL}) ORDER BY id`)
    .all()
    .map((row) => row.id);
}

function setPluginFeatured(id, featured, db = require('./db')) {
  if (typeof id !== 'string' || !id || typeof featured !== 'boolean') {
    return { status: 400, error: 'Plugin ID and a boolean featured value are required' };
  }
  // Keep the cap check and settings write in one transaction, including across server processes.
  return db
    .transaction(() => {
      const plugin = db.prepare('SELECT status FROM plugin WHERE id = ?').get(id);
      if (!plugin) return { status: 404, error: 'Plugin not found' };
      if (featured && plugin.status !== 1) return { status: 400, error: 'Only approved plugins can be featured' };

      const ids = new Set(getFeaturedPluginIds(db));
      if (featured && !ids.has(id) && ids.size >= MAX_FEATURED_PLUGINS) {
        return { status: 409, error: `Only ${MAX_FEATURED_PLUGINS} plugins can be featured. Unfeature one first.` };
      }
      if (featured) ids.add(id);
      else ids.delete(id);

      db.prepare(`INSERT INTO app_config (key, value) VALUES ('featured_plugins', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify([...ids]));
      return { featured };
    })
    .immediate();
}

module.exports = { FEATURED_PLUGIN_IDS_SQL, getFeaturedPluginIds, setPluginFeatured };
