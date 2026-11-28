import fs from 'node:fs';
import vm from 'node:vm';
import * as rateLimit from 'express-rate-limit';
import * as pluginBadge from '../../server/lib/pluginBadge';

const module = { exports: {} };
const getLoginSession = vi.fn(async () => null);
const getApiKeyAuth = vi.fn(async () => null);
vm.runInNewContext(fs.readFileSync(new URL('../../server/lib/rateLimits.js', import.meta.url), 'utf8'), {
  module,
  process: { env: {} },
  require(name) {
    if (name === 'express-rate-limit') return rateLimit;
    if (name === './pluginBadge') return pluginBadge;
    if (name === './helpers') return { getLoginSession };
    if (name === './apiKeyAuth') return { getApiKeyAuth };
    throw new Error(`Unmocked dependency: ${name}`);
  },
});

it.each([
  ['promotion', module.exports.promotionRedirectLimiter, 120],
  ['OAuth callback', module.exports.createOAuthCallbackLimiter((_req, res) => res.status(429).send({ error: 'Rate limited' })), 120],
  ['plugin stats', module.exports.pluginStatsLimiter, 600],
  ['OG images', module.exports.ogImageLimiter, 600],
  ['sponsor registration', module.exports.sponsorRegisterLimiter, 20],
])('limits %s requests without session lookups or header-based bypasses', async (_label, limiter, limit) => {
  const downstream = vi.fn();
  const send = async (ip, headers = {}, method = 'GET', extension = 'svg') => {
    const statsPath = extension ? `/test.plugin/rating.${extension}` : '/test.plugin';
    const req = {
      ip,
      method,
      headers,
      path: _label === 'plugin stats' ? statsPath : '/',
      cookies: { token: headers.authorization },
    };
    const res = {
      setHeader: vi.fn(),
      set: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      append: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const next = vi.fn((error) => {
      if (!error) downstream();
    });
    await limiter(req, res, next);
    if (next.mock.calls.length) expect(next).toHaveBeenCalledWith();
    return { res, next };
  };
  for (let i = 0; i < limit; i++) {
    const { next } = await send('203.0.113.50', { authorization: `Bearer token-${i}` });
    expect(next).toHaveBeenCalledOnce();
  }
  for (const [headers, method, extension] of [
    [{ authorization: 'Bearer different-token' }, 'GET'],
    [{ 'sec-purpose': 'prefetch' }, 'GET'],
    [{ 'user-agent': 'Googlebot' }, 'GET'],
    [{}, 'HEAD'],
    [{}, 'GET', 'SVG'],
    [{}, 'GET', null],
  ]) {
    const { res, next } = await send('203.0.113.50', headers, method, extension);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    if (_label === 'plugin stats' && extension !== null) {
      expect(res.type).toHaveBeenCalledWith('image/svg+xml');
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('<title>Acode Plugin: rate limited</title>'));
    } else if (_label === 'plugin stats') {
      expect(res.send).toHaveBeenCalledWith({ error: 'Too many requests, please try again later.' });
      expect(res.type).not.toHaveBeenCalled();
    }
    expect(next).not.toHaveBeenCalled();
  }
  expect(downstream).toHaveBeenCalledTimes(limit);
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
