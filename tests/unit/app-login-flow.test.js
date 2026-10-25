import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import cookieParser from 'cookie-parser';
import express from 'express';
import * as rateLimit from 'express-rate-limit';
import moment from 'moment';
import { safeAccountRedirect } from '../../shared/accountRedirect';

const appleCrypto = createRequire(import.meta.url)('../../server/lib/appleOAuth');

let server;
let origin;
let sessions;
let authCodes;
let sequence;
let oauthTokens;
let oauthUsers;
let oauthUserEntity;
let appleStart;
let appleExchange;
const verifier = 'ab'.repeat(32);
const state = 'cd'.repeat(24);
const challenge = crypto.createHash('sha256').update(verifier).digest('hex');

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('redirects signed-in visitors away from guest pages and keeps app confirmation available', async () => {
  await start();
  const get = (path, token = 'web-session') => fetch(`${origin}${path}`, { headers: { Cookie: `token=${token}` }, redirect: 'manual' });
  for (const path of ['/login', '/REGISTER/', '/register?redirect=/login', '/login?redirect=/register']) {
    const response = await get(path);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
  expect((await get('/register?redirect=%2Fplugins%3Fsort%3Dnew')).headers.get('Location')).toBe('/plugins?sort=new');
  expect(await (await get('/login', '')).text()).toBe('Guest form');
  expect(await (await get('/register', 'expired-token')).text()).toBe('Guest form');
  const context = `redirect=app&src=ios&state=${state}&challenge=${challenge}`;
  expect((await get(`/register?${context}`)).headers.get('Location')).toBe(`/login?${context}`);
  expect((await get(`/login/?${context}`)).headers.get('Location')).toBe(`/login?${context}`);
  expect(await (await get(`/login?${context}`)).text()).toBe('App confirmation');
});

it('rejects login and registration submissions from active web and app sessions before account writes', async () => {
  await start();
  sessions.set(99, { id: 99, user_id: 7, type: 'app', token: 'app-session' });
  for (const path of ['/api/login', '/api/user']) {
    for (const token of ['web-session', 'app-session']) {
      const response = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `token=${token}` },
        body: '{}',
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'You are already signed in.' });
    }
    const guest = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(guest.status).toBe(400); // Guests still reach the existing field validation.
  }
  expect(sessions.size).toBe(1);
  expect(oauthUserEntity.insert).not.toHaveBeenCalled();
});

it('prevents OAuth sign-in from replacing an active session, including a session created during the provider flow', async () => {
  await start();
  for (const provider of ['github', 'google', 'apple']) {
    const response = await fetch(`${origin}/oauth/${provider}`, { headers: { Cookie: 'token=web-session' }, redirect: 'manual' });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/');
  }
  expect(appleStart).not.toHaveBeenCalled();
  const completed = await fetch(`${origin}/oauth/github/callback?code=code&state=fixture-state`, {
    headers: { Cookie: 'token=web-session; oauth_state=fixture-state; oauth_redirect=%2Fplugins' },
    redirect: 'manual',
  });
  expect(completed.headers.get('Location')).toBe('/plugins');
  expect(completed.headers.get('Set-Cookie')).not.toContain('token=fixture-session');
  expect(oauthUserEntity.insert).not.toHaveBeenCalled();
});

it('supports repeated login/logout with an existing browser session, without spending the exchange limit on code issuance', async () => {
  await start();
  for (let attempt = 0; attempt < 5; attempt++) {
    const issued = await post('/app-auth-code', { state, challenge });
    expect(issued.status).toBe(200);
    const { code } = await issued.json();
    const wrong = await post('/app-token/exchange', { state, verifier: 'ff'.repeat(32), code }, false);
    expect(wrong.status).toBe(400);
    const exchanged = await post('/app-token/exchange', { state, verifier, code }, false);
    expect(exchanged.status).toBe(200);
    const { token } = await exchanged.json();
    expect((await accountRequest('GET', token)).status).toBe(200);
    const replay = await post('/app-token/exchange', { state, verifier, code }, false);
    expect(replay.status).toBe(400);
    expect((await accountRequest('DELETE', token)).status).toBe(200);
    expect((await accountRequest('GET', token)).status).toBe(401);
    expect((await accountRequest('GET', 'web-session')).status).toBe(200);
  }
  const pending = await (await post('/app-auth-code', { state, challenge })).json();
  for (let attempt = 6; attempt < 20; attempt++) expect((await post('/app-auth-code', { state, challenge })).status).toBe(200);
  const limited = await post('/app-auth-code', { state, challenge });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  const exchange = await post('/app-token/exchange', { state, verifier, code: pending.code }, false);
  expect(exchange.status).toBe(200);
});

