const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.foxdebug.acodefree';

module.exports = function storeRedirect(req, res, next) {
  if (req.query.redirect !== 'store') return next();

  // Responses depend on the client, including when no store is available.
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('User-Agent');
  res.vary('Sec-CH-UA-Platform');
  const platform = req.get('Sec-CH-UA-Platform');
  const android = platform ? /^"?Android"?$/i.test(platform) : /\bAndroid\b/i.test(req.get('User-Agent') || '');
  // iOS remains unavailable while the site's App Store button is "Coming soon".
  if (android) return res.redirect(302, PLAY_URL);
  return next();
};
