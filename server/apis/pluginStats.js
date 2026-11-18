const { Router } = require('express');
const Plugin = require('../entities/plugin');
const { METRICS, publicStats, renderBadge, pluginBadge } = require('../lib/pluginBadge');
const { pluginStatsLimiter } = require('../lib/rateLimits');
const pluginStatsCors = require('../lib/pluginStatsCors');

const router = Router();

router.use(
  pluginStatsCors,
  (_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    next();
  },
  pluginStatsLimiter,
);

async function serveStats(req, res) {
  const { id, metric } = req.params;
  const badge = metric !== undefined;
  if (badge) res.type('image/svg+xml');

  function error(status, message) {
    return res.status(status).send(badge ? renderBadge('plugin', message, '#9f3737') : { error: message });
  }

  if (badge && !METRICS.has(metric)) return error(400, 'Unknown badge metric');
  if (!/^[a-z][a-z0-9._]{3,49}$/i.test(id)) return error(404, 'Plugin not found');

  try {
    const plugin = await Plugin.getPublicStats(id);
    if (!plugin) return error(404, 'Plugin not found');
    const stats = publicStats(plugin);
    res.set('Cache-Control', 'public, max-age=300, must-revalidate');
    return res.send(badge ? pluginBadge(stats, metric) : stats);
  } catch (err) {
    console.error('Failed to read public plugin stats:', err);
    res.set('Cache-Control', 'no-store');
    return error(503, 'Plugin stats unavailable');
  }
}

router.get('/:id', serveStats);
router.get('/:id/:metric.svg', serveStats);

module.exports = router;
