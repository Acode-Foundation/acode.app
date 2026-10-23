const { randomUUID } = require('node:crypto');
const { getPublicOrigin } = require('./publicMetadata');

const MAX_PROMOTIONS = 3;
class PromotionValidationError extends Error {}
function trackingOrigin() {
  const value = process.env.PROMOTION_TRACKING_ORIGIN;
  if (!value) throw new Error('PROMOTION_TRACKING_ORIGIN must be configured');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid promotion tracking origin');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Invalid promotion tracking origin');
  return url.origin;
}
function validatePromotions(items) {
  if (!Array.isArray(items)) throw new PromotionValidationError('Promotions must be an array');
  return items.map((item) => {
    if (!item || typeof item !== 'object') throw new PromotionValidationError('Invalid promotion');
    const result = {};
    for (const key of ['url', 'icon', 'label', 'link_text']) {
      if (typeof item[key] !== 'string' || !item[key].trim() || item[key].length > (key === 'url' || key === 'icon' ? 2048 : 300))
        throw new PromotionValidationError(`Invalid ${key}`);
      result[key] = item[key].trim();
    }
    for (const key of ['url', 'icon']) {
      let url;
      try {
        url = new URL(result[key]);
      } catch {
        throw new PromotionValidationError(`Invalid ${key} URL`);
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new PromotionValidationError(`Invalid ${key} URL`);
      const ownHosts = new Set([
        'acode.app',
        'dev.acode.app',
        'go.acode.app',
        'go.dev.acode.app',
        new URL(getPublicOrigin()).hostname,
        new URL(getPublicOrigin(process.env.PROMOTION_TRACKING_ORIGIN)).hostname,
      ]);
      if (key === 'url' && ownHosts.has(url.hostname) && /^\/p(?:\/|$)/i.test(url.pathname))
        throw new PromotionValidationError('Destination cannot be a tracking URL');
    }
    if (item.id !== undefined) {
      if (typeof item.id !== 'string' || !item.id) throw new PromotionValidationError('Invalid promotion ID');
      result.id = item.id;
    }
    return result;
  });
}
function savePromotions(items, db = require('./db')) {
  const rows = validatePromotions(items);
  if (rows.length > MAX_PROMOTIONS) throw new PromotionValidationError('Only three promotions can be active');
  const ids = rows.filter((row) => row.id).map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new PromotionValidationError('Duplicate promotion ID');
  return db
    .transaction(() => {
      for (const id of ids)
        if (!db.prepare('SELECT id FROM promotion WHERE id = ?').get(id)) throw new PromotionValidationError('Unknown promotion ID');
      db.prepare('UPDATE promotion SET archived = 1 WHERE archived = 0').run();
      rows.forEach((row, position) => {
        if (row.id)
          db.prepare('UPDATE promotion SET url=?, label=?, icon=?, link_text=?, position=?, archived=0 WHERE id=?').run(
            row.url,
            row.label,
            row.icon,
            row.link_text,
            position,
            row.id,
          );
        else
          db.prepare('INSERT INTO promotion(id,url,label,icon,link_text,position) VALUES(?,?,?,?,?,?)').run(
            randomUUID(),
            row.url,
            row.label,
            row.icon,
            row.link_text,
            position,
          );
      });
      return listPromotions(false, db);
    })
    .immediate();
}
function savePromotion(item, db = require('./db')) {
  const [row] = validatePromotions([item]);
  if (item.archived !== undefined && ![0, 1].includes(item.archived)) throw new PromotionValidationError('Invalid archive status');
  return db
    .transaction(() => {
      const existing = row.id ? db.prepare('SELECT * FROM promotion WHERE id=?').get(row.id) : null;
      if (row.id && !existing) throw new PromotionValidationError('Unknown promotion ID');
      const archived = item.archived ?? existing?.archived ?? 0;
      const active = listPromotions(false, db);
      if (!archived && !active.some((entry) => entry.id === row.id) && active.length >= MAX_PROMOTIONS)
        throw new PromotionValidationError('Only three promotions can be active');
      const position = existing && !existing.archived ? existing.position : Math.max(-1, ...active.map((entry) => entry.position)) + 1;
      const id = row.id || randomUUID();
      if (existing)
        db.prepare('UPDATE promotion SET url=?, label=?, icon=?, link_text=?, position=?, archived=? WHERE id=?').run(
          row.url,
          row.label,
          row.icon,
          row.link_text,
          position,
          archived,
          id,
        );
      else
        db.prepare('INSERT INTO promotion(id,url,label,icon,link_text,position,archived) VALUES(?,?,?,?,?,?,?)').run(
          id,
          row.url,
          row.label,
          row.icon,
          row.link_text,
          position,
          archived,
        );
      return db.prepare('SELECT * FROM promotion WHERE id=?').get(id);
    })
    .immediate();
}
function listPromotions(archived = false, db = require('./db')) {
  return db.prepare('SELECT * FROM promotion WHERE archived=? ORDER BY position, id').all(Number(archived));
}
function sourceForRequest(req) {
  for (const value of [req.headers.origin, req.headers.referer]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'acode:' && url.host === 'localhost') return 'app_acode';
      if (url.origin === 'https://localhost') return 'app_https';
      if (url.origin === getPublicOrigin()) return 'web';
    } catch {
      /* Missing or opaque origins remain unknown. */
    }
  }
  return 'unknown';
}
function clickContext(req) {
  const source = ['web', 'app_https', 'app_acode'].includes(req.query?.source) ? req.query.source : sourceForRequest(req);
  const origin = { web: getPublicOrigin(), app_https: 'https://localhost', app_acode: 'acode://localhost' }[source] || 'unknown';
  const ua = req.headers['user-agent'] || '';
  let os = 'Unknown';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua) || source === 'app_acode') os = 'iOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let device = 'Unknown';
  if (/iPad|Tablet/i.test(ua) || (os === 'Android' && !/Mobile/i.test(ua))) device = 'Tablet';
  else if (/Mobile|iPhone|iPod/i.test(ua)) device = 'Mobile';
  else if (['Windows', 'macOS', 'Linux', 'ChromeOS'].includes(os)) device = 'Desktop';
  return { origin, os, device };
}
function recordClick(id, req, db = require('./db'), now = new Date()) {
  if (
    req.method !== 'GET' ||
    /bot|crawler|spider|preview|slurp/i.test(req.headers['user-agent'] || '') ||
    /prefetch|prerender/i.test(`${req.headers['sec-purpose'] || ''} ${req.headers.purpose || ''}`)
  )
    return;
  const { origin, os, device } = clickContext(req);
  db.prepare(`INSERT INTO promotion_click_day(promotion_id,day,origin,device,os,clicks) VALUES(?,?,?,?,?,1)
    ON CONFLICT(promotion_id,day,origin,device,os) DO UPDATE SET clicks=clicks+1`).run(id, now.toISOString().slice(0, 10), origin, device, os);
}
function analytics(id, db = require('./db'), now = new Date()) {
  const days = Array.from({ length: 30 }, (_, index) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29 + index)).toISOString().slice(0, 10),
  );
  const rows = db.prepare('SELECT * FROM promotion_click_day WHERE promotion_id=? AND day>=? AND day<=?').all(id, days[0], days[29]);
  const total = db.prepare('SELECT COALESCE(SUM(clicks),0) AS count FROM promotion_click_day WHERE promotion_id=?').get(id).count;
  const group = (field) =>
    Object.entries(
      rows.reduce((counts, row) => {
        counts[row[field]] = (counts[row[field]] || 0) + row.clicks;
        return counts;
      }, {}),
    )
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  return {
    total,
    recent: rows.reduce((sum, row) => sum + row.clicks, 0),
    daily: days.map((day) => ({ day, count: rows.filter((row) => row.day === day).reduce((sum, row) => sum + row.clicks, 0) })),
    devices: group('device'),
    operatingSystems: group('os'),
    origins: group('origin'),
  };
}
module.exports = {
  MAX_PROMOTIONS,
  PromotionValidationError,
  trackingOrigin,
  validatePromotions,
  savePromotions,
  savePromotion,
  listPromotions,
  sourceForRequest,
  clickContext,
  recordClick,
  analytics,
};
