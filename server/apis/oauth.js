// TODO: Lookout for vulnerabilities.
const { Router } = require('express');
const OAuthProviderFactory = require('../services/oauth/OAuthProviderFactory');
const SessionStateServiceClass = require('../services/oauth/SessionStateService');
const { ALLOWED_CALLBACK_HOSTS_ARRAY } = require('../../constants')
// For single-instance use only. For clustering/horizontal scaling, inject a distributed store (e.g. Redis) into SessionStateService.
const sessionStateService = new SessionStateServiceClass();
const authenticateWithProvider = require('../lib/authenticateWithProvider');

const ERROR_REDIRECT_PATH = `/login`;
const SUCCESS_CALLBACK_URL = `/user`

function isValidCallbackUrl(url) {
  if (!url) return false;
  // Allow relative paths
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  // Or validate against allowlist
  try {
    const parsed = new URL(url);
    return ALLOWED_CALLBACK_HOSTS_ARRAY.includes(parsed.host);
  } catch {
    return false;
  }
}

/**
 * @template REQ
 * @template RES
 * @param {REQ} req 
 * @param {RES} res 
 * @returns 
 */
async function handleOAuthSignIn (req, res) {
  const { provider } = req.params;

  const { callbackUrl } = (req?.query || req.body) || {};

  try {
    if (!provider) {
      return res.status(400).send('No provider provided');
    }

    // Validate callback URL to prevent open redirect
    if (callbackUrl && !isValidCallbackUrl(callbackUrl)) {
        return res.status(400).json({ error: 'Invalid callback URL' });
    }

    const oAuthProvider = OAuthProviderFactory.getProvider(provider);
    const state = await sessionStateService.generateState({ callbackUrl: `${isValidCallbackUrl(callbackUrl) ? callbackUrl : SUCCESS_CALLBACK_URL}` });
    res.cookie('oauthProvider', provider, { secure: true, httpOnly: true, sameSite: 'lax' });
    res.cookie('oauthState', state.state, { secure: true, signed: true, httpOnly: true, maxAge: 10 * 60 * 1000 });

    const authURL = await oAuthProvider.getAuthorizationUrl({ state: state.state, codeVerifier: state.codeVerifier })
    // console.log(authURL)
    res.redirect(authURL);
  } catch (e) {
    console.error(`[OAuth Router] - OAuth initiation (route: ${req.path}) error:`, e);
    res.status(400).json({ error: e.message });
  }
}

async function handleOAuthCallback(req, res) {
  const { provider } = req.params;
  const { code, state, error, error_description } = (req?.query || req.body) || {};

  try {
    if (!provider) {
      return res.status(400).send('No provider provided');
    }

    if(!state) {
      console.error(`[OAuth Router] - Provider (${provider}) responded without a state: ${error}`);
      return res.redirect(`${ERROR_REDIRECT_PATH}?error=missing_state`);
    }
    
    if(error) {
      console.error(`[OAuth Router] - Provider (${provider}) responded with an error: ${error}`);
      return res.redirect(`${ERROR_REDIRECT_PATH}?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(error_description || '')}`);    
    }

    if(!code) {
      console.error(`[OAuth Router] - Provider (${provider}) responded without a code: ${code}`);
      res.redirect(`${ERROR_REDIRECT_PATH}?error=missing_code`);
      return;
    }

    const storedState = req.signedCookies.oauthState;
    const storedProvider = req.cookies?.oauthProvider;

    const verifiedState = await sessionStateService.verifyState(state) 

    if(!storedState || !verifiedState) {
      res.clearCookie('oauthState');
      // res.status(422).send("Invalid State")
      res.redirect(`${ERROR_REDIRECT_PATH}?error=state_mismatch`);
      return;
    }

    if(storedState !== state) {
      console.log(`State mismatch between cookie & Callback State`, { storedState, state})
      res.clearCookie('oauthState');
      res.redirect(`${ERROR_REDIRECT_PATH}?error=state_mismatch`);
      return;
    }

    if(storedProvider !== provider) {
      console.error(`[OAuth Router] - Provider (${provider}) mismatch: ${storedProvider} !== ${provider}`);
      // res.status(422).send("OAuth Provider mismatch");
      res.redirect(`${ERROR_REDIRECT_PATH}?error=oauth_provider_mismatch`);
      return;
    }

    // res.clearCookie('oauthProvider');
    res.clearCookie('oauthState');

    const OAuthProvider = OAuthProviderFactory.getProvider(provider);

    const tokens = await OAuthProvider.getAccessToken({ code, codeVerifier: verifiedState.codeVerifier }).catch((e) => ({ error: e}));

    if(!tokens?.accessToken || !tokens) {
      console.log(tokens.error);
      res.status(401).send(tokens?.error || "Failed to retrieve access token");
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

    return res.redirect(`${isValidCallbackUrl(verifiedState.callbackUrl) ? verifiedState.callbackUrl : SUCCESS_CALLBACK_URL}`);

  } catch (e) {
    console.error(`[OAuth Router] - OAuth callback (route: ${req.path}) error:`, e);
    return res.sendStatus(500)
  }
}

const router = Router();
router.get('/:provider', handleOAuthSignIn)

router.post('/:provider', handleOAuthSignIn)

router.get('/:provider/callback', handleOAuthCallback)

router.post('/:provider/callback', handleOAuthCallback)

module.exports = router;