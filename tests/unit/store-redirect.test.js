const storeRedirect = require('../../server/lib/storeRedirect');

function request({ redirect = 'store', userAgent = '', platform } = {}) {
  const req = {
    query: { redirect },
    get: (name) => ({ 'User-Agent': userAgent, 'Sec-CH-UA-Platform': platform })[name],
  };
  const res = { setHeader: vi.fn(), vary: vi.fn(), redirect: vi.fn() };
  const next = vi.fn();
  storeRedirect(req, res, next);
  return { res, next };
}

it.each([
  { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36' },
  { platform: '"Android"', userAgent: 'Mozilla/5.0' },
])('temporarily redirects Android clients to the fixed Google Play listing: %j', (headers) => {
  const { res, next } = request(headers);
  expect(res.redirect).toHaveBeenCalledWith(302, 'https://play.google.com/store/apps/details?id=com.foxdebug.acodefree');
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  expect(res.vary).toHaveBeenCalledWith('User-Agent');
  expect(res.vary).toHaveBeenCalledWith('Sec-CH-UA-Platform');
  expect(next).not.toHaveBeenCalled();
});

it.each([
  { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
  { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' },
  { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  {},
  { platform: '"Linux"', userAgent: 'Android' },
])('ignores clients without an available store: %j', (headers) => {
  const { res, next } = request(headers);
  expect(next).toHaveBeenCalledOnce();
  expect(res.redirect).not.toHaveBeenCalled();
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
});

it.each([undefined, '', 'other', 'https://example.com', ['store', 'store']])('requires the exact query value %j', (redirect) => {
  const { res, next } = request({ redirect: redirect === undefined ? null : redirect, userAgent: 'Android' });
  expect(next).toHaveBeenCalledOnce();
  expect(res.redirect).not.toHaveBeenCalled();
  expect(res.setHeader).not.toHaveBeenCalled();
});
