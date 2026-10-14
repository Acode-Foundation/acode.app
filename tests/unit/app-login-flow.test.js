import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import cookieParser from 'cookie-parser';
import express from 'express';
import * as rateLimit from 'express-rate-limit';
import moment from 'moment';
import { safeAccountRedirect } from '../../shared/accountRedirect';

let server;
let origin;
let sessions;
let authCodes;
let sequence;
let oauthTokens;
const verifier = 'ab'.repeat(32);
const state = 'cd'.repeat(24);
const challenge = crypto.createHash('sha256').update(verifier).digest('hex');

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = undefined;
  vi.restoreAllMocks();
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

async function start() {
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
  const webUsers = { 'web-session': 7, 'other-web-session': 8 };
  const helpers = {
    getLoginSession: async (req) => (webUsers[req.cookies?.token] ? { user_id: webUsers[req.cookies.token], type: 'web' } : null),
    getWebLoggedInUser: async (req) => (webUsers[req.cookies?.token] ? { id: webUsers[req.cookies.token] } : null),
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
    },
    { process: { env: {} } },
  );
  const dependencies = {
    express,
    moment,
    'node:crypto': crypto,
    '../password': {},
    '../lib/helpers': helpers,
    '../entities/login': login,
    '../entities/appAuthCode': codes,
    '../lib/rateLimits': limits,
    '../lib/calcEarnings': {},
    '../lib/developerDashboard': {},
    '../../constants.mjs': {},
  };
  const router = load('../../server/apis/user.js', dependencies);
  const account = load('../../server/apis/login.js', dependencies);
  const oauth = load('../../server/apis/oauth.js', {
    ...dependencies,
    '../../shared/accountRedirect': { safeAccountRedirect },
    '../entities/user': {
      for() {
        return this;
      },
      get: async () => [{ id: 8 }],
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
    },
  });
  const app = express();
  app.use(express.json(), cookieParser());
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