it.each(['/app-auth-code', '/app-token'])('requires the confirmed account when issuing %s after a session switch', async (endpoint) => {
  await start();
  const confirmed = await (await accountRequest('GET', 'web-session')).json();
  expect(confirmed.id).toBe(7);
  sessions.set(90, { id: 90, user_id: 8, type: 'app', token: 'existing-app-session' });
  const issue = (expectedUserId) =>
    fetch(`${origin}/api/user${endpoint}`, {
      method: 'POST',
      // Another tab has replaced the browser's website session after account 7 was displayed.
      headers: { 'Content-Type': 'application/json', Cookie: 'token=other-web-session' },
      body: JSON.stringify({ state, challenge, expectedUserId }),
    });

  const mismatch = await issue(confirmed.id);
  expect(mismatch.status).toBe(409);
  expect(authCodes.size).toBe(0);
  expect([...sessions.values()]).toEqual([{ id: 90, user_id: 8, type: 'app', token: 'existing-app-session' }]);

  const current = await (await accountRequest('GET', 'other-web-session')).json();
  const accepted = await issue(current.id);
  expect(accepted.status).toBe(200);
  let token;
  if (endpoint === '/app-auth-code') {
    const { code } = await accepted.json();
    const exchanged = await post('/app-token/exchange', { code, state, verifier }, false);
    expect(exchanged.status).toBe(200);
    ({ token } = await exchanged.json());
  } else ({ token } = await accepted.json());
  expect((await (await accountRequest('GET', token)).json()).id).toBe(current.id);

  // Cached pages and older clients can still use the original request format.
  expect((await issue()).status).toBe(200);
});

it('rejects off-site OAuth return URLs while preserving local paths and app sign-in', async () => {
  await start();
  for (const redirect of ['https://example.com', '//example.com', '/\\example.com', '/\n/example.com']) {
    const response = await fetch(`${origin}/oauth/github?redirect=${encodeURIComponent(redirect)}`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.getSetCookie()).toContainEqual(expect.stringMatching(/^oauth_redirect=;.*Expires=Thu, 01 Jan 1970/));
  }
  for (const redirect of ['/', '/profile/edit?src=ios', 'app']) {
    const response = await fetch(`${origin}/oauth/github?redirect=${encodeURIComponent(redirect)}`, { redirect: 'manual' });
    expect(response.headers.get('Set-Cookie')).toContain('oauth_redirect=');
  }
});

it.each(['github', 'google'])('keeps the app request through %s account selection, successful login and cancellation', async (provider) => {
  await start();
  const loginUrl = `/login?redirect=app&src=android&androidPackage=com.foxdebug.acodefree&authFlow=app-code&state=${state}&challenge=${challenge}&appVersionCode=1017`;
  const started = await fetch(`${origin}/oauth/${provider}?redirect=${encodeURIComponent(loginUrl)}`, { redirect: 'manual' });
  expect(new URL(started.headers.get('Location')).searchParams.get('prompt')).toBe('select_account');
  const headers = { Cookie: `oauth_state=fixture-state; oauth_redirect=${encodeURIComponent(loginUrl)}` };
  const completed = await fetch(`${origin}/oauth/${provider}/callback?state=fixture-state&code=fixture-code`, { headers, redirect: 'manual' });
  expect(completed.headers.get('Location')).toBe(loginUrl);
  expect(completed.headers.get('Set-Cookie')).toContain('token=fixture-session');
  oauthTokens[provider].mockClear();
  const cancelled = await fetch(`${origin}/oauth/${provider}/callback?state=fixture-state&error=access_denied`, { headers, redirect: 'manual' });
  const returned = new URL(cancelled.headers.get('Location'), origin);
  expect(returned.pathname).toBe('/login');
  expect(returned.searchParams.get('error')).toContain('cancelled');
  returned.searchParams.delete('error');
  expect(`${returned.pathname}${returned.search}`).toBe(loginUrl);
  expect(oauthTokens[provider]).not.toHaveBeenCalled();
});

it.each(['github', 'google'])('preserves the %s return path on exchange failures and rejects off-site callback destinations', async (provider) => {
  await start();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const loginUrl = `/login?redirect=app&authFlow=app-code&state=${state}&challenge=${challenge}`;
  oauthTokens[provider].mockRejectedValueOnce(new Error('Provider unavailable'));
  const failed = await fetch(`${origin}/oauth/${provider}/callback?state=fixture-state&code=fixture-code`, {
    headers: { Cookie: `oauth_state=fixture-state; oauth_redirect=${encodeURIComponent(loginUrl)}` },
    redirect: 'manual',
  });
  const returned = new URL(failed.headers.get('Location'), origin);
  expect(returned.searchParams.get('error')).toContain('Please try again');
  expect(returned.searchParams.get('challenge')).toBe(challenge);
  const invalid = await fetch(`${origin}/oauth/${provider}/callback?state=wrong-state`, {
    headers: { Cookie: `oauth_state=fixture-state; oauth_redirect=${encodeURIComponent('https://example.com')}` },
    redirect: 'manual',
  });
  expect(invalid.headers.get('Location')).toMatch(/^\/login\?error=/);
});

