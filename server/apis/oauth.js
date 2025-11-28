// TODO: Lookout for vulnerabilities.
// TODO: support for Code challeges
// TODO: Custom State support for remembering redirects.
const { Router } = require('express');
const OAuthProviderFactory = require('../services/oauth/OAuthProviderFactory');
const SessionStateServiceClass = require('../services/oauth/SessionStateService');
// For single-instance use only. For clustering/horizontal scaling, inject a distributed store (e.g. Redis) into SessionStateService.
const sessionStateService = new SessionStateServiceClass();
const authenticateWithProvider = require('../lib/authenticateWithProvider');

const SUCCESS_REDIRECT_PATH = `/login`;

const router = Router();
router.get('/:provider', async (req, res) => {
  const { provider } = req.params;

  try {
    if (!provider) {
      return res.status(400).send('No provider provided');
    }

    const oAuthProvider = OAuthProviderFactory.getProvider(provider);

    const state = await sessionStateService.generateState();

    res.cookie('oauthProvider', provider, { secure: true, httpOnly: true, sameSite: 'lax' });
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
  const { code, state, error, error_description } = req.query;

  try {
    if (!provider) {
      return res.status(400).send('No provider provided');
    }

    if(error) {
      console.error(`[OAuth Router] - Provider (${provider}) responded with an error: ${error}`);
      res.redirect(`${SUCCESS_REDIRECT_PATH}?error=${error}&error_description=${error_description}`);
      return;
    }

    if(!code) {
      console.error(`[OAuth Router] - Provider (${provider}) responded without a code: ${code}`);
      res.redirect(`${SUCCESS_REDIRECT_PATH}?error=missing_code`);
      return;
    }

    const storedState = req.signedCookies.oauthState;
    const storedProvider = req.cookies?.oauthProvider;
    if(!storedState || !(await sessionStateService.verifyState(state))) {
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

    const profile = await OAuthProvider.getUserProfile(tokens.accessToken).catch((e) => {
      res.status(401).send(e?.message || "Failed to retrieve user profile");
      return null;
    });

    if(!profile) return;

    console.log(`[OAuth Router] - Provider (${provider}) authentication successful for user ID: ${profile.id}`);

    // return res.status(200).send(`Fetched From Github, Hello ${profile.username} (${profile.name})`);

    const loginToken = await authenticateWithProvider(provider, profile, tokens);
    
    if(!loginToken) {
      res.status(500).send({ error: "Session Token issuing failed for Social Login."});
      return;
    }

    res.cookie('token', loginToken, { 
      httpOnly: true, 
      secure: true, 
      maxAge: 7 * 24 * 60 * 60 * 1000  // 1 week
    });

    /*
     NOTE: Replace the Hardcoded URL with the actual URL given by the frontend.
     /* */
    return res.redirect('/user');

  } catch (e) {
    console.error(`[OAuth Router] - OAuth callback (route: ${req.path}) error:`, e);
    return res.sendStatus(500)
  }
})

module.exports = router;