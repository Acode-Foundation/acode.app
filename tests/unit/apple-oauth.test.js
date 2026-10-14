import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { parse } from 'dotenv';
import { decodeProtectedHeader, jwtVerify, SignJWT } from 'jose';

const apple = createRequire(import.meta.url)('../../server/lib/appleOAuth');
const identityKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const clientKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const publicJwk = { ...identityKeys.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' };
let idToken;
let refreshToken;
let requests;

beforeEach(async () => {
  vi.stubEnv('APPLE_CLIENT_ID', 'app.acode.web');
  vi.stubEnv('APPLE_TEAM_ID', 'team-id');
  vi.stubEnv('APPLE_KEY_ID', 'key-id');
  const pem = clientKeys.privateKey.export({ format: 'pem', type: 'pkcs8' });
  vi.stubEnv('APPLE_PRIVATE_KEY', parse(`APPLE_PRIVATE_KEY="${pem}"`).APPLE_PRIVATE_KEY);
  vi.stubEnv('APPLE_CALLBACK_URL', 'https://acode.app/oauth/apple/callback');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32));
  refreshToken = 'private-refresh-token';
  requests = [];
  idToken = await identityToken();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      if (String(url).endsWith('/keys')) return Response.json({ keys: [publicJwk] });
      requests.push({ url, options });
      if (String(url).endsWith('/revoke')) return new Response(null, { status: 200 });
      return Response.json({ id_token: idToken, refresh_token: refreshToken });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('uses form_post and a nonce, verifies signed identity claims, and encrypts the revocation token', async () => {
  const url = new URL(await apple.getAppleAuthURL('browser-state', 'nonce'));
  expect(url.origin).toBe('https://appleid.apple.com');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    response_type: 'code',
    response_mode: 'form_post',
    scope: 'name email',
    nonce: 'nonce',
    state: 'browser-state',
  });
  const identity = await apple.exchangeAppleCode('one-time-code', 'nonce', 'First Last');
  expect(identity).toMatchObject({ id: 'apple-sub', email: 'relay@privaterelay.appleid.com', name: 'First Last' });
  expect(identity.refreshToken).not.toContain(refreshToken);
  expect(apple.unseal(identity.refreshToken, 'apple-refresh-token')).toBe(refreshToken);
  const body = requests[0].options.body;
  expect(body.get('code')).toBe('one-time-code');
  expect(body.get('redirect_uri')).toBe(process.env.APPLE_CALLBACK_URL);
  expect(decodeProtectedHeader(body.get('client_secret'))).toEqual({ alg: 'ES256', kid: 'key-id' });
  const { payload } = await jwtVerify(body.get('client_secret'), clientKeys.publicKey, {
    issuer: 'team-id',
    audience: 'https://appleid.apple.com',
    subject: 'app.acode.web',
    algorithms: ['ES256'],
  });
  expect(payload.exp - payload.iat).toBe(300);
});

it('rejects an unset key before contacting Apple', async () => {
  vi.stubEnv('APPLE_PRIVATE_KEY', '');
  await expect(apple.getAppleAuthURL('state', 'nonce')).rejects.toThrow('not configured');
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ['issuer', { iss: 'https://attacker.example' }],
  ['audience', { aud: 'another-client' }],
  ['expiry', { exp: 1 }],
  ['nonce', { nonce: 'other-nonce' }],
  ['missing nonce', { nonce: undefined }],
  ['subject', { sub: '' }],
  ['unverified email', { email_verified: 'false' }],
])('rejects an invalid Apple %s', async (_label, claims) => {
  idToken = await identityToken(claims);
  await expect(apple.exchangeAppleCode('code', 'nonce')).rejects.toThrow();
});

it('rejects a forged signature, unsigned tokens, and missing revocation credentials', async () => {
  const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  idToken = await identityToken({}, attacker.privateKey);
  await expect(apple.exchangeAppleCode('code', 'nonce')).rejects.toThrow();
  idToken = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"apple-sub"}').toString('base64url')}.`;
  await expect(apple.exchangeAppleCode('code', 'nonce')).rejects.toThrow();
  idToken = await identityToken();
  refreshToken = undefined;
  await expect(apple.exchangeAppleCode('code', 'nonce')).rejects.toThrow('revocation credential');
});

it('supports returning users without a new name or email and accepts Apple string verification claims', async () => {
  idToken = await identityToken({ email: undefined });
  expect(await apple.exchangeAppleCode('code', 'nonce')).toMatchObject({ id: 'apple-sub', name: 'Apple User', email: undefined });
  idToken = await identityToken({ email_verified: 'true' });
  expect((await apple.exchangeAppleCode('code', 'nonce')).email).toBe('relay@privaterelay.appleid.com');
});

it('revokes only the encrypted refresh credential and keeps provider error bodies out of errors', async () => {
  const encrypted = apple.seal(refreshToken, 'apple-refresh-token');
  await apple.revokeAppleToken(encrypted);
  expect(requests[0].url).toBe('https://appleid.apple.com/auth/revoke');
  expect(requests[0].options.body.get('token')).toBe(refreshToken);
  expect(requests[0].options.body.get('token_type_hint')).toBe('refresh_token');
  vi.stubGlobal('fetch', async () => new Response('sensitive-provider-response', { status: 400 }));
  await expect(apple.revokeAppleToken(encrypted)).rejects.toThrow('Apple authorization request failed');
  await expect(apple.exchangeAppleCode('code', 'nonce')).rejects.not.toThrow('sensitive-provider-response');
});

it('logs only known error codes and HTTP status, never raw provider errors or credentials', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    apple.logAppleError('sign-in completion', Object.assign(new Error('private-id-token'), { code: 'ERR_JWT_EXPIRED', status: 400 }));
    expect(log).toHaveBeenLastCalledWith('Apple sign-in completion failed:', { reason: 'ERR_JWT_EXPIRED', status: 400 });
    apple.logAppleError('callback', { code: 'private-refresh-token', name: 'private-key', message: 'client-secret', status: 'private-token' });
    expect(log).toHaveBeenLastCalledWith('Apple callback failed:', { reason: 'APPLE_OPERATION_FAILED', status: undefined });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|client-secret/);
  } finally {
    log.mockRestore();
  }
});

it('rejects modified ciphertext, wrong-purpose ciphertext and missing encryption configuration', () => {
  const encrypted = apple.seal('secret', 'apple-refresh-token');
  expect(() => apple.unseal(encrypted, 'apple-oauth')).toThrow();
  const changed = Buffer.from(encrypted, 'base64url');
  changed[changed.length - 1] ^= 1;
  expect(() => apple.unseal(changed.toString('base64url'), 'apple-refresh-token')).toThrow();
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
  expect(() => apple.seal('secret', 'apple-refresh-token')).toThrow('not configured');
});

function identityToken(claims = {}, key = identityKeys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: 'https://appleid.apple.com',
    aud: 'app.acode.web',
    sub: 'apple-sub',
    iat: now,
    exp: now + 300,
    nonce: 'nonce',
    email: 'relay@privaterelay.appleid.com',
    email_verified: true,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .sign(key);
}