it.each(['github', 'google'])('throttles %s callbacks before provider access and preserves safe return paths', async (provider) => {
  await start();
  const callback = (target, cookies) =>
    fetch(`${origin}/oauth/${target}/callback?state=fixture-state&code=fixture-code`, {
      headers: { Cookie: cookies },
      redirect: 'manual',
    });
  // Invalid state still spends the IP budget; changing cookies cannot reset it.
  for (let attempt = 0; attempt < 119; attempt++) {
    const response = await callback(provider, `oauth_state=wrong-${attempt}; token=forged-${attempt}`);
    expect(response.status).toBe(302);
  }
  expect(oauthTokens[provider]).not.toHaveBeenCalled();
  const valid = await callback(provider, 'oauth_state=fixture-state');
  expect(valid.headers.get('Set-Cookie')).toContain('token=fixture-session');
  expect(oauthTokens[provider]).toHaveBeenCalledOnce();

  const appReturn = `/login?redirect=app&authFlow=app-code&state=${state}&challenge=${challenge}`;
  for (const [cookies, destination] of [
    [`oauth_redirect=${encodeURIComponent(appReturn)}`, appReturn],
    ['oauth_redirect=%2Fplugins', '/login?redirect=%2Fplugins'],
    ['oauth_redirect=https%3A%2F%2Fattacker.example', '/login'],
    ['oauth_intent=link; token=web-session', '/profile/edit'],
  ]) {
    const limited = await callback(provider, `oauth_state=fixture-state; ${cookies}`);
    expect(limited.status).toBe(303);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(limited.headers.get('Cache-Control')).toBe('no-store');
    for (const name of ['oauth_state', 'oauth_intent', 'oauth_redirect']) {
      expect(limited.headers.getSetCookie()).toContainEqual(expect.stringMatching(new RegExp(`^${name}=;.*Expires=Thu, 01 Jan 1970`)));
    }
    const target = new URL(limited.headers.get('Location'), origin);
    expect(target.origin).toBe(origin);
    expect(target.searchParams.get('error')).toContain('Too many sign-in attempts');
    target.searchParams.delete('error');
    expect(`${target.pathname}${target.search}`).toBe(destination);
  }
  // Switching providers must not bypass the callback budget.
  const otherProvider = provider === 'github' ? 'google' : 'github';
  expect((await callback(otherProvider, 'oauth_state=fixture-state')).status).toBe(303);
  expect(oauthTokens[otherProvider]).not.toHaveBeenCalled();
  expect(oauthTokens[provider]).toHaveBeenCalledOnce();
  expect(oauthUserEntity.update).not.toHaveBeenCalled();
});

it.each(['github', 'google'])('clears a cancelled linking request before starting a new %s sign-in', async (provider) => {
  await start();
  const response = await fetch(`${origin}/oauth/${provider}`, {
    headers: { Cookie: 'oauth_intent=link; oauth_redirect=%2Fprofile%2Fedit' },
    redirect: 'manual',
  });
  const cookies = response.headers.getSetCookie();
  for (const name of ['oauth_intent', 'oauth_redirect']) {
    expect(cookies).toContainEqual(expect.stringMatching(new RegExp(`^${name}=;.*Expires=Thu, 01 Jan 1970`)));
  }
});

it.each(['ios', 'android'])('resumes Apple POST sign-in through the existing %s app return and PKCE confirmation', async (platform) => {
  await start();
  const destination = `/login?redirect=app&src=${platform}&authFlow=app-code&state=${state}&challenge=${challenge}`;
  const begun = await beginApple(`?redirect=${encodeURIComponent(destination)}`);
  expect(begun.headers.get('Set-Cookie')).toMatch(/__Host-apple_oauth=.*HttpOnly; Secure; SameSite=None/);
  const callback = await applePost(begun, {
    code: 'apple-code',
    user: JSON.stringify({ email: 'untrusted@example.com', name: { firstName: 'First', lastName: 'Last' } }),
  });
  expect(callback.status).toBe(303);
  expect(callback.headers.get('Location')).toBe('/oauth/apple/complete');
  expect(callback.headers.get('Set-Cookie')).toContain('SameSite=Lax');
  expect(appleExchange).not.toHaveBeenCalled();
  const completed = await completeApple(callback);
  expect(completed.headers.get('Location')).toBe(destination);
  expect(completed.headers.get('Set-Cookie')).toContain('token=fixture-session');
  expect(completed.headers.get('Cache-Control')).toBe('no-store');
  expect(appleExchange).toHaveBeenCalledExactlyOnceWith('apple-code', 'fixture-state', 'First Last');
  expect(oauthUsers[1]).toMatchObject({ name: 'Existing Apple User', email: 'existing@example.com', apple_refresh_token: 'encrypted-refresh' });
});

