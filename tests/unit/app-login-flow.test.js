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
const verifier = 'ab'.repeat(32);
const state = 'cd'.repeat(24);
const challenge = crypto.createHash('sha256').update(verifier).digest('hex');

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = undefined;
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

it('rejects off-site OAuth return URLs while preserving local paths and app sign-in', async () => {
  await start();
  for (const redirect of ['https://example.com', '//example.com', '/\\example.com', '/\n/example.com']) {
    const response = await fetch(`${origin}/api/oauth/github?redirect=${encodeURIComponent(redirect)}`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('Set-Cookie')).not.toContain('oauth_redirect=');
  }
  for (const redirect of ['/', '/profile/edit?src=ios', 'app']) {
    const response = await fetch(`${origin}/api/oauth/github?redirect=${encodeURIComponent(redirect)}`, { redirect: 'manual' });
    expect(response.headers.get('Set-Cookie')).toContain('oauth_redirect=');
  }
});

async function start() {
  sessions = new Map();
  authCodes = new Map();
  sequence = 0;
  const login = entity(sessions, ['ID', 'TYPE', 'TOKEN', 'USER_ID', 'EXPIRED_AT']);
  const codes = entity(authCodes, ['ID', 'USER_ID', 'CODE', 'STATE', 'CHALLENGE', 'USED', 'APP_VERSION_CODE', 'EXPIRED_AT']);
  codes.markUsed = (id) => {
    const row = authCodes.get(id);
    if (!row || row.used) return false;
    row.used = 1;
    return true;
  };
  codes.cleanupStaleRows = () => {};
  const helpers = {
    getLoginSession: async (req) => (req.cookies?.token === 'web-session' ? { user_id: 7, type: 'web' } : null),
    getWebLoggedInUser: async (req) => (req.cookies?.token === 'web-session' ? { id: 7 } : null),
    getLoggedInUser: async (req) => {
      if (req.cookies?.token === 'web-session') return { id: 7, authType: 'web' };
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
    '../lib/oauth': { generateState: () => 'fixture-state', getGitHubAuthURL: () => 'https://identity.example.com' },
  });
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/user', router);
  app.use('/api/login', account);
  app.use('/api/oauth', oauth);
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
