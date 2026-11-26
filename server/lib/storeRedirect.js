const { APP_STORE_URL, PLAY_STORE_URL } = require('../../shared/appLinks');

module.exports = function storeRedirect(req, res, next) {
  if (req.query.redirect !== 'store') return next();

  // Responses depend on the client, including when no store is available.
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('User-Agent');
  res.vary('Sec-CH-UA-Platform');
  const platform = req.get('Sec-CH-UA-Platform');
  const userAgent = req.get('User-Agent') || '';
  const android = platform ? /^"?Android"?$/i.test(platform) : /\bAndroid\b/i.test(userAgent);
  if (android) return res.redirect(302, PLAY_STORE_URL);
  // iPadOS reports a desktop Mac user agent by default, so only identifiable iOS devices redirect.
  const ios = platform ? /^"?iOS"?$/i.test(platform) : /\b(iPhone|iPad|iPod)\b/.test(userAgent);
  if (ios) return res.redirect(302, APP_STORE_URL);
  return next();
};