it('rejects forged, missing, expired and pre-callback Apple state without exchanging a code', async () => {
  await start();
  const begun = await beginApple();
  const badState = await applePost(begun, { state: 'wrong', code: 'code' });
  expect(badState.headers.get('Location')).toContain('error=');
  const missing = await fetch(`${origin}/oauth/apple/callback`, {
    method: 'POST',
    body: new URLSearchParams({ state: 'fixture-state', code: 'code' }),
    redirect: 'manual',
  });
  expect(missing.headers.get('Location')).toContain('error=');
  const initial = await completeApple(begun);
  expect(initial.headers.get('Location')).toContain('error=');
  const flow = JSON.parse(appleCrypto.unseal(cookie(begun).split('=')[1], 'apple-oauth'));
  flow.expires = Date.now() - 1;
  const expired = await fetch(`${origin}/oauth/apple/callback`, {
    method: 'POST',
    headers: { Cookie: `__Host-apple_oauth=${appleCrypto.seal(JSON.stringify(flow), 'apple-oauth')}` },
    body: new URLSearchParams({ state: flow.state, code: 'code' }),
    redirect: 'manual',
  });
  expect(expired.headers.get('Location')).toContain('error=');
  expect(appleExchange).not.toHaveBeenCalled();
});

it('preserves app return on Apple cancellation and verification failure, and rejects off-site redirects', async () => {
  await start();
  const destination = `/login?redirect=app&authFlow=app-code&state=${state}&challenge=${challenge}`;
  const begun = await beginApple(`?redirect=${encodeURIComponent(destination)}`);
  const cancelled = await completeApple(await applePost(begun, { error: 'access_denied' }));
  expect(new URL(cancelled.headers.get('Location'), origin).searchParams.get('challenge')).toBe(challenge);
  expect(cancelled.headers.get('Location')).toContain('cancelled');
  expect(appleExchange).not.toHaveBeenCalled();
  appleExchange.mockRejectedValueOnce(new Error('bad identity token'));
  const failed = await completeApple(await applePost(begun, { code: 'code' }));
  expect(new URL(failed.headers.get('Location'), origin).searchParams.get('challenge')).toBe(challenge);
  expect(failed.headers.get('Set-Cookie')).not.toContain('token=fixture-session');
  const external = await beginApple('?redirect=https://example.com');
  const completed = await completeApple(await applePost(external, { code: 'code' }));
  expect(completed.headers.get('Location')).toBe('/');
});

it('registers a relay address from verified Apple claims and never links an email collision automatically', async () => {
  await start();
  appleExchange.mockResolvedValue({ id: 'new-sub', email: 'hidden@privaterelay.appleid.com', name: 'Apple Name', refreshToken: 'encrypted-refresh' });
  await completeApple(await applePost(await beginApple(), { code: 'code' }));
  expect(oauthUsers[2]).toMatchObject({
    name: 'Apple Name',
    email: 'hidden@privaterelay.appleid.com',
    apple_id: 'new-sub',
    primary_auth: 'apple',
    apple_refresh_token: 'encrypted-refresh',
  });
  appleExchange.mockResolvedValue({ id: 'different-sub', email: 'web@example.com', name: 'Collision', refreshToken: 'encrypted-refresh' });
  const collision = await completeApple(await applePost(await beginApple(), { code: 'code' }));
  expect(new URL(collision.headers.get('Location'), origin).searchParams.get('error')).toContain('please login to link');
  expect(oauthUsers[0].apple_id).toBeUndefined();
  expect(oauthUserEntity.insert).toHaveBeenCalledTimes(1);
});

