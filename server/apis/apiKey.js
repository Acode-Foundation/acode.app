const { Router } = require('express');
const crypto = require('node:crypto');
const ApiKey = require('../entities/apiKey');
const Otp = require('../entities/otp');
const Plugin = require('../entities/plugin');
const { getWebLoggedInUser, getToken } = require('../lib/helpers');
const {
  SCOPES,
  getBearerToken,
  LIFETIME_DAYS,
  MAX_ACTIVE_KEYS,
  MAX_PLUGINS_PER_KEY,
  MAX_NAME_LENGTH,
  generateApiKey,
  hashApiKey,
  displayPrefix,
  parseKeySpec,
  digestKeySpec,
} = require('../lib/apiKey');
const { apiKeyCodeLimiter, apiKeyCreateLimiter } = require('../lib/rateLimits');
const sendEmail = require('../lib/sendEmail');

const route = Router();
const codeLifetime = 10 * 60 * 1000;
const cooldownMessage = 'Wait a minute before requesting another code.';
const DAY = 24 * 60 * 60 * 1000;

// Keys are managed only from a signed-in browser session. A key can never list,
// create or revoke keys, and neither can app sessions.
route.use(async (req, res, next) => {
  try {
    if (getBearerToken(req) !== null) return res.status(403).send({ error: 'API keys cannot manage API keys.' });
    const user = await getWebLoggedInUser(req);
    if (!user || user.role === 'deleted') return res.status(401).send({ error: 'Please sign in to manage your API keys.' });
    req.keyOwner = user;
    // Codes are bound to the session that requested them.
    req.confirmationKey = `api-key:${user.id}:${digest(getToken(req))}`;
    next();
  } catch {
    res.status(500).send({ error: 'Unable to load your account.' });
  }
});

route.get('/', async (req, res) => {
  try {
    const keys = ApiKey.listForUser(req.keyOwner.id).map(presentKey);
    const plugins = await ownedPlugins(req.keyOwner.id);
    res.set('Cache-Control', 'no-store');
    res.send({
      keys,
      plugins: plugins.map(({ id, name }) => ({ id, name })),
      scopes: Object.entries(SCOPES).map(([id, scope]) => ({ id, ...scope })),
      lifetimeDays: LIFETIME_DAYS,
      limits: { maxActiveKeys: MAX_ACTIVE_KEYS, maxPluginsPerKey: MAX_PLUGINS_PER_KEY, maxNameLength: MAX_NAME_LENGTH },
    });
  } catch (error) {
    console.error('Failed to list API keys:', error);
    res.status(500).send({ error: 'Unable to load your API keys.' });
  }
});

route.post('/confirmation-code', apiKeyCodeLimiter, async (req, res) => {
  try {
    const checked = await checkSpec(req);
    if (checked.error) return res.status(checked.status || 400).send({ error: checked.error });
    const { spec, pluginNames } = checked;

    const [previous] = await Otp.for('internal').get([Otp.EMAIL, req.confirmationKey]);
    if (previous && Date.now() - Date.parse(previous.created_at) < 60_000) {
      return res.status(429).send({ error: cooldownMessage });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const hash = codeHash(req.confirmationKey, spec, code);
    const values = [
      [Otp.OTP, hash],
      [Otp.CREATED_AT, new Date().toISOString()],
    ];
    if (previous) await Otp.update(values, [Otp.EMAIL, req.confirmationKey]);
    else await Otp.insert([Otp.EMAIL, req.confirmationKey], ...values);

    try {
      await sendEmail(req.keyOwner.email, req.keyOwner.name, 'Confirm new Acode API key', confirmationEmail(spec, pluginNames, code));
    } catch (error) {
      await Otp.delete([
        [Otp.EMAIL, req.confirmationKey],
        [Otp.OTP, hash],
      ]);
      throw error;
    }
    res.send({ message: 'A confirmation code has been sent to your account email.' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(429).send({ error: cooldownMessage });
    console.error('Failed to send API key confirmation code:', error);
    res.status(500).send({ error: 'Unable to send the confirmation code. Please try again.' });
  }
});

route.post('/', apiKeyCreateLimiter, async (req, res) => {
  try {
    const checked = await checkSpec(req);
    if (checked.error) return res.status(checked.status || 400).send({ error: checked.error });
    const { spec } = checked;

    const invalidCode = { error: 'Invalid or expired confirmation code. Codes only work for the exact key settings they were sent for.' };
    const code = req.body?.code;
    const [pending] = await Otp.for('internal').get([Otp.EMAIL, req.confirmationKey]);
    const sentAt = Date.parse(pending?.created_at);
    if (
      typeof code !== 'string' ||
      !/^\d{6}$/.test(code) ||
      !Number.isFinite(sentAt) ||
      sentAt > Date.now() ||
      Date.now() - sentAt >= codeLifetime ||
      !matches(codeHash(req.confirmationKey, spec, code), pending?.otp)
    ) {
      return res.status(400).send(invalidCode);
    }

    const token = generateApiKey();
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    // Consumes the code in the same transaction as the insert, so it can only ever mint one key.
    const created = ApiKey.createWithinLimit(
      {
        userId: req.keyOwner.id,
        name: spec.name,
        tokenHash: hashApiKey(token),
        tokenPrefix: displayPrefix(token),
        scopes: spec.scopes,
        pluginIds: spec.pluginIds,
        createdAt,
        expiresAt: new Date(now + spec.lifetimeDays * DAY).toISOString(),
      },
      MAX_ACTIVE_KEYS,
      { email: req.confirmationKey, otp: pending.otp },
    );
    if (created.error === 'limit') return res.status(400).send({ error: activeLimitMessage() });
    if (created.error) return res.status(400).send(invalidCode);
    const { id } = created;

    const [key] = ApiKey.listForUser(req.keyOwner.id).filter((row) => row.id === id);
    res.set('Cache-Control', 'no-store');
    res.send({ key: presentKey(key), token });
  } catch (error) {
    console.error('Failed to create API key:', error);
    res.status(500).send({ error: 'Unable to create the API key. Please try again.' });
  }
});

route.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0 || !ApiKey.revoke(id, req.keyOwner.id)) {
      return res.status(404).send({ error: 'API key not found.' });
    }
    res.send({ message: 'API key revoked.' });
  } catch (error) {
    console.error('Failed to revoke API key:', error);
    res.status(500).send({ error: 'Unable to revoke the API key. Please try again.' });
  }
});

