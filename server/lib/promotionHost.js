// Both Nginx tracking hosts forward the original Host header to Express.
const siteOrigins = new Map([
  ['go.acode.app', 'https://acode.app'],
  ['go.dev.acode.app', 'https://dev.acode.app'],
]);

function promotionSiteOrigin(req) {
  const host = req.headers.host?.split(':', 1)[0].toLowerCase().replace(/\.$/, '');
  return siteOrigins.get(host);
}

function redirectPromotionHost(req, res, next) {
  const origin = promotionSiteOrigin(req);
  if (!origin) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.set('Allow', 'GET, HEAD, OPTIONS').sendStatus(405);

  // API clients, OAuth callbacks and domain verification belong on the site host.
  if (/^\/(?:api|oauth|ai\/oauth|\.well-known)(?:\/|$)/i.test(req.path) || /^\/apple-app-site-association\/?$/i.test(req.path)) {
    return res.sendStatus(404);
  }

  const path = req.originalUrl.startsWith('/') && !/^\/p(?:\/|$)/i.test(req.path) ? req.originalUrl : '/';
  res.vary('Host');
  res.set('Cache-Control', 'no-store');
  return res.redirect(302, origin + path);
}

module.exports = { promotionSiteOrigin, redirectPromotionHost };
