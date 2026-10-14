const crypto = require('node:crypto');
const { Router, urlencoded } = require('express');
const { safeAccountRedirect } = require('../../shared/accountRedirect');
const user = require('../entities/user');
const { getWebLoggedInUser } = require('../lib/helpers');
const apple = require('../lib/appleOAuth');
const {
  getGitHubAuthURL,
  getGitHubToken,
  getGitHubUser,
  getGoogleAuthURL,
  getGoogleToken,
  getGoogleUser,
  generateState,
  issueTokenAndLogin,
  generateRandomPassword,
} = require('../lib/oauth');

const route = Router();
const ID_COL = {
  github: user.GITHUB_ID,
  google: user.GOOGLE_ID,
  apple: user.APPLE_ID,
};

function validatedRedirect(url) {
  if (url === 'app') return '/login?redirect=app';
  return safeAccountRedirect(url) || null;
}

const appleCookie = '__Host-apple_oauth';
const appleCookieOptions = { httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: 10 * 60 * 1000 };

route.use('/apple', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

route.get('/apple', async (req, res) => {
  const redirect = validatedRedirect(req.query.redirect);
  try {
    const flow = { state: generateState(), nonce: generateState(), redirect, expires: Date.now() + appleCookieOptions.maxAge };
    if (req.query.intent === 'link') {
      const account = await getWebLoggedInUser(req);
      if (!account || !req.cookies.token) throw new Error('Sign in before linking Apple');
      flow.userId = account.id;
      flow.session = appleSession(req);
    }
    const url = await apple.getAppleAuthURL(flow.state, flow.nonce);
    setAppleFlow(res, flow);
    res.redirect(url);
  } catch (error) {
    apple.logAppleError('sign-in start', error);
    res.clearCookie(appleCookie, { path: '/', secure: true, sameSite: 'none' });
    res.redirect(loginErrorRedirect(redirect, 'Unable to start Apple sign-in. Sign in before linking an account, or try again.'));
  }
});

// Apple posts cross-site, so the Lax website session is absent here. Validate the
// browser-bound state first, then resume on a GET to restore that session.
route.post('/apple/callback', urlencoded({ extended: false, limit: '8kb', parameterLimit: 10 }), (req, res) => {
  let flow;
  try {
    flow = readAppleFlow(req);
    if (flow.callback || typeof req.body?.state !== 'string' || req.body.state !== flow.state) throw new Error('Invalid Apple state');
    const { code, error, user: profile } = req.body;
    if (!error && (typeof code !== 'string' || !code || code.length > 2048)) throw new Error('Missing Apple code');
    // Only the first response contains the editable name. Email always comes from
    // the verified identity token, never from the unsigned user object.
    let name;
    if (typeof profile === 'string') {
      try {
        const parsed = JSON.parse(profile);
        name = [parsed.name?.firstName, parsed.name?.lastName]
          .filter((part) => typeof part === 'string')
          .join(' ')
          .replace(/[<>\p{Cc}]/gu, '')
          .trim()
          .slice(0, 100);
      } catch {
        /* An optional malformed display name must not prevent returning-user sign-in. */
      }
    }
    setAppleFlow(res, { ...flow, callback: true, code: error ? undefined : code, cancelled: Boolean(error), name }, 'lax');
    res.redirect(303, '/oauth/apple/complete');
  } catch (error) {
    apple.logAppleError('callback', error);
    res.clearCookie(appleCookie, { path: '/', secure: true, sameSite: 'none' });
    res.redirect(303, loginErrorRedirect(flow?.redirect, 'Invalid or expired Apple sign-in. Please try again.'));
  }
});

route.get('/apple/complete', async (req, res) => {
  let flow;
  res.clearCookie(appleCookie, { path: '/', secure: true, sameSite: 'lax' });
  try {
    flow = readAppleFlow(req);
    if (!flow.callback) throw new Error('Missing Apple callback');
    if (flow.cancelled) return res.redirect(loginErrorRedirect(flow.redirect, 'Sign-in was cancelled. Please try again.'));
    if (flow.userId) {
      const account = await getWebLoggedInUser(req);
      if (account?.id !== flow.userId || appleSession(req) !== flow.session) {
        return res.redirect('/profile/edit?error=Your%20signed-in%20account%20changed.%20Please%20link%20Apple%20again.');
      }
    }
    const identity = await apple.exchangeAppleCode(flow.code, flow.nonce, flow.name);
    if (flow.userId) await handleLink('apple', identity, req, res);
    else await handleLogin('apple', identity, res, flow.redirect);
  } catch (error) {
    apple.logAppleError('sign-in completion', error);
    res.redirect(loginErrorRedirect(flow?.redirect, 'Unable to sign in with Apple. Please try again.'));
  }
});

function appleSession(req) {
  return crypto
    .createHash('sha256')
    .update(req.cookies.token || '')
    .digest('hex');
}

function setAppleFlow(res, flow, sameSite = 'none') {
  const value = apple.seal(JSON.stringify(flow), 'apple-oauth');
  if (value.length > 3800) throw new Error('Apple sign-in request is too large');
  res.cookie(appleCookie, value, { ...appleCookieOptions, sameSite });
}

function readAppleFlow(req) {
  const flow = JSON.parse(apple.unseal(req.cookies[appleCookie], 'apple-oauth'));
  if (!Number.isFinite(flow.expires) || flow.expires <= Date.now() || !flow.state || !flow.nonce) throw new Error('Expired Apple sign-in');
  flow.redirect = validatedRedirect(flow.redirect);
  return flow;
}

route.get('/github', (req, res) => {
  if (req.query.intent === 'link') {
    res.cookie('oauth_intent', 'link', { maxAge: 10 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: true });
  } else res.clearCookie('oauth_intent');
  const redirect = validatedRedirect(req.query.redirect);
  if (redirect) {
    res.cookie('oauth_redirect', redirect, { maxAge: 10 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: true });
  } else res.clearCookie('oauth_redirect');
  const state = generateState();
  res.cookie('oauth_state', state, { maxAge: 10 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: true });
  res.redirect(withAccountSelection(getGitHubAuthURL(state), redirect));
});

route.get('/github/callback', async (req, res) => {
  const oauthRedirect = req.cookies.oauth_redirect;
  try {
    const { code, state } = req.query;

    if (!state || state !== req.cookies.oauth_state) {
      res.clearCookie('oauth_state');
      return res.redirect(loginErrorRedirect(oauthRedirect, 'Invalid state parameter'));
    }

    res.clearCookie('oauth_state');

    const intent = req.cookies.oauth_intent;
    res.clearCookie('oauth_intent');

    res.clearCookie('oauth_redirect');

    if (req.query.error) return res.redirect(loginErrorRedirect(oauthRedirect, 'Sign-in was cancelled. Please try again.'));

    const accessToken = await getGitHubToken(code);
    const ghUser = await getGitHubUser(accessToken);

    if (intent === 'link') {
      await handleLink('github', ghUser, req, res);
    } else {
      await handleLogin('github', ghUser, res, oauthRedirect);
    }
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    res.redirect(loginErrorRedirect(oauthRedirect, 'Unable to sign in with GitHub. Please try again.'));
  }
});

route.get('/google', (req, res) => {
  if (req.query.intent === 'link') {
    res.cookie('oauth_intent', 'link', { maxAge: 10 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: true });
  } else res.clearCookie('oauth_intent');
  const redirect = validatedRedirect(req.query.redirect);
  if (redirect) {
    res.cookie('oauth_redirect', redirect, { maxAge: 10 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: true });
  } else res.clearCookie('oauth_redirect');
  const state = generateState();
  res.cookie('oauth_state', state, { maxAge: 10 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: true });
  res.redirect(withAccountSelection(getGoogleAuthURL(state), redirect));
});

route.get('/google/callback', async (req, res) => {
  const oauthRedirect = req.cookies.oauth_redirect;
  try {
    const { code, state } = req.query;

    if (!state || state !== req.cookies.oauth_state) {
      res.clearCookie('oauth_state');
      return res.redirect(loginErrorRedirect(oauthRedirect, 'Invalid state parameter'));
    }

    res.clearCookie('oauth_state');

    const intent = req.cookies.oauth_intent;
    res.clearCookie('oauth_intent');

    res.clearCookie('oauth_redirect');

    if (req.query.error) return res.redirect(loginErrorRedirect(oauthRedirect, 'Sign-in was cancelled. Please try again.'));

    const accessToken = await getGoogleToken(code);
    const googleUser = await getGoogleUser(accessToken);

    if (intent === 'link') {
      await handleLink('google', googleUser, req, res);
    } else {
      await handleLogin('google', googleUser, res, oauthRedirect);
    }
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.redirect(loginErrorRedirect(oauthRedirect, 'Unable to sign in with Google. Please try again.'));
  }
});

async function handleLink(provider, oauthUser, req, res) {
  const loggedInUser = await getWebLoggedInUser(req);

  if (!loggedInUser) {
    return res.redirect(`/login?error=${encodeURIComponent('You must be logged in to link an account')}`);
  }

  const idCol = ID_COL[provider];
  const existingById = await user.for('internal').get([idCol, oauthUser.id]);

  if (existingById.length && existingById[0].id !== loggedInUser.id) {
    return res.redirect(`/profile/edit?error=${encodeURIComponent(`This ${provider} account is already linked to another user.`)}`);
  }

  if (existingById.length && existingById[0].id === loggedInUser.id) {
    return res.redirect(`/profile?error=${encodeURIComponent(`${provider} account already linked.`)}`);
  }

  const updates = [[idCol, oauthUser.id]];

  if (provider === 'apple') {
    if (loggedInUser.apple_id) return res.redirect('/profile/edit?error=Unlink%20your%20existing%20Apple%20account%20first.');
    updates.push([user.APPLE_REFRESH_TOKEN, oauthUser.refreshToken]);
  }

  if (!loggedInUser.avatar_url && oauthUser.avatar_url) {
    updates.push([user.AVATAR_URL, oauthUser.avatar_url]);
  }

  if (!loggedInUser.github && oauthUser.github) {
    updates.push([user.GITHUB, oauthUser.github]);
  }

  if (!loggedInUser.x && oauthUser.x) {
    updates.push([user.X, oauthUser.x]);
  }

  if (!loggedInUser.website && oauthUser.website) {
    updates.push([user.WEBSITE, oauthUser.website]);
  }

  const where =
    provider === 'apple'
      ? [
          [user.ID, loggedInUser.id],
          [user.APPLE_ID, null],
          [user.ROLE, 'deleted', '!='],
        ]
      : [user.ID, loggedInUser.id];
  await user.update(updates, where);
  if (provider === 'apple') {
    const [linked] = await user.for('internal').get([
      [user.ID, loggedInUser.id],
      [user.APPLE_ID, oauthUser.id],
    ]);
    if (!linked) return res.redirect('/profile/edit?error=Your%20account%20changed.%20Please%20link%20Apple%20again.');
  }

  return res.redirect(`/profile?linked=${provider}`);
}

async function handleLogin(provider, oauthUser, res, redirect) {
  const idCol = ID_COL[provider];
  let userRow;

  const existingById = await user.for('internal').get([idCol, oauthUser.id]);
  if (existingById.length) {
    userRow = existingById[0];
    if (provider === 'apple') await user.update([user.APPLE_REFRESH_TOKEN, oauthUser.refreshToken], [user.ID, userRow.id]);
  } else {
    if (provider === 'apple' && !oauthUser.email) throw new Error('Apple did not provide a verified email for registration');
    const existingByEmail = await user.for('internal').get([user.EMAIL, oauthUser.email]);
    if (existingByEmail.length) {
      return res.redirect(
        loginErrorRedirect(
          redirect,
          `User already exists, please login to link to ${{ github: 'GitHub', google: 'Google', apple: 'Apple' }[provider]} account.`,
        ),
      );
    } else {
      const insertCols = [
        [idCol, oauthUser.id],
        [user.NAME, oauthUser.name],
        [user.EMAIL, oauthUser.email],
        [user.PRIMARY_AUTH, provider],
        [user.PASSWORD, generateRandomPassword()],
      ];

      if (provider === 'apple') insertCols.push([user.APPLE_REFRESH_TOKEN, oauthUser.refreshToken]);

      if (oauthUser.github) {
        insertCols.push([user.GITHUB, oauthUser.github]);
      }

      if (oauthUser.avatar_url) {
        insertCols.push([user.AVATAR_URL, oauthUser.avatar_url]);
      }

      if (oauthUser.x) {
        insertCols.push([user.X, oauthUser.x]);
      }

      if (oauthUser.website) {
        insertCols.push([user.WEBSITE, oauthUser.website]);
      }

      await user.insert(...insertCols);
      const [created] = await user.for('internal').get(provider === 'apple' ? [idCol, oauthUser.id] : [user.EMAIL, oauthUser.email]);
      userRow = created;
    }
  }

  await issueTokenAndLogin(userRow.id, res);
  res.redirect(validatedRedirect(redirect) || '/');
}

function withAccountSelection(authUrl, redirect) {
  const destination = new URL(redirect || '/', 'https://acode.app');
  if (destination.pathname !== '/login' || destination.searchParams.get('redirect') !== 'app') return authUrl;
  const url = new URL(authUrl);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

function loginErrorRedirect(redirect, message) {
  const destination = validatedRedirect(redirect);
  const target = new URL(destination || '/login', 'https://acode.app');
  const url = target.pathname === '/login' ? target : new URL('/login', target.origin);
  if (destination && target.pathname !== '/login') url.searchParams.set('redirect', destination);
  url.searchParams.set('error', message);
  return `${url.pathname}${url.search}`;
}

module.exports = route;
