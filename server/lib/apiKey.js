const crypto = require('node:crypto');
const zlib = require('node:zlib');

/**
 * API keys are bearer credentials for automation (CI publishing). The rules:
 * - A key holds only the scopes and plugins it was created for; it never acts as
 *   a login session, so it can't manage the account, payments or other keys.
 * - Every key expires. There is no "never expires" option.
 * - Only a SHA-256 hash is stored; the key is shown once, at creation.
 * - Keys are only read from `Authorization: Bearer`, never cookies or query strings.
 * - The `acode_` prefix and CRC32 checksum let secret scanners find leaked keys
 *   and let the server reject malformed keys without a database lookup.
 */

const PREFIX = 'acode_';
const SECRET_LENGTH = 36; // ~214 bits of entropy
const CHECKSUM_LENGTH = 6;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_REGEX = new RegExp(`^${PREFIX}([0-9A-Za-z]{${SECRET_LENGTH}})([0-9A-Za-z]{${CHECKSUM_LENGTH}})$`);
const DISPLAY_PREFIX_LENGTH = PREFIX.length + 4;

const SCOPE_PLUGIN_PUBLISH = 'plugin:publish';
const SCOPE_PLUGIN_CREATE = 'plugin:create';
/**
 * `resource: 'plugin'` scopes only act on the plugins chosen for the key.
 * `default` is whether the scope is preselected when creating a key.
 */
const SCOPES = {
  [SCOPE_PLUGIN_PUBLISH]: {
    label: 'Publish updates',
    description: 'Publish new versions of the selected plugins',
    resource: 'plugin',
    default: true,
  },
  [SCOPE_PLUGIN_CREATE]: { label: 'Submit plugins', description: 'Submit new plugins for review', resource: null, default: false },
};

const LIFETIME_DAYS = [7, 30, 90, 180, 365];
const MAX_ACTIVE_KEYS = 10;
const MAX_PLUGINS_PER_KEY = 100;
const MAX_NAME_LENGTH = 60;

function generateApiKey() {
  const secret = randomBase62(SECRET_LENGTH);
  return `${PREFIX}${secret}${checksum(secret)}`;
}

/**
 * Checks shape and checksum only; it does not mean the key exists.
 * @param {unknown} token
 */
function isWellFormedApiKey(token) {
  if (typeof token !== 'string') return false;
  const match = KEY_REGEX.exec(token);
  return Boolean(match) && checksum(match[1]) === match[2];
}

/**
 * @param {string} token
 */
function hashApiKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Non-secret part of a key, shown in the key list so users can tell keys apart.
 * @param {string} token
 */
function displayPrefix(token) {
  return token.slice(0, DISPLAY_PREFIX_LENGTH);
}

/**
 * The bearer token in `Authorization`, `''` when the header holds something
 * else, or `null` when there is no bearer header at all.
 * @param {import('express').Request} req
 */
function getBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || header.slice(0, 6).toLowerCase() !== 'bearer') return null;
  // String ops instead of one regex: patterns like /Bearer\s+(\S*)\s*$/ backtrack polynomially on long runs of whitespace.
  const rest = header.slice(6);
  if (rest && rest[0] !== ' ' && rest[0] !== '\t') return null;
  const token = rest.trim();
  return token && !/\s/.test(token) ? token : '';
}

/**
 * @param {{ scopes: string[] }} key
 * @param {string} scope
 */
function hasScope(key, scope) {
  return Array.isArray(key?.scopes) && key.scopes.includes(scope);
}

/**
 * Validates the user-supplied part of a new key. Plugin ownership is checked by the caller.
 * @param {object} body
 * @returns {{ error: string } | { spec: { name: string, scopes: string[], pluginIds: string[], lifetimeDays: number } }}
 */
function parseKeySpec(body) {
  const { name, scopes, pluginIds, lifetimeDays } = body || {};

  if (typeof name !== 'string' || !name.trim()) return { error: 'Give the key a name.' };
  const trimmedName = name.trim();
  if (trimmedName.length > MAX_NAME_LENGTH) return { error: `Key name must be at most ${MAX_NAME_LENGTH} characters.` };
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(trimmedName)) return { error: 'Key name contains invalid characters.' };

  if (!Array.isArray(scopes) || !scopes.length) return { error: 'Select at least one permission.' };
  if (scopes.some((scope) => typeof scope !== 'string' || !Object.hasOwn(SCOPES, scope))) return { error: 'Unknown permission.' };

  const pluginScoped = scopes.some((scope) => SCOPES[scope].resource === 'plugin');
  if (pluginScoped) {
    if (!Array.isArray(pluginIds) || !pluginIds.length) return { error: 'Select at least one plugin.' };
    if (pluginIds.length > MAX_PLUGINS_PER_KEY) return { error: `A key can cover at most ${MAX_PLUGINS_PER_KEY} plugins.` };
    if (pluginIds.some((id) => typeof id !== 'string' || !id)) return { error: 'Invalid plugin.' };
  }

  if (!LIFETIME_DAYS.includes(lifetimeDays)) return { error: 'Choose a supported expiration.' };

  return {
    spec: {
      name: trimmedName,
      scopes: [...new Set(scopes)].sort(),
      // Plugins only mean something to plugin-scoped permissions.
      pluginIds: pluginScoped ? [...new Set(pluginIds.map((id) => id.toLowerCase()))].sort() : [],
      lifetimeDays,
    },
  };
}

/**
 * Stable digest of a key spec, so a confirmation code only approves exactly what
 * the user saw in the confirmation email.
 * @param {{ name: string, scopes: string[], pluginIds: string[], lifetimeDays: number }} spec
 */
function digestKeySpec(spec) {
  const canonical = JSON.stringify([spec.name, spec.scopes, spec.pluginIds, spec.lifetimeDays]);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function randomBase62(length) {
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length)) {
      // 248 = 62 * 4; rejecting larger bytes keeps every character equally likely.
      if (byte < 248 && out.length < length) out += BASE62[byte % 62];
    }
  }
  return out;
}

function checksum(secret) {
  let value = zlib.crc32(secret);
  let out = '';
  for (let i = 0; i < CHECKSUM_LENGTH; i++) {
    out = BASE62[value % 62] + out;
    value = Math.floor(value / 62);
  }
  return out;
}

module.exports = {
  SCOPES,
  SCOPE_PLUGIN_PUBLISH,
  SCOPE_PLUGIN_CREATE,
  LIFETIME_DAYS,
  MAX_ACTIVE_KEYS,
  MAX_PLUGINS_PER_KEY,
  MAX_NAME_LENGTH,
  generateApiKey,
  isWellFormedApiKey,
  hashApiKey,
  displayPrefix,
  getBearerToken,
  hasScope,
  parseKeySpec,
  digestKeySpec,
};
