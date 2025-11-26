const { Router } = require('express');
const OAuthProviderFactory = require('../services/oauth/OAuthProviderFactory');
const SessionStateService = require('../services/oauth/SessionStateService');
const login = require('../entities/login');
const user = require('../entities/user');
const moment = require('moment');

const SUCCESS_REDIRECT_PATH = `/login`;

const router = Router();

router.get('/:provider', async (req, res) => {
  const { provider } = req.params;

  try {
    if (!provider) {
      return res.status(400).send('No provider provided');
    }

    const oAuthProvider = OAuthProviderFactory.getProvider(provider);

    const state = SessionStateService.generateState();

    res.cookie('oauthProvider', provider, { secure: true });
    res.cookie('oauthState', state, { secure: true, signed: true, httpOnly: true, maxAge: 10 * 60 * 1000 });

    const authURL = oAuthProvider.getAuthorizationUrl(state)

    res.redirect(authURL);
  } catch (e) {
    console.error(`[OAuth Router] - OAuth initiation (route: ${req.path}) error:`, e);
    res.status(400).json({ error: e.message });
  }
})

router.get('/:provider/callback', async (req, res) => {

  const { provider } = req.params;
  const { code, state, error } = req.query;

  try {
    if (!provider) {
      return res.status(400).send('No provider provided');
    }

    if(error) {
      console.error(`[OAuth Router] - Provider (${provider}) responded with an error: ${error}`);
      res.redirect(`${SUCCESS_REDIRECT_PATH}?error=${error}&error_description=${error?.error_description}`);
      return;
    }

    if(!code) {
      console.error(`[OAuth Router] - Provider (${provider}) responded without a code: ${code}`);
      res.redirect(`${SUCCESS_REDIRECT_PATH}?error=missing_code`);
      return;
    }

    const storedState = req.signedCookies.oauthState;
    const storedProvider = req.cookies?.oauthProvider;
    console.log("[stored] Auth state token, provider and received state ", { storedState, state, provider});
    if(!storedState || !SessionStateService.verifyState(state)) {
      res.clearCookie('oauthState');
      // res.status(422).send("Invalid State")
      res.redirect(`${SUCCESS_REDIRECT_PATH}?error=invalid_state`);
      return;
    }

    if(storedProvider !== provider) {
      console.error(`[OAuth Router] - Provider (${provider}) mismatch: ${storedProvider} !== ${provider}`);
      // res.status(422).send("OAuth Provider mismatch");
      res.redirect(`${SUCCESS_REDIRECT_PATH}?error=oauth_provider_mismatch`);
      return;
    }

    // res.clearCookie('oauthProvider');
    res.clearCookie('oauthState');

    const OAuthProvider = OAuthProviderFactory.getProvider(provider);

    const tokens = await OAuthProvider.getAccessToken(code).catch(() => {});

    if(!tokens?.accessToken || !tokens) {
      res.status(401).send("Failed to retrieve access token");
      return;
    }

    console.log(`[OAuth Router] - Provider (${provider}) responded with an tokens`, tokens);

    const profile = await OAuthProvider.getUserProfile(tokens.accessToken).catch((e) => {
      res.status(401).send(e?.message || "Failed to retrieve user profile");
    });

    if(!profile) return;

    console.log(`[OAuth Router] - Provider (${provider}) responded with profile`, profile);

    return res.status(200).send(`Fetched From Github, Hello ${profile.username} (${profile.name})`);

    // const userRow = await user.get([user.EMAIL, profile.email]);
    
    // // Generate our own random token...
    // const token = crypto.randomBytes(64).toString('hex');
    // const expiredAt = moment().add(1, 'week').format('YYYY-MM-DD HH:mm:ss.sss');
    
    // // Store the token we have generated in the login table
    // await login.insert([login.USER_ID, userRow[0].id], [login.TOKEN, token], [login.EXPIRED_AT, expiredAt]);

  } catch (e) {
    console.error(`[OAuth Router] - OAuth callback (route: ${req.path}) error:`, e);
    return res.sendStatus(500)
  }
})

module.exports = router;