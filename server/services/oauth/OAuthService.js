/**
 * @typedef OAuthServiceConfig
 * @property {string} clientId Required for OAuth.
 * @property {string} clientSecret Required for OAuth.
 * @property {string} [redirectUri] optional, Redirect URI, which the user/client is redirected after completion.
 * @property {string} authorizationUrl Authorization Server URL **Required** to Redirect the User to the URL to connect their accounts with Authorization Server.
 * @property {string} tokenUrl Required used for retrieving Access, (sometimes Also) Refresh Tokens.
 * @property {string} userInfoUrl Required for Retrieve User's Profile Data.
 * @property {string} scopes Required To request permissions for read/write on User's Profile.
 * @property {string} providerName Good Name For The Provider.
 */

class OAuthService {
  /**
   * @param config {OAuthServiceConfig}
   */
  constructor(config) {
    Object.freeze(config);

    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.redirectUri = config?.redirectUri;
    this.authorizationUrl = config.authorizationUrl;
    this.tokenUrl = config.tokenUrl;
    this.userInfoUrl = config.userInfoUrl;
    this.scopes = config.scopes;
    this.providerName = config.providerName;

    ;["clientId", "clientSecret", "authorizationUrl", "tokenUrl", "userInfoUrl", "scopes", "providerName"].forEach(p=> {
      if(!this?.[p]) throw RangeError(`"${p}" is required, but not specified in OAuthService Class Configuration`);
     })
  }

  // Generate authorization URL
  getAuthorizationUrl(state) {
    if(!state) throw ReferenceError("state is missing for generating Authorization URL");

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      state: state, // CSRF protection
      scope: this.scopes.join(' '),
    });

    if(this.redirectUri) params.append('redirect_uri', this.redirectUri);

    return `${this.authorizationUrl}?${params.toString()}`;
  }

  // Exchange authorization code for access token
  async getAccessToken(code) {
    if(!code) {
      throw Error(`[${this.providerName} - getAccessToken] Code is required: ${code}`);
    }
    try {
      const response = await fetch(
        this.tokenUrl,
        {
          method: 'POST',
          body: JSON.stringify({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            code: code,
            redirect_uri: this.redirectUri,
            grant_type: 'authorization_code'
          }),
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );
      // TODO: Throw Error, In Case where Response's body has error property
      console.log(`[${this.providerName} - getAccessToken] Response status: ${response.status} (${response.statusText})`, await response.json());

      return this.normalizeTokenResponse(await response.json());
    } catch (error) {
      console.error(`${this.providerName} token exchange error:`, error.response?.data || error.message);
      throw new Error(`Failed to exchange code for token with ${this.providerName}`);
    }
  }

  // Normalize token response across providers
  normalizeTokenResponse(data) {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope
    };
  }

  // Fetch user profile (to be overridden by specific providers)
  async getUserProfile(accessToken) {
    throw new Error('getUserProfile must be implemented by provider-specific service');
  }

  // Refresh access token
  async refreshAccessToken(refreshToken) {
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch(
        this.tokenUrl,
        {
          method: 'POST',
          body: JSON.stringify({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
          }),
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        },
      );

      return this.normalizeTokenResponse(await response.json());
    } catch (error) {
      console.error(`${this.providerName} token refresh error:`, error.response?.data || error.message);
      throw new Error(`Failed to refresh token with ${this.providerName}`);
    }
  }
}

module.exports = OAuthService;