/**
 * Validates the requested key and that the signed-in user owns every plugin in it.
 * @param {import('express').Request} req
 */
async function checkSpec(req) {
  const parsed = parseKeySpec(req.body);
  if (parsed.error) return parsed;
  const { spec } = parsed;

  const owned = new Map((await ownedPlugins(req.keyOwner.id)).map((plugin) => [plugin.id, plugin.name]));
  const unknown = spec.pluginIds.filter((id) => !owned.has(id));
  if (unknown.length) return { error: `You don't own plugin "${unknown[0]}".` };

  const now = new Date().toISOString();
  const active = ApiKey.listForUser(req.keyOwner.id).filter((key) => key.expires_at > now).length;
  if (active >= MAX_ACTIVE_KEYS) return { error: activeLimitMessage() };

  return { spec, pluginNames: spec.pluginIds.map((id) => owned.get(id) || id) };
}

async function ownedPlugins(userId) {
  return Plugin.for('internal').get(
    [Plugin.ID, Plugin.NAME],
    [
      [Plugin.USER_ID, userId],
      [Plugin.STATUS, Plugin.STATUS_DELETED, '<>'],
    ],
  );
}

function presentKey(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    scopes: row.scopes,
    pluginIds: row.plugin_ids,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    expired: !(Date.parse(row.expires_at) > Date.now()),
  };
}

function confirmationEmail(spec, pluginNames, code) {
  const scopes = spec.scopes.map((scope) => `<li>${escapeHtml(SCOPES[scope].description)}</li>`).join('');
  const plugins = pluginNames.length
    ? `<p><strong>Plugins:</strong></p><ul>${pluginNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>`
    : '';
  return `<p>You requested a new API key for your Acode account.</p>
<p><strong>Name:</strong> ${escapeHtml(spec.name)}<br><strong>Expires in:</strong> ${spec.lifetimeDays} days</p>
<p><strong>Permissions:</strong></p><ul>${scopes}</ul>
${plugins}
<p>Your confirmation code is <strong>${code}</strong>. It expires in 10 minutes and only works for the key described above.</p>
<p>If you did not request this, do not share the code. Change your password and review your API keys at https://acode.app/api-keys.</p>`;
}

function activeLimitMessage() {
  return `You can have at most ${MAX_ACTIVE_KEYS} active API keys. Revoke one before creating another.`;
}

function codeHash(confirmationKey, spec, code) {
  return digest(`${confirmationKey}:${digestKeySpec(spec)}:${code}`);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function matches(first, second) {
  return typeof second === 'string' && /^[a-f0-9]{64}$/.test(second) && crypto.timingSafeEqual(Buffer.from(first, 'hex'), Buffer.from(second, 'hex'));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

module.exports = route;
