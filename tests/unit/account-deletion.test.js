import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { Router } from 'express';

let user;
let rows;
let Otp;
let User;
let sendEmail;
let router;

beforeEach(() => {
  user = { id: 7, name: 'Reviewer', email: 'reviewer@example.com', role: 'user' };
  rows = new Map();
  Otp = {
    EMAIL: 'email',
    OTP: 'otp',
    CREATED_AT: 'created_at',
    for() {
      return this;
    },
    get: vi.fn(async ([, key]) => (rows.has(key) ? [rows.get(key)] : [])),
    insert: vi.fn(async (...values) => {
      const row = Object.fromEntries(values);
      if (rows.has(row.email)) throw Object.assign(new Error('Duplicate OTP key'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
      rows.set(row.email, row);
    }),
    update: vi.fn(async (values, [, key]) => rows.set(key, { ...rows.get(key), ...Object.fromEntries(values) })),
    delete: vi.fn(async ([[, key]]) => rows.delete(key)),
  };
  User = {
    ID: 'id',
    delete: vi.fn(async () => {
      rows.clear();
    }),
  };
  sendEmail = vi.fn();
  const dependencies = {
    express: { Router },
    'node:crypto': crypto,
    '../entities/user': User,
    '../entities/otp': Otp,
    '../lib/helpers': { getWebLoggedInUser: async () => user, getToken: (req) => req.cookies.token },
    '../lib/rateLimits': { accountDeletionCodeLimiter: (_req, _res, next) => next(), accountDeletionLimiter: (_req, _res, next) => next() },
    '../lib/sendEmail': sendEmail,
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../../server/apis/account.js', import.meta.url), 'utf8'), {
    module,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unmocked import: ${name}`);
      return dependencies[name];
    },
    Date,
    Buffer,
  });
  router = module.exports;
});

it('emails only the authenticated account, stores a hash and deletes only that account after confirmation', async () => {
  const sent = await request('post', '/deletion-code', { email: 'attacker@example.com' });
  expect(sent.statusCode).toBe(200);
  const otp = getCode();
  expect(sendEmail.mock.calls[0][0]).toBe(user.email);
  expect([...rows.values()][0].otp).not.toBe(otp);
  expect(User.delete).not.toHaveBeenCalled();
  const deleted = await request('delete', '/', { otp, userId: 99 });
  expect(deleted.statusCode).toBe(200);
  expect(User.delete).toHaveBeenCalledExactlyOnceWith(['id', 7]);
  expect(deleted.clearCookie).toHaveBeenCalledWith('token');
  expect((await request('delete', '/', { otp })).statusCode).toBe(400);
});

it('rejects unrequested, incorrect, expired and cross-session codes', async () => {
  expect((await request('delete', '/', { otp: '123456' })).statusCode).toBe(400);
  await request('post', '/deletion-code');
  const otp = getCode();
  expect((await request('delete', '/', { otp: '000000' })).statusCode).toBe(400);
  expect((await request('delete', '/', { otp }, 'other-session')).statusCode).toBe(400);
  [...rows.values()][0].created_at = new Date(Date.now() - 600_001).toISOString();
  expect((await request('delete', '/', { otp })).statusCode).toBe(400);
  expect(User.delete).not.toHaveBeenCalled();
});

it('enforces resend cooldown and invalidates a code when email delivery fails', async () => {
  await request('post', '/deletion-code');
  expect((await request('post', '/deletion-code')).statusCode).toBe(429);
  expect(sendEmail).toHaveBeenCalledOnce();
  rows.clear();
  sendEmail.mockRejectedValue(new Error('offline'));
  expect((await request('post', '/deletion-code')).statusCode).toBe(500);
  expect(rows.size).toBe(0);
});

it('keeps the first code and sends one email when concurrent requests race to insert', async () => {
  const responses = await Promise.all([request('post', '/deletion-code'), request('post', '/deletion-code')]);
  expect(responses.map((res) => res.statusCode).sort()).toEqual([200, 429]);
  expect(sendEmail).toHaveBeenCalledOnce();
  expect((await request('delete', '/', { otp: getCode() })).statusCode).toBe(200);
});

it.each([null, { role: 'deleted' }, { role: 'admin', isAdmin: true }])('blocks unauthenticated, deleted and admin accounts (%j)', async (account) => {
  user = account;
  expect([401, 403]).toContain((await request('post', '/deletion-code')).statusCode);
  expect(sendEmail).not.toHaveBeenCalled();
  expect(User.delete).not.toHaveBeenCalled();
});

async function request(method, path, body = {}, token = 'web-session') {
  const req = { body, cookies: { token } };
  const res = {
    statusCode: 200,
    finished: false,
    clearCookie: vi.fn(),
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

function getCode() {
  return sendEmail.mock.calls.at(-1)[3].match(/<strong>(\d{6})<\/strong>/)[1];
}
