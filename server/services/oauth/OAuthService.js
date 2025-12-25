const { betterFetch } = require('@better-fetch/fetch');
const { TextEncoder } = require('node:util');
const { z } = require('zod');

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
 * @property {string} [prompt]
 */

class OAuthService {
  /**
   * @param config {OAuthServiceConfig}
   */
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.redirectUri = config.redirectUri;
    this.authorizationUrl = config.authorizationUrl;
    this.tokenUrl = config.tokenUrl;
    this.userInfoUrl = config.userInfoUrl;
    this.scopes = config.scopes;
    this.providerName = config.providerName;
    this.prompt = config.prompt || '';

    this.callbackUrl = '/user';
    // biome-ignore lint/complexity/noForEach: ignore
    ['clientId', 'clientSecret', 'authorizationUrl', 'tokenUrl', 'userInfoUrl', 'scopes', 'providerName'].forEach((p) => {
      if (!this[p]) throw TypeError(`"${p}" is required, but not specified in OAuthService Class Configuration`);
    });
  }

  // Generate authorization URL
  async getAuthorizationUrl({ state, codeVerifier }) {
    if (!state) throw ReferenceError('state is missing for generating Authorization URL');
    /** Section 4.2 of RFC 7636 -> https://datatracker.ietf.org/doc/html/rfc7636#section-4.2
     * S256
     * code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))
     **/
    const code_challenge = await this.#generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      state: state, // CSRF protection
      scope: this.scopes.join(' '),
    });

    if (this.redirectUri) params.append('redirect_uri', this.redirectUri);
    if (codeVerifier) {
      // Section 4.2 of RFC 7636 -> https://datatracker.ietf.org/doc/html/rfc7636#section-4
      params.append('code_challenge', code_challenge);
      params.append('code_challenge_method', 'S256');
    }

    return `${this.authorizationUrl}?${params.toString()}`;
  }

  // Exchange authorization code for access token
  async getAccessToken({ code, codeVerifier }) {
    if (!code) {
      throw Error(`[${this.providerName} - getAccessToken] Code is required: ${code}`);
    }
    try {
      const body = {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        grant_type: 'authorization_code',
      };

      if (codeVerifier) {
        body.code_verifier = codeVerifier;
      }

      if (this.redirectUri) {
        body.redirect_uri = this.redirectUri;
      }

      const { data: response, error } = await betterFetch(this.tokenUrl, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        output: z
          .object({
            access_token: z.string(),
            refresh_token: z.string().optional(),
            scope: z.string().optional(),
            token_type: z.string(),
            expires_in: z.number().optional(),
          })
          .or(
            z.object({
              error: z.string(),
              error_description: z.string().optional(),
              error_hint: z.string().optional(),
            }),
          ),
      });

      if (!response || response.error || error) {
        console.error(`[${this.providerName} - getAccessToken] `, response || error);
        throw response || error;
      }

      console.log(`[${this.providerName} - getAccessToken]`, response);

      return this.normalizeTokenResponse(response);
    } catch (e) {
      console.error(`${this.providerName} token exchange error:`, e);
      throw e.error ? e : new Error(`Failed to exchange code for token with ${this.providerName}`);
    }
  }

  // Normalize token response across providers
  normalizeTokenResponse(data) {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: data.expires_in || null,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope,
    };
  }

  // Fetch user profile (to be overridden by specific providers)
  // biome-ignore lint/correctness/noUnusedFunctionParameters: unused here as it is overridden.
  async getUserProfile(accessToken) {
    throw new Error('getUserProfile must be implemented by provider-specific service');
  }

  // Refresh access token
  async refreshAccessToken(refreshToken) {
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const { data: response, error } = await betterFetch(this.tokenUrl, {
        method: 'POST',
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        output: z
          .object({
            access_token: z.string(),
            refresh_token: z.string().optional(),
            scope: z.string().optional(),
            token_type: z.string(),
            expires_in: z.number().optional(),
          })
          .or(
            z.object({
              error: z.string(),
              error_description: z.string().optional(),
              error_hint: z.string().optional(),
            }),
          ),
      });

      if (!response || response.error || error) {
        console.error(`[${this.providerName} - refreshAccessToken] Token refresh failed`, error || response);
        throw response || error;
      }

      return this.normalizeTokenResponse(response);
    } catch (error) {
      console.error(`${this.providerName} token refresh error:`, error);
      throw new Error(`Failed to refresh token with ${this.providerName}`);
    }
  }
  /**
   *
   * @param {string} codeVerifier
   * @returns {Promise<string>}
   */
  async #generateCodeChallenge(codeVerifier) {
    if (!codeVerifier) throw ReferenceError('codeVerifier is required for generating Code Challenge');
    /** Section 4.2 of RFC 7636 -> https://datatracker.ietf.org/doc/html/rfc7636#section-4.2
     * S256
     * code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))
     **/

    const textEncoder = new TextEncoder();
    const encodedData = textEncoder.encode(codeVerifier);
    const hash = await crypto.subtle.digest('SHA-256', encodedData);
    return Buffer.from(new Uint8Array(hash)).toString('base64url');
  }
}

module.exports = OAuthService;
