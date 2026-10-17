const ApiKey = require('../entities/apiKey');
const User = require('../entities/user');
const { getBearerToken, hashApiKey, isWellFormedApiKey } = require('./apiKey');

const INVALID = { status: 401, error: 'Invalid API key.' };
const EXPIRED = { status: 401, error: 'This API key has expired. Create a new one at https://acode.app/api-keys.' };

/**
 * @typedef {object} ApiKeyAuth
 * @property {object} [key] the key row, with `scopes` and `plugin_ids` parsed
 * @property {object} [user] the key owner (never flagged as admin)
 * @property {number} [status] HTTP status when the key was rejected
 * @property {string} [error]
 */

/**
 * Resolves the API key sent as `Authorization: Bearer <key>`. Returns `null` when
 * the request carries no bearer header, so callers can fall back to a session.
 *
 * Endpoints opt in to API keys explicitly by calling this; `getLoggedInUser` and
 * friends never accept them. The result is cached on the request.
 * @param {import('express').Request} req
 * @returns {Promise<ApiKeyAuth | null>}
 */
async function getApiKeyAuth(req) {
  if (req.apiKeyAuth !== undefined) return req.apiKeyAuth;

  const token = getBearerToken(req);
  req.apiKeyAuth = token === null ? null : await resolve(token);

  if (req.apiKeyAuth?.key) {
    try {
      ApiKey.touch(req.apiKeyAuth.key.id, new Date().toISOString());
    } catch (error) {
      console.error('Failed to record API key use:', error.message);
    }
  }

  return req.apiKeyAuth;
}

/**
 * @param {string} token
 * @returns {Promise<ApiKeyAuth>}
 */
async function resolve(token) {
  if (!isWellFormedApiKey(token)) return INVALID;

  const key = ApiKey.findByHash(hashApiKey(token));
  if (!key) return INVALID;
  if (!(Date.parse(key.expires_at) > Date.now())) return EXPIRED;

  const [user] = await User.get(User.safeColumns, [User.ID, key.user_id]);
  if (!user || user.role === User.ROLE_DELETED) return INVALID;

  // Admin powers are never available through a key.
  return { key, user: { ...user, role: user.role === 'admin' ? 'user' : user.role, isAdmin: false, authType: 'api_key' } };
}

module.exports = { getApiKeyAuth };
