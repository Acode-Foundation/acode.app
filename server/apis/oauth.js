const { Router } = require('express');
const user = require('../entities/user');
const { getLoggedInUser } = require('../lib/helpers');
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

route.get('/github', (req, res) => {
  if (req.query.intent === 'link') {
    res.cookie('oauth_intent', 'link', { maxAge: 10 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
  }
  const state = generateState();
  res.cookie('oauth_state', state, { maxAge: 10 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
  res.redirect(getGitHubAuthURL(state));
});

route.get('/github/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!state || state !== req.cookies.oauth_state) {
      res.clearCookie('oauth_state');
      return res.redirect(`/login?error=${encodeURIComponent('Invalid state parameter')}`);
    }

    res.clearCookie('oauth_state');

    const intent = req.cookies.oauth_intent;
    res.clearCookie('oauth_intent');

    const accessToken = await getGitHubToken(code);
    const ghUser = await getGitHubUser(accessToken);

    if (intent === 'link') {
      await handleLink('github', ghUser, req, res);
    } else {
      await handleLogin('github', ghUser, req, res);
    }
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    res.redirect(`/login?error=${encodeURIComponent('OAuth failed')}`);
  }
});

route.get('/google', (req, res) => {
  if (req.query.intent === 'link') {
    res.cookie('oauth_intent', 'link', { maxAge: 10 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
  }
  const state = generateState();
  res.cookie('oauth_state', state, { maxAge: 10 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
  res.redirect(getGoogleAuthURL(state));
});

route.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!state || state !== req.cookies.oauth_state) {
      res.clearCookie('oauth_state');
      return res.redirect(`/login?error=${encodeURIComponent('Invalid state parameter')}`);
    }

    res.clearCookie('oauth_state');

    const intent = req.cookies.oauth_intent;
    res.clearCookie('oauth_intent');

    const accessToken = await getGoogleToken(code);
    const googleUser = await getGoogleUser(accessToken);

    if (intent === 'link') {
      await handleLink('google', googleUser, req, res);
    } else {
      await handleLogin('google', googleUser, req, res);
    }
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.redirect(`/login?error=${encodeURIComponent('OAuth failed')}`);
  }
});

async function handleLink(provider, oauthUser, req, res) {
  const loggedInUser = await getLoggedInUser(req);
  if (!loggedInUser) {
    return res.redirect(`/login?error=${encodeURIComponent('You must be logged in to link an account')}`);
  }

  const idCol = ID_COL[provider];
  const existingById = await user.for('internal').get([idCol, oauthUser.id]);

  if (existingById.length && existingById[0].id !== loggedInUser.id) {
    const target = provider === 'github' ? '/edit-user' : '/user';
    return res.redirect(`${target}?error=${encodeURIComponent(`This ${provider} account is already linked to another user.`)}`);
  }

  if (existingById.length && existingById[0].id === loggedInUser.id) {
    return res.redirect(`/profile?error=${encodeURIComponent(`${provider} account already linked.`)}`);
  }

  const updates = [
    [idCol, oauthUser.id],
    [user.AVATAR_URL, oauthUser.avatar_url],
  ];

  if (provider === 'github') {
    updates.push([user.GITHUB, oauthUser.login]);
  }

  await user.update(updates, [user.ID, loggedInUser.id]);

  return res.redirect(`/profile?linked=${provider}`);
}

async function handleLogin(provider, oauthUser, req, res) {
  const idCol = ID_COL[provider];
  let userRow;

  const existingById = await user.for('internal').get([idCol, oauthUser.id]);
  if (existingById.length) {
    userRow = existingById[0];
  } else {
    const existingByEmail = await user.for('internal').get([user.EMAIL, oauthUser.email]);
    if (existingByEmail.length) {
      userRow = existingByEmail[0];

      try {
        await user.update([idCol, oauthUser.id], [user.ID, userRow.id]);
      } catch (err) {
        if (err.message?.includes('UNIQUE constraint')) {
          const conflicting = await user.for('internal').get([idCol, oauthUser.id]);
          if (conflicting.length && conflicting[0].id !== userRow.id) {
            return res.redirect(
              '/login?error=' +
                encodeURIComponent(
                  'This ' +
                    provider +
                    ' account is already linked to a different user. Please login with your password and link it from your profile.',
                ),
            );
          }
        }
        throw err;
      }
    } else {
      const insertCols = [
        [user.NAME, oauthUser.name],
        [user.EMAIL, oauthUser.email],
        [idCol, oauthUser.id],
        [user.AVATAR_URL, oauthUser.avatar_url],
        [user.PRIMARY_AUTH, provider],
        [user.PASSWORD, generateRandomPassword()],
      ];

      if (provider === 'github') {
        insertCols.push([user.GITHUB, oauthUser.login]);
      }

      await user.insert(...insertCols);
      const [created] = await user.for('internal').get([user.EMAIL, oauthUser.email]);
      userRow = created;
    }
  }

  await issueTokenAndLogin(userRow.id, res);
  res.redirect(req.query.redirect || '/');
}

module.exports = route;