it('requires the original authenticated website session for explicit Apple linking', async () => {
  await start();
  const anonymous = await beginApple('?intent=link');
  expect(anonymous.headers.get('Location')).toContain('error=');
  const begun = await beginApple('?intent=link', 'web-session');
  const callback = await applePost(begun, { code: 'code' });
  for (const token of ['', 'other-web-session', 'renewed-web-session']) {
    const changed = await completeApple(callback, token);
    expect(changed.headers.get('Location')).toContain('account%20changed');
    expect(appleExchange).not.toHaveBeenCalled();
  }
  const owned = await completeApple(callback, 'web-session');
  expect(owned.headers.get('Location')).toContain('already%20linked%20to%20another');
  expect(oauthUserEntity.update).not.toHaveBeenCalled();
  appleExchange.mockResolvedValue({ id: 'unlinked-sub', refreshToken: 'encrypted-refresh' });
  const linked = await completeApple(await applePost(await beginApple('?intent=link', 'web-session'), { code: 'code' }), 'web-session');
  expect(linked.headers.get('Location')).toBe('/profile?linked=apple');
  expect(oauthUsers[0]).toMatchObject({
    apple_id: 'unlinked-sub',
    apple_refresh_token: 'encrypted-refresh',
    email: 'web@example.com',
    primary_auth: 'email',
  });
  appleExchange.mockResolvedValue({ id: 'another-unlinked-sub', refreshToken: 'replacement-refresh' });
  const replacement = await completeApple(await applePost(await beginApple('?intent=link', 'web-session'), { code: 'code' }), 'web-session');
  expect(replacement.headers.get('Location')).toContain('existing%20Apple%20account');
  expect(oauthUsers[0].apple_id).toBe('unlinked-sub');
});

it('protects primary Apple login, retains failed revocations and recovers missing credentials through sign-in', async () => {
  await start();
  const unlink = (token) => fetch(`${origin}/api/user/link/apple`, { method: 'DELETE', headers: token ? { Cookie: `token=${token}` } : {} });
  expect((await unlink()).status).toBe(401);
  oauthUsers[0].apple_id = 'linked-sub';
  oauthUsers[0].primary_auth = 'apple';
  expect((await unlink('web-session')).status).toBe(400);
  expect(oauthUserEntity.revokeAppleAuthorization).not.toHaveBeenCalled();
  oauthUsers[0].primary_auth = 'email';
  oauthUserEntity.revokeAppleAuthorization.mockRejectedValueOnce(new Error('Apple unavailable'));
  expect((await unlink('web-session')).status).toBe(500);
  expect(oauthUsers[0].apple_id).toBe('linked-sub');
  oauthUsers[0].apple_refresh_token = null;
  oauthUserEntity.revokeAppleAuthorization.mockRejectedValueOnce(
    Object.assign(new Error('Missing credential'), { code: 'APPLE_REVOCATION_CREDENTIAL_MISSING' }),
  );
  const missing = await unlink('web-session');
  expect(missing.status).toBe(409);
  expect((await missing.json()).error).toContain('Sign in with your linked Apple account');
  expect(oauthUsers[0]).toMatchObject({ apple_id: 'linked-sub', apple_refresh_token: null });
  appleExchange.mockResolvedValueOnce({ id: 'linked-sub', refreshToken: 'renewed-encrypted-refresh' });
  await completeApple(await applePost(await beginApple(), { code: 'code' }));
  expect(oauthUsers[0]).toMatchObject({ apple_id: 'linked-sub', apple_refresh_token: 'renewed-encrypted-refresh', primary_auth: 'email' });
  expect((await unlink('web-session')).status).toBe(200);
  expect(oauthUsers[0]).toMatchObject({ apple_id: null, apple_refresh_token: null });
});

it('keeps malformed callback traffic out of the Apple start and completion budget', async () => {
  await start();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const begun = await beginApple();
  const callback = await applePost(begun, { code: 'code' });
  let response;
  for (let attempt = 0; attempt <= 120; attempt++) {
    response = await fetch(`${origin}/oauth/apple/callback`, { method: 'POST', redirect: 'manual' });
  }
  expect(limitedLocation(response)).toBe('/login');
  const another = await beginApple();
  expect(another.status).toBe(302);
  expect((await applePost(another, { code: 'code' })).headers.get('Location')).toBe('/oauth/apple/complete');
  expect((await completeApple(callback)).status).toBe(302);
  expect(appleExchange).toHaveBeenCalledOnce();
});

