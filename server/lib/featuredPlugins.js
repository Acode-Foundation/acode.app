const MAX_FEATURED_PLUGINS = 3;

function getFeaturedPluginIds(db = require('./db')) {
  return db
    .prepare('SELECT id FROM plugin WHERE status = 1 AND featured = 1 ORDER BY id')
    .all()
    .map((row) => row.id);
}

function setPluginFeatured(id, featured, db = require('./db')) {
  if (typeof id !== 'string' || !id || typeof featured !== 'boolean') {
    return { status: 400, error: 'Plugin ID and a boolean featured value are required' };
  }
  // Keep the cap check and update in one transaction, including across server processes.
  return db
    .transaction(() => {
      const plugin = db.prepare('SELECT status FROM plugin WHERE id = ?').get(id);
      if (!plugin) return { status: 404, error: 'Plugin not found' };
      if (featured && plugin.status !== 1) return { status: 400, error: 'Only approved plugins can be featured' };

      const ids = new Set(getFeaturedPluginIds(db));
      if (featured && !ids.has(id) && ids.size >= MAX_FEATURED_PLUGINS) {
        return { status: 409, error: `Only ${MAX_FEATURED_PLUGINS} plugins can be featured. Unfeature one first.` };
      }
      // Clear freed slots so reapproving a plugin cannot exceed the cap.
      db.prepare('UPDATE plugin SET featured = 0 WHERE featured = 1 AND status != 1').run();
      db.prepare('UPDATE plugin SET featured = ? WHERE id = ?').run(Number(featured), id);
      return { featured };
    })
    .immediate();
}

module.exports = { getFeaturedPluginIds, setPluginFeatured };
