import fs from 'node:fs';
import vm from 'node:vm';
import express, { Router } from 'express';

let users;
let User;
let login;
let AppAuthCode;
let consumeEmailCode;
let server;
let base;

beforeEach(async () => {
  users = new Map([['dev@example.com', { id: 7, password: 'old-hash' }]]);
  User = {
    ID: 'id',
    EMAIL: 'email',
    PASSWORD: 'password',
    get: vi.fn(async (_columns, [, email]) => (users.has(email) ? [{ id: users.get(email).id }] : [])),
    update: vi.fn(async () => {}),
  };
  login = { USER_ID: 'user_id', delete: vi.fn(async () => {}) };
  AppAuthCode = { USER_ID: 'user_id', delete: vi.fn(async () => {}) };
  consumeEmailCode = vi.fn(() => true);

  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../../server/apis/password.js', import.meta.url), 'utf8'), {
    module,
    console: { error: () => {} },
    require: (name) =>
      ({
        express: { Router },
        '../entities/user': User,
        '../entities/login': login,
        '../entities/appAuthCode': AppAuthCode,
        '../lib/emailCode': { consumeEmailCode: (...args) => consumeEmailCode(...args) },
        '../lib/helpers': { getWebLoggedInUser: async () => null },
        '../lib/rateLimits': { emailCodeCheckLimiter: (_req, _res, next) => next() },
        '../password': {
          comparePassword: () => false,
          encryptPassword: (p) => `hash:${p}`,
          isValidPassword: (p) => typeof p === 'string' && p.length >= 8,
        },
      })[name],
  });

  const app = express();
  app.use(express.json());
  app.use('/api/password', module.exports);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/password/reset`;
});

afterEach(() => server.close());

function reset(body) {
  return fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (res) => ({
    status: res.status,
    body: await res.json(),
  }));
}

it('changes the password with a valid code, signs out every session and drops pending app codes', async () => {
  const res = await reset({ email: 'dev@example.com', otp: '123456', password: 'new-password' });

  expect(res.status).toBe(200);
  expect(consumeEmailCode).toHaveBeenCalledWith('dev@example.com', 'reset', '123456');
  expect(User.update).toHaveBeenCalledWith(['password', 'hash:new-password'], ['id', 7]);
  expect(login.delete).toHaveBeenCalledWith(['user_id', 7]);
  expect(AppAuthCode.delete).toHaveBeenCalledWith(['user_id', 7]);
});

it('gives the same answer for a wrong code and an unknown email', async () => {
  consumeEmailCode.mockReturnValue(false);
  const wrongCode = await reset({ email: 'dev@example.com', otp: '000000', password: 'new-password' });
  const unknown = await reset({ email: 'nobody@example.com', otp: '123456', password: 'new-password' });

  expect(wrongCode).toEqual({ status: 400, body: { error: 'Invalid or expired OTP' } });
  expect(unknown).toEqual(wrongCode);
  expect(User.update).not.toHaveBeenCalled();
  expect(login.delete).not.toHaveBeenCalled();
  expect(AppAuthCode.delete).not.toHaveBeenCalled();
});

it('checks the request before spending an attempt on the code', async () => {
  expect((await reset({ email: 'dev@example.com', password: 'new-password' })).status).toBe(400);
  expect((await reset({ email: 'dev@example.com', otp: '123456', password: 'short' })).status).toBe(400);
  expect((await reset({ email: ['dev@example.com'], otp: '123456', password: 'new-password' })).status).toBe(400);
  expect(consumeEmailCode).not.toHaveBeenCalled();
});