it('preserves safe app-return context on throttled browser legs and separates authenticated accounts from the IP budget', async () => {
  await start();
  const destination = `/login?redirect=app&src=android&authFlow=app-code&state=${state}&challenge=${challenge}`;
  const begun = await beginApple(`?redirect=${encodeURIComponent(destination)}`);
  const callback = await applePost(begun, { code: 'code' });
  for (let attempt = 1; attempt < 120; attempt++) expect((await beginApple()).status).toBe(302);
  for (const target of [destination, destination.replace('android', 'ios')]) {
    expect(limitedLocation(await beginApple(`?redirect=${encodeURIComponent(target)}`))).toBe(target);
  }
  expect(limitedLocation(await completeApple(callback))).toBe(destination);
  expect(limitedLocation(await beginApple('?redirect=https://attacker.example'))).toBe('/login');
  expect(limitedLocation(await beginApple('', 'forged-token'))).toBe('/login');
  // A callback has its own budget even when the start/completion budget is spent.
  for (let attempt = 1; attempt < 120; attempt++) expect((await applePost(begun, { code: 'code' })).status).toBe(303);
  expect(limitedLocation(await applePost(begun, { code: 'code' }))).toBe(destination);
  const forged = await fetch(`${origin}/oauth/apple/complete?redirect=https://attacker.example`, {
    headers: { Cookie: '__Host-apple_oauth=forged' },
    redirect: 'manual',
  });
  expect(limitedLocation(forged)).toBe('/login');
  const expiredFlow = JSON.parse(appleCrypto.unseal(cookie(callback).split('=')[1], 'apple-oauth'));
  expiredFlow.expires = Date.now() - 1;
  const expired = await fetch(`${origin}/oauth/apple/complete`, {
    headers: { Cookie: `__Host-apple_oauth=${appleCrypto.seal(JSON.stringify(expiredFlow), 'apple-oauth')}` },
    redirect: 'manual',
  });
  expect(limitedLocation(expired)).toBe('/login');
  expect(appleStart).toHaveBeenCalledTimes(120);
  expect(appleExchange).not.toHaveBeenCalled();
  expect((await beginApple('?intent=link', 'web-session')).status).toBe(302);
  expect((await beginApple('?intent=link', 'other-web-session')).status).toBe(302);
  expect((await post('/app-auth-code', { state, challenge })).status).toBe(200);
});

it('keeps throttled Apple linking on account settings and shares its account budget across sessions', async () => {
  await start();
  const begun = await beginApple('?intent=link', 'web-session');
  const callback = await applePost(begun, { code: 'code' });
  for (let attempt = 1; attempt < 120; attempt++) expect((await beginApple('?intent=link', 'renewed-web-session')).status).toBe(302);
  expect(limitedLocation(await beginApple('?intent=link', 'web-session'))).toBe('/profile/edit');
  expect(limitedLocation(await completeApple(callback, 'renewed-web-session'))).toBe('/profile/edit');
  expect(appleExchange).not.toHaveBeenCalled();
  expect((await beginApple('?intent=link', 'other-web-session')).status).toBe(302);
  expect((await beginApple()).status).toBe(302);
});

it('limits Apple unlink by account across sessions before calling Apple, without blocking another account', async () => {
  await start();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  oauthUsers[0].apple_id = 'linked-sub';
  oauthUserEntity.revokeAppleAuthorization.mockRejectedValue(new Error('Apple unavailable'));
  const unlink = (token) => fetch(`${origin}/api/user/link/apple`, { method: 'DELETE', headers: { Cookie: `token=${token}` } });
  for (let attempt = 0; attempt < 5; attempt++) expect((await unlink(attempt % 2 ? 'renewed-web-session' : 'web-session')).status).toBe(500);
  const blocked = await unlink('renewed-web-session');
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(oauthUserEntity.revokeAppleAuthorization).toHaveBeenCalledTimes(5);
  expect(oauthUsers[0].apple_id).toBe('linked-sub');
  expect((await unlink('other-web-session')).status).toBe(500);
  expect(oauthUserEntity.revokeAppleAuthorization).toHaveBeenCalledTimes(6);
});

it.each(['linked', 'deleted'])('does not write Apple credentials when the account was %s during exchange', async (change) => {
  await start();
  const callback = await applePost(await beginApple('?intent=link', 'web-session'), { code: 'code' });
  appleExchange.mockImplementationOnce(async () => {
    Object.assign(
      oauthUsers[0],
      change === 'linked'
        ? { apple_id: 'newer-sub', apple_refresh_token: 'newer-refresh' }
        : { role: 'deleted', apple_id: null, apple_refresh_token: null },
    );
    return { id: 'delayed-sub', refreshToken: 'delayed-refresh' };
  });
  const response = await completeApple(callback, 'web-session');
  expect(response.headers.get('Location')).toContain('account%20changed');
  expect(oauthUsers[0]).toMatchObject(
    change === 'linked'
      ? { apple_id: 'newer-sub', apple_refresh_token: 'newer-refresh' }
      : { role: 'deleted', apple_id: null, apple_refresh_token: null },
  );
});

