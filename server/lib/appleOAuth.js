const crypto = require('node:crypto');

const issuer = 'https://appleid.apple.com';
let appleKeys;
const diagnosticCodes = new Set([
  'APPLE_CONFIG_MISSING',
  'APPLE_ENCRYPTION_NOT_CONFIGURED',
  'APPLE_REVOCATION_CREDENTIAL_MISSING',
  'APPLE_HTTP_ERROR',
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JWKS_TIMEOUT',
  'ERR_JWKS_NO_MATCHING_KEY',
  'SQLITE_CONSTRAINT_UNIQUE',
]);

function logAppleError(operation, error) {
  // Messages, stacks, response bodies and arbitrary error properties may contain
  // credentials. Only log known diagnostic codes and bounded HTTP status codes.
  const reason = diagnosticCodes.has(error?.code) ? error.code : 'APPLE_OPERATION_FAILED';
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : undefined;
  console.error(`Apple ${operation} failed:`, { reason, status });
}

function encryptionKey() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY || '')) {
    throw Object.assign(new Error('Apple token encryption is not configured'), { code: 'APPLE_ENCRYPTION_NOT_CONFIGURED' });
  }
  return Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex');
}

// Separate purposes prevent a callback cookie from being used as a stored credential.
function seal(value, purpose) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function unseal(value, purpose) {
  const bytes = Buffer.from(value, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}

async function clientSecret() {
  const { importPKCS8, SignJWT } = await import('jose');
  const { APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = process.env;
  if (!APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
    throw Object.assign(new Error('Apple sign-in is not configured'), { code: 'APPLE_CONFIG_MISSING' });
  }
  const key = await importPKCS8(APPLE_PRIVATE_KEY, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: APPLE_KEY_ID })
    .setIssuer(APPLE_TEAM_ID)
    .setSubject(APPLE_CLIENT_ID)
    .setAudience(issuer)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

async function getAppleAuthURL(state, nonce) {
  encryptionKey();
  await clientSecret(); // Fail before sending the user to Apple if configuration is incomplete.
  const callback = new URL(process.env.APPLE_CALLBACK_URL);
  if (callback.protocol !== 'https:') throw new Error('Apple requires an HTTPS callback');
  const url = new URL(`${issuer}/auth/authorize`);
  url.search = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    redirect_uri: callback.href,
    response_type: 'code',
    response_mode: 'form_post',
    scope: 'name email',
    state,
    nonce,
  }).toString();
  return url.href;
}

async function appleRequest(endpoint, params) {
  const response = await fetch(`${issuer}/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.APPLE_CLIENT_ID, client_secret: await clientSecret(), ...params }),
    signal: AbortSignal.timeout(10_000),
  });
  // Never include Apple's response or request credentials in errors/logs.
  if (!response.ok) throw Object.assign(new Error('Apple authorization request failed'), { code: 'APPLE_HTTP_ERROR', status: response.status });
  return response;
}

async function exchangeAppleCode(code, nonce, name) {
  const response = await appleRequest('token', { code, grant_type: 'authorization_code', redirect_uri: process.env.APPLE_CALLBACK_URL });
  const tokens = await response.json();
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  appleKeys ||= createRemoteJWKSet(new URL(`${issuer}/auth/keys`));
  const { payload } = await jwtVerify(tokens.id_token, appleKeys, {
    issuer,
    audience: process.env.APPLE_CLIENT_ID,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
    maxTokenAge: '10m',
  });
  if (typeof payload.sub !== 'string' || !payload.sub || payload.nonce !== nonce) throw new Error('Invalid Apple identity');
  if (payload.email && payload.email_verified !== true && payload.email_verified !== 'true') throw new Error('Unverified Apple email');
  if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw new Error('Apple did not provide a revocation credential');
  return {
    id: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: name || 'Apple User',
    refreshToken: seal(tokens.refresh_token, 'apple-refresh-token'),
  };
}

async function revokeAppleToken(encryptedToken) {
  await appleRequest('revoke', { token: unseal(encryptedToken, 'apple-refresh-token'), token_type_hint: 'refresh_token' });
}

module.exports = { getAppleAuthURL, exchangeAppleCode, revokeAppleToken, seal, unseal, logAppleError };
