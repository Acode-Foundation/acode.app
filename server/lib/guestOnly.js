const { safeAccountRedirect } = require('../../shared/accountRedirect');
const { getLoggedInUser } = require('./helpers');

async function rejectSignedIn(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (await getLoggedInUser(req)) return res.status(409).send({ error: 'You are already signed in.' });
  next();
}

async function redirectSignedIn(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!(await getLoggedInUser(req))) return next();
  const redirect = safeAccountRedirect(req.query.redirect);
  if (redirect === 'app') {
    if (/^\/login$/i.test(req.path)) return next();
    const destination = new URL(req.originalUrl, 'https://acode.app');
    destination.pathname = '/login';
    return res.redirect(303, `${destination.pathname}${destination.search}`);
  }
  return res.redirect(303, redirect || '/');
}

module.exports = { rejectSignedIn, redirectSignedIn };