it('does not clear a new Apple link when an older unlink revocation finishes', async () => {
  await start();
  Object.assign(oauthUsers[0], { apple_id: 'old-sub', apple_refresh_token: 'old-refresh' });
  oauthUserEntity.revokeAppleAuthorization.mockImplementationOnce(async () => {
    const original = { ...oauthUsers[0] };
    Object.assign(oauthUsers[0], { apple_id: 'newer-sub', apple_refresh_token: 'newer-refresh' });
    return original;
  });
  const response = await fetch(`${origin}/api/user/link/apple`, { method: 'DELETE', headers: { Cookie: 'token=web-session' } });
  expect(response.status).toBe(409);
  expect(oauthUsers[0]).toMatchObject({ apple_id: 'newer-sub', apple_refresh_token: 'newer-refresh' });
});

function limitedLocation(response) {
  expect(response.status).toBe(303);
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.getSetCookie()).toContainEqual(expect.stringMatching(/^__Host-apple_oauth=;.*Secure/));
  const target = new URL(response.headers.get('Location'), origin);
  expect(target.origin).toBe(origin);
  expect(target.searchParams.get('error')).toContain('Too many Apple sign-in attempts');
  target.searchParams.delete('error');
  return `${target.pathname}${target.search}`;
}

function matches(row, where) {
  const conditions = Array.isArray(where[0]) ? where : [where];
  return conditions.every(([key, value, operator]) => {
    if (operator === '!=') return row[key] !== value;
    return value === null ? row[key] == null : row[key] === value;
  });
}

function cookie(response) {
  return response.headers
    .getSetCookie()
    .find((value) => value.startsWith('__Host-apple_oauth='))
    .split(';')[0];
}

function beginApple(query = '', token = '') {
  return fetch(`${origin}/oauth/apple${query}`, { headers: token ? { Cookie: `token=${token}` } : {}, redirect: 'manual' });
}

function applePost(begun, values) {
  return fetch(`${origin}/oauth/apple/callback`, {
    method: 'POST',
    headers: { Cookie: cookie(begun), Origin: 'https://appleid.apple.com' },
    body: new URLSearchParams({ state: 'fixture-state', ...values }),
    redirect: 'manual',
  });
}

function completeApple(callback, token = '') {
  return fetch(`${origin}/oauth/apple/complete`, {
    headers: { Cookie: `${cookie(callback)}${token ? `; token=${token}` : ''}` },
    redirect: 'manual',
  });
}

