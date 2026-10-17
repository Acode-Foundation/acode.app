import crypto from 'node:crypto';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import { Router } from 'express';

const require = createRequire(import.meta.url);
const apiKeyLib = require('../../server/lib/apiKey');
const { generateApiKey, isWellFormedApiKey, hashApiKey, displayPrefix, getBearerToken, parseKeySpec, digestKeySpec, SCOPE_PLUGIN_PUBLISH } =
  apiKeyLib;

const validSpec = { name: 'CI', scopes: [SCOPE_PLUGIN_PUBLISH], pluginIds: ['acode.plugin'], lifetimeDays: 30 };

describe('API key format', () => {
  it('generates prefixed, checksummed keys that are unique', () => {
    const keys = new Set(Array.from({ length: 200 }, generateApiKey));
    expect(keys.size).toBe(200);
    for (const key of keys) {
      expect(key).toMatch(/^acode_[0-9A-Za-z]{42}$/);
      expect(isWellFormedApiKey(key)).toBe(true);
    }
  });

  it('rejects keys with a broken checksum or wrong shape', () => {
    const key = generateApiKey();
    const flipped = key.slice(0, 10) + (key[10] === 'a' ? 'b' : 'a') + key.slice(11);
    for (const bad of [flipped, key.slice(0, -1), `${key}x`, key.replace('acode_', 'acodf_'), '', null, 42]) {
      expect(isWellFormedApiKey(bad)).toBe(false);
    }
  });

  it('stores only a hash and shows only a short prefix', () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(crypto.createHash('sha256').update(key).digest('hex'));
    expect(displayPrefix(key)).toBe(key.slice(0, 10));
    expect(key.length - displayPrefix(key).length).toBeGreaterThan(30);
  });

  it('reads keys only from a bearer Authorization header', () => {
    expect(getBearerToken({ headers: {} })).toBeNull();
    expect(getBearerToken({ headers: { authorization: 'Basic abc' } })).toBeNull();
    expect(getBearerToken({ headers: { authorization: 'Bearer acode_x' } })).toBe('acode_x');
    expect(getBearerToken({ headers: { authorization: 'bearer   acode_x ' } })).toBe('acode_x');
    expect(getBearerToken({ headers: { authorization: 'Bearer' } })).toBe('');
    expect(getBearerToken({ headers: { authorization: 'Bearer a b' } })).toBe('');
    expect(getBearerToken({ headers: { authorization: 'Bearerx' } })).toBeNull();
  });

  it('parses hostile Authorization headers in linear time', () => {
    const started = performance.now();
    expect(getBearerToken({ headers: { authorization: `bearer\t${'\t'.repeat(100_000)}x` } })).toBe('x');
    expect(getBearerToken({ headers: { authorization: `Bearer ${' \t'.repeat(100_000)}` } })).toBe('');
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('API key spec', () => {
  it('requires a name, a known scope, at least one plugin and a bounded expiry', () => {
    expect(parseKeySpec(validSpec).spec).toBeTruthy();
    for (const patch of [
      { name: '  ' },
      { name: 'x'.repeat(61) },
      { name: 'bad\nname' },
      { scopes: [] },
      { scopes: ['account:admin'] },
      { scopes: ['__proto__'] },
      { pluginIds: [] },
      { pluginIds: [1] },
      { lifetimeDays: 0 },
      { lifetimeDays: 366 },
      { lifetimeDays: null },
      { lifetimeDays: '30' },
    ]) {
      expect(parseKeySpec({ ...validSpec, ...patch }).error, JSON.stringify(patch)).toBeTruthy();
    }
  });

  it('only asks for plugins when a permission acts on plugins', () => {
    const createOnly = { ...validSpec, scopes: [apiKeyLib.SCOPE_PLUGIN_CREATE] };
    expect(parseKeySpec({ ...createOnly, pluginIds: [] }).spec.pluginIds).toEqual([]);
    expect(parseKeySpec(createOnly).spec.pluginIds).toEqual([]);
    expect(parseKeySpec({ ...validSpec, scopes: [SCOPE_PLUGIN_PUBLISH, apiKeyLib.SCOPE_PLUGIN_CREATE], pluginIds: [] }).error).toBeTruthy();
  });

  it('normalizes plugins so the same request always digests the same way', () => {
    const a = parseKeySpec({ ...validSpec, pluginIds: ['B.plugin', 'a.plugin', 'b.plugin'] }).spec;
    const b = parseKeySpec({ ...validSpec, pluginIds: ['a.plugin', 'b.plugin'] }).spec;
    expect(a.pluginIds).toEqual(['a.plugin', 'b.plugin']);
    expect(digestKeySpec(a)).toBe(digestKeySpec(b));
    expect(digestKeySpec(a)).not.toBe(digestKeySpec({ ...b, lifetimeDays: 90 }));
  });
});

describe('API key authentication and management', () => {
  let db;
  let ApiKey;
  let user;
  let users;
  let sendEmail;
  let router;
  let getApiKeyAuth;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE user (id INTEGER PRIMARY KEY); INSERT INTO user VALUES (7), (8);
      CREATE TABLE otp (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, otp TEXT NOT NULL, created_at TEXT);
    `);
    ApiKey = loadApiKeyEntity(db);
    user = { id: 7, name: 'Dev', email: 'dev@example.com', role: 'user' };
    users = new Map([[7, { ...user }]]);
    sendEmail = vi.fn();

    const User = {
      ID: 'id',
      ROLE_DELETED: 'deleted',
      safeColumns: [],
      get: vi.fn(async (_columns, [, id]) => (users.has(id) ? [{ ...users.get(id) }] : [])),
    };
    const Otp = {
      EMAIL: 'email',
      OTP: 'otp',
      CREATED_AT: 'created_at',
      for() {
        return this;
      },
      // Backed by the same database the entity consumes codes from.
      get: vi.fn(async ([, key]) => db.prepare('SELECT * FROM otp WHERE email = ?').all(key)),
      insert: vi.fn(async (...values) => {
        const row = Object.fromEntries(values);
        db.prepare('INSERT INTO otp (email, otp, created_at) VALUES (?, ?, ?)').run(row.email, row.otp, row.created_at);
      }),
      update: vi.fn(async (values, [, key]) => {
        const row = Object.fromEntries(values);
        db.prepare('UPDATE otp SET otp = ?, created_at = ? WHERE email = ?').run(row.otp, row.created_at, key);
      }),
      delete: vi.fn(async ([[, key], [, otp]]) => db.prepare('DELETE FROM otp WHERE email = ? AND otp = ?').run(key, otp)),
    };
    const Plugin = {
      ID: 'id',
      NAME: 'name',
      USER_ID: 'user_id',
      STATUS: 'status',
      STATUS_DELETED: 3,
      for() {
        return this;
      },
      get: vi.fn(async (_columns, [[, userId]]) =>
        userId === 7
          ? [
              { id: 'acode.plugin', name: 'Acode Plugin' },
              { id: 'other.plugin', name: 'Other Plugin' },
            ]
          : [],
      ),
    };

    getApiKeyAuth = runModule('../../server/lib/apiKeyAuth.js', {
      '../entities/apiKey': ApiKey,
      '../entities/user': User,
      './apiKey': apiKeyLib,
    }).getApiKeyAuth;

    const pass = (_req, _res, next) => next();
    router = runModule('../../server/apis/apiKey.js', {
      express: { Router },
      'node:crypto': crypto,
      '../entities/apiKey': ApiKey,
      '../entities/otp': Otp,
      '../entities/plugin': Plugin,
      '../lib/helpers': { getWebLoggedInUser: async () => user, getToken: (req) => req.cookies.token },
      '../lib/apiKey': apiKeyLib,
      '../lib/rateLimits': { apiKeyCodeLimiter: pass, apiKeyCreateLimiter: pass },
      '../lib/sendEmail': sendEmail,
    });
  });

  afterEach(() => db.close());

  it('creates a key only with an emailed code bound to the exact settings', async () => {
    expect((await request('post', '/confirmation-code', validSpec)).statusCode).toBe(200);
    expect(sendEmail.mock.calls[0][0]).toBe('dev@example.com');
    expect(sendEmail.mock.calls[0][3]).toContain('Acode Plugin');
    const code = getCode();

    // A code approved for one plugin can't mint a key for another, or for longer.
    expect((await request('post', '/', { ...validSpec, pluginIds: ['other.plugin'], code })).statusCode).toBe(400);
    expect((await request('post', '/', { ...validSpec, lifetimeDays: 365, code })).statusCode).toBe(400);
    expect((await request('post', '/', { ...validSpec, code }, { token: 'other-session' })).statusCode).toBe(400);

    const created = await request('post', '/', { ...validSpec, code });
    expect(created.statusCode).toBe(200);
    expect(created.headers['Cache-Control']).toBe('no-store');
    expect(isWellFormedApiKey(created.body.token)).toBe(true);
    expect(created.body.key).toMatchObject({ name: 'CI', pluginIds: ['acode.plugin'], scopes: [SCOPE_PLUGIN_PUBLISH], expired: false });
    expect(Date.parse(created.body.key.expiresAt) - Date.now()).toBeGreaterThan(29 * 86400_000);

    // Single use.
    expect((await request('post', '/', { ...validSpec, code })).statusCode).toBe(400);

    // The secret is not stored or listed.
    const stored = db.prepare('SELECT * FROM api_key').get();
    expect(stored.token_hash).toBe(hashApiKey(created.body.token));
    expect(JSON.stringify(stored)).not.toContain(created.body.token);
    const listed = await request('get', '/');
    expect(JSON.stringify(listed.body)).not.toContain(created.body.token);
    expect(JSON.stringify(listed.body)).not.toContain(stored.token_hash);
  });

  it('mints one key from one code even when requests race', async () => {
    await request('post', '/confirmation-code', validSpec);
    const code = getCode();
    const responses = await Promise.all(Array.from({ length: 5 }, () => request('post', '/', { ...validSpec, code })));
    expect(responses.map((res) => res.statusCode).sort()).toEqual([200, 400, 400, 400, 400]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM api_key').get().count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM otp').get().count).toBe(0);
  });

  it('keeps the code when the key limit is hit so it can be used after revoking one', async () => {
    await request('post', '/confirmation-code', validSpec);
    const code = getCode();
    for (let i = 0; i < apiKeyLib.MAX_ACTIVE_KEYS; i++) insertKey({ name: `k${i}` });
    const limited = await request('post', '/', { ...validSpec, code });
    expect(limited.statusCode).toBe(400);
    expect(limited.body.error).toMatch(/at most/);
    expect(db.prepare('SELECT COUNT(*) AS count FROM otp').get().count).toBe(1);

    const [oldest] = ApiKey.listForUser(7);
    ApiKey.revoke(oldest.id, 7);
    expect((await request('post', '/', { ...validSpec, code })).statusCode).toBe(200);
  });

  it('marks the key list uncacheable', async () => {
    expect((await request('get', '/')).headers['Cache-Control']).toBe('no-store');
  });

  it('rejects plugins the user does not own', async () => {
    const res = await request('post', '/confirmation-code', { ...validSpec, pluginIds: ['someone.else'] });
    expect(res.statusCode).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('never lets an API key or a signed-out request manage keys', async () => {
    const token = await createKey();
    expect((await request('get', '/', {}, { authorization: `Bearer ${token}` })).statusCode).toBe(403);
    user = null;
    expect((await request('get', '/')).statusCode).toBe(401);
  });

  it('caps active keys per user', async () => {
    for (let i = 0; i < apiKeyLib.MAX_ACTIVE_KEYS; i++) insertKey({ name: `k${i}` });
    expect((await request('post', '/confirmation-code', validSpec)).statusCode).toBe(400);
  });

  it('revokes only the owner’s keys', async () => {
    const token = await createKey();
    const [{ id }] = ApiKey.listForUser(7);
    user = { id: 8, name: 'Other', email: 'o@example.com', role: 'user' };
    expect((await request('delete', '/:id', {}, { params: { id: String(id) } })).statusCode).toBe(404);
    expect((await getApiKeyAuth(bearer(token))).key).toBeTruthy();
    user = { id: 7, name: 'Dev', email: 'dev@example.com', role: 'user' };
    expect((await request('delete', '/:id', {}, { params: { id: String(id) } })).statusCode).toBe(200);
    expect(await getApiKeyAuth(bearer(token))).toMatchObject({ status: 401 });
  });

  it('authenticates valid keys as a non-admin principal and records use', async () => {
    users.set(7, { ...user, role: 'admin', isAdmin: true });
    const token = await createKey();
    const auth = await getApiKeyAuth(bearer(token));
    expect(auth.user).toMatchObject({ id: 7, authType: 'api_key' });
    expect(auth.user.isAdmin).toBe(false);
    expect(auth.user.role).toBe('user');
    expect(auth.key.plugin_ids).toEqual(['acode.plugin']);
    expect(ApiKey.listForUser(7)[0].last_used_at).toBeTruthy();
  });

  it('rejects missing, malformed, unknown, expired and orphaned keys', async () => {
    expect(await getApiKeyAuth({ headers: {} })).toBeNull();
    expect(await getApiKeyAuth(bearer('nope'))).toMatchObject({ status: 401 });
    expect(await getApiKeyAuth(bearer(generateApiKey()))).toMatchObject({ status: 401 });

    const expired = generateApiKey();
    insertKey({ token: expired, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await getApiKeyAuth(bearer(expired))).toMatchObject({ status: 401, error: expect.stringContaining('expired') });

    const token = await createKey();
    users.set(7, { ...user, role: 'deleted' });
    expect(await getApiKeyAuth(bearer(token))).toMatchObject({ status: 401 });
  });

  async function createKey() {
    db.exec('DELETE FROM otp');
    await request('post', '/confirmation-code', validSpec);
    return (await request('post', '/', { ...validSpec, code: getCode() })).body.token;
  }

  function insertKey({ name = 'k', token = generateApiKey(), expiresAt = new Date(Date.now() + 86400_000).toISOString() } = {}) {
    ApiKey.createWithinLimit(
      {
        userId: 7,
        name,
        tokenHash: hashApiKey(token),
        tokenPrefix: displayPrefix(token),
        scopes: [SCOPE_PLUGIN_PUBLISH],
        pluginIds: ['acode.plugin'],
        createdAt: new Date().toISOString(),
        expiresAt,
      },
      Number.POSITIVE_INFINITY,
    );
  }

  function getCode() {
    return sendEmail.mock.calls.at(-1)[3].match(/<strong>(\d{6})<\/strong>/)[1];
  }

  async function request(method, path, body = {}, { token = 'web-session', authorization, params = {} } = {}) {
    const req = { body, params, cookies: { token }, headers: authorization ? { authorization } : {} };
    const res = {
      statusCode: 200,
      finished: false,
      headers: {},
      set(name, value) {
        this.headers[name] = value;
        return this;
      },
      status(value) {
        this.statusCode = value;
        return this;
      },
      send(value) {
        this.body = value;
        this.finished = true;
        return this;
      },
    };
    for (const layer of router.stack) {
      if (res.finished) break;
      if (!layer.route) await layer.handle(req, res, () => {});
      else if (layer.route.path === path && layer.route.methods[method]) {
        for (const handler of layer.route.stack) {
          if (res.finished) break;
          await handler.handle(req, res, () => {});
        }
      }
    }
    return res;
  }
});

function bearer(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}

function runModule(relativePath, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
    module,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unmocked import: ${name}`);
      return dependencies[name];
    },
    console,
    Date,
    Buffer,
    Number,
  });
  return module.exports;
}

function loadApiKeyEntity(db) {
  const entityPath = require.resolve('../../server/entities/entity');
  const apiKeyPath = require.resolve('../../server/entities/apiKey');
  delete require.cache[entityPath];
  delete require.cache[apiKeyPath];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === '../lib/db' && (parent?.filename === entityPath || parent?.filename === apiKeyPath)) return db;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(apiKeyPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[entityPath];
    delete require.cache[apiKeyPath];
  }
}
