const { Router } = require('express');
const { safeAccountRedirect } = require('../../shared/accountRedirect');
const user = require('../entities/user');
const { getWebLoggedInUser } = require('../lib/helpers');
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
};

function validatedRedirect(url) {
  if (url === 'app') return '/login?redirect=app';
  return safeAccountRedirect(url) || null;
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

  await user.update(updates, [user.ID, loggedInUser.id]);

  return res.redirect(`/profile?linked=${provider}`);
}

async function handleLogin(provider, oauthUser, res, redirect) {
  const idCol = ID_COL[provider];
  let userRow;

  const existingById = await user.for('internal').get([idCol, oauthUser.id]);
  if (existingById.length) {
    userRow = existingById[0];
  } else {
    const existingByEmail = await user.for('internal').get([user.EMAIL, oauthUser.email]);
    if (existingByEmail.length) {
      return res.redirect(
        loginErrorRedirect(redirect, `User already exists, please login to link to ${provider === 'github' ? 'GitHub' : 'Google'} account.`),
      );
    } else {
      const insertCols = [
        [idCol, oauthUser.id],
        [user.NAME, oauthUser.name],
        [user.EMAIL, oauthUser.email],
        [user.PRIMARY_AUTH, provider],
        [user.PASSWORD, generateRandomPassword()],
      ];

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
      const [created] = await user.for('internal').get([user.EMAIL, oauthUser.email]);
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