async function start() {
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32));
  sessions = new Map();
  authCodes = new Map();
  sequence = 0;
  oauthTokens = { github: vi.fn(async () => 'fixture-token'), google: vi.fn(async () => 'fixture-token') };
  const login = entity(sessions, ['ID', 'TYPE', 'TOKEN', 'USER_ID', 'EXPIRED_AT']);
  const codes = entity(authCodes, ['ID', 'USER_ID', 'CODE', 'STATE', 'CHALLENGE', 'USED', 'APP_VERSION_CODE', 'EXPIRED_AT']);
  codes.markUsed = (id) => {
    const row = authCodes.get(id);
    if (!row || row.used) return false;
    row.used = 1;
    return true;
  };
  codes.cleanupStaleRows = () => {};
  const webUsers = { 'web-session': 7, 'renewed-web-session': 7, 'other-web-session': 8 };
  oauthUsers = [
    { id: 7, name: 'Website User', email: 'web@example.com', primary_auth: 'email', role: 'user' },
    {
      id: 8,
      name: 'Existing Apple User',
      email: 'existing@example.com',
      apple_id: 'apple-sub',
      github_id: 'fixture-user',
      google_id: 'fixture-user',
    },
  ];
  oauthUserEntity = {
    ...Object.fromEntries(
      ['ID', 'EMAIL', 'NAME', 'ROLE', 'PASSWORD', 'PRIMARY_AUTH', 'GITHUB_ID', 'GOOGLE_ID', 'APPLE_ID', 'APPLE_REFRESH_TOKEN'].map((key) => [
        key,
        key.toLowerCase(),
      ]),
    ),
    for() {
      return this;
    },
    get: vi.fn(async (where) => oauthUsers.filter((row) => matches(row, where)).map((row) => ({ ...row }))),
    update: vi.fn(async (entries, where) => {
      const values = Array.isArray(entries[0]) ? entries : [entries];
      for (const row of oauthUsers.filter((row) => matches(row, where))) Object.assign(row, Object.fromEntries(values));
    }),
    insert: vi.fn(async (...entries) => oauthUsers.push({ id: 9, ...Object.fromEntries(entries) })),
    revokeAppleAuthorization: vi.fn(async (id) => ({ ...oauthUsers.find((row) => row.id === id) })),
  };
  appleStart = vi.fn(async (state, nonce) => `https://appleid.apple.com/auth/authorize?state=${state}&nonce=${nonce}`);
  appleExchange = vi.fn(async () => ({ id: 'apple-sub', refreshToken: 'encrypted-refresh' }));
  const helpers = {
    getLoginSession: async (req) => (webUsers[req.cookies?.token] ? { user_id: webUsers[req.cookies.token], type: 'web' } : null),
    getWebLoggedInUser: async (req) => {
      if (req.user) return req.user;
      const row = oauthUsers.find((row) => row.id === webUsers[req.cookies?.token]);
      if (!row) return null;
      req.user = { ...row };
      return req.user;
    },
    getLoggedInUser: async (req) => {
      if (webUsers[req.cookies?.token]) return { id: webUsers[req.cookies.token], authType: 'web' };
      const session = [...sessions.values()].find((row) => row.token === req.cookies?.token);
      return session ? { id: session.user_id, authType: session.type } : null;
    },
  };
  const limits = load(
    '../../server/lib/rateLimits.js',
    {
      'express-rate-limit': rateLimit,
      './helpers': helpers,
      './apiKeyAuth': { getApiKeyAuth: async () => null },
    },
    { process: { env: {} } },
  );
  const dependencies = {
    express,
    moment,
    'node:crypto': crypto,
    '../password': {},
    '../lib/helpers': helpers,
    '../lib/guestOnly': load('../../server/lib/guestOnly.js', {
      './helpers': helpers,
      '../../shared/accountRedirect': { safeAccountRedirect },
    }),
    '../lib/appleOAuth': appleCrypto,
    '../entities/login': login,
    '../entities/user': oauthUserEntity,
    '../entities/appAuthCode': codes,
    '../lib/rateLimits': limits,
    '../lib/emailCode': {},
    '../lib/calcEarnings': {},
    '../lib/developerDashboard': {},
    '../../constants.mjs': {},
  };
  const router = load('../../server/apis/user.js', dependencies);
  const account = load('../../server/apis/login.js', dependencies);
  const oauth = load('../../server/apis/oauth.js', {
    ...dependencies,
    '../../shared/accountRedirect': { safeAccountRedirect },
    '../lib/appleOAuth': {
      ...appleCrypto,
      getAppleAuthURL: appleStart,
      exchangeAppleCode: appleExchange,
    },
    '../lib/oauth': {
      generateState: () => 'fixture-state',
      getGitHubAuthURL: () => 'https://identity.example.com/github',
      getGoogleAuthURL: () => 'https://identity.example.com/google',
      getGitHubToken: oauthTokens.github,
      getGoogleToken: oauthTokens.google,
      getGitHubUser: async () => ({ id: 'fixture-user' }),
      getGoogleUser: async () => ({ id: 'fixture-user' }),
      issueTokenAndLogin: async (_id, res) => res.cookie('token', 'fixture-session'),
      generateRandomPassword: () => 'random-hashed-password',
    },
  });
  const app = express();
  app.use(express.json(), cookieParser());
  app.get(['/login', '/register'], dependencies['../lib/guestOnly'].redirectSignedIn, (req, res) => {
    res.send(req.query.redirect === 'app' ? 'App confirmation' : 'Guest form');
  });
  app.use('/api/user', router);
  app.use('/api/login', account);
  app.use('/oauth', oauth);
  server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve(listening)));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
}

function load(path, dependencies, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    module,
    Buffer,
    console,
    Date,
    URL,
    ...globals,
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (name.startsWith('../entities/')) return {};
      throw new Error(`Unmocked dependency: ${name}`);
    },
  });
  return module.exports;
}

function entity(rows, columns) {
  return {
    ...Object.fromEntries(columns.map((column) => [column, column.toLowerCase()])),
    columns: columns.map((column) => column.toLowerCase()),
    for() {
      return this;
    },
    async get(columns, where = columns) {
      return [...rows.values()].filter((row) => where.every(([key, value]) => row[key] === value));
    },
    async insert(...entries) {
      const id = ++sequence;
      rows.set(id, { used: 0, id, ...Object.fromEntries(entries) });
    },
    async update(entries, [, id]) {
      Object.assign(rows.get(id), Object.fromEntries(entries));
    },
    async delete([key, value]) {
      for (const [id, row] of rows) if (row[key] === value) rows.delete(id);
    },
  };
}

function post(path, body, webSession = true) {
  return fetch(`${origin}/api/user${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(webSession ? { Cookie: 'token=web-session' } : {}) },
    body: JSON.stringify(body),
  });
}

function accountRequest(method, token) {
  return fetch(`${origin}/api/login`, { method, headers: { Cookie: `token=${token}` } });
}
