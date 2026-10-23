import fs from 'node:fs';
import vm from 'node:vm';
import * as rateLimit from 'express-rate-limit';

const module = { exports: {} };
const getLoginSession = vi.fn(async () => null);
const getApiKeyAuth = vi.fn(async () => null);
vm.runInNewContext(fs.readFileSync(new URL('../../server/lib/rateLimits.js', import.meta.url), 'utf8'), {
  module,
  process: { env: {} },
  require(name) {
    if (name === 'express-rate-limit') return rateLimit;
    if (name === './helpers') return { getLoginSession };
    if (name === './apiKeyAuth') return { getApiKeyAuth };
    throw new Error(`Unmocked dependency: ${name}`);
  },
});

it('limits promotion requests without session lookups or header-based bypasses', async () => {
  const downstream = vi.fn();
  const send = async (ip, headers = {}, method = 'GET') => {
    const req = { ip, method, headers, cookies: { token: headers.authorization } };
    const res = { setHeader: vi.fn(), append: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() };
    const next = vi.fn((error) => {
      if (!error) downstream();
    });
    await module.exports.promotionRedirectLimiter(req, res, next);
    if (next.mock.calls.length) expect(next).toHaveBeenCalledWith();
    return { res, next };
  };
  for (let i = 0; i < 120; i++) {
    const { next } = await send('203.0.113.50', { authorization: `Bearer token-${i}` });
    expect(next).toHaveBeenCalledOnce();
  }
  for (const [headers, method] of [
    [{ authorization: 'Bearer different-token' }, 'GET'],
    [{ 'sec-purpose': 'prefetch' }, 'GET'],
    [{ 'user-agent': 'Googlebot' }, 'GET'],
    [{}, 'HEAD'],
  ]) {
    const { res, next } = await send('203.0.113.50', headers, method);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(next).not.toHaveBeenCalled();
  }
  expect(downstream).toHaveBeenCalledTimes(120);
  const other = await send('203.0.113.51');
  expect(other.next).toHaveBeenCalledOnce();
  expect(getLoginSession).not.toHaveBeenCalled();
  expect(getApiKeyAuth).not.toHaveBeenCalled();
});
const { createUserOrIpKey } = module.exports;

describe('rate limit keys', () => {
  const sessions = { valid: { user_id: 42 } };
  const keyFor = createUserOrIpKey(async (req) => sessions[req.cookies?.token] || null);

  it('keys signed-in requests by account, not by token', async () => {
    expect(await keyFor({ cookies: { token: 'valid' }, ip: '203.0.113.5' })).toBe('user:42');
  });

  it('falls back to the IP for unknown or missing tokens', async () => {
    const forged = await Promise.all(['forged-1', 'forged-2', undefined].map((token) => keyFor({ cookies: { token }, ip: '203.0.113.5' })));
    expect(new Set(forged).size).toBe(1);
    expect(forged[0]).not.toMatch(/^user:/);
  });

  it('groups IPv6 clients by subnet', async () => {
    const a = await keyFor({ cookies: {}, ip: '2001:db8:abcd:12::1' });
    const b = await keyFor({ cookies: {}, ip: '2001:db8:abcd:12::ffff' });
    expect(a).toBe(b);
  });

  it('treats a failing session lookup as anonymous', async () => {
    const failing = createUserOrIpKey(() => Promise.reject(new Error('db busy')));
    expect(await failing({ cookies: { token: 'valid' }, ip: '203.0.113.5' })).not.toMatch(/^user:/);
  });
});
