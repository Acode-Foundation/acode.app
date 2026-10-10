const { createHash } = require('node:crypto');
const vm = require('node:vm');
const aiOAuthCallback = require('../../server/lib/aiOAuthCallback');

const state = 's'.repeat(43);
const callbackUrl = 'acode://ai-agent/oauth/openrouter';

function response() {
  const res = { set: vi.fn(), type: vi.fn(), send: vi.fn() };
  res.type.mockReturnValue(res);
  aiOAuthCallback({}, res);
  const html = res.send.mock.calls[0][0];
  return { res, html, script: html.match(/<script>([\s\S]*?)<\/script>/)[1] };
}

function run(query, blocked = false) {
  const { script } = response();
  const link = { href: callbackUrl };
  const status = { textContent: '' };
  const history = { replaceState: vi.fn() };
  const location = {
    search: `?${query}`,
    pathname: '/ai/oauth/openrouter',
    replace: vi.fn(() => {
      if (blocked) throw new Error('External navigation blocked');
    }),
  };
  vm.runInNewContext(script, {
    URL,
    URLSearchParams,
    document: { getElementById: (id) => (id === 'return' ? link : status) },
    history,
    location,
  });
  expect(history.replaceState).toHaveBeenCalledWith(null, '', location.pathname);
  return { link, status, location };
}

describe('AI OAuth callback', () => {
  it('serves the exact CSP-hashed script with privacy headers', () => {
    const { res, script } = response();
    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.set).toHaveBeenCalledWith({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
      'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it.each(['approved+code&value', '</script><img src=x onerror=alert(1)>', 'x'.repeat(4096)])(
    'returns the authorization code without changing its contents (case %#)',
    (code) => {
      const { link, status, location } = run(new URLSearchParams({ state, code, redirect: 'https://evil.test' }));
      const callback = new URL(link.href);
      expect(`${callback.protocol}//${callback.host}${callback.pathname}`).toBe(callbackUrl);
      expect([...callback.searchParams]).toEqual([
        ['state', state],
        ['code', code],
      ]);
      expect(status.textContent).toBe('Returning to Acode…');
      expect(location.replace).toHaveBeenCalledWith(link.href);
    },
  );

  it.each(['error=access_denied', 'code=approved&error=denied'])('returns a state-bound denial (%s)', (result) => {
    const { link, status, location } = run(`state=${state}&${result}`);
    expect([...new URL(link.href).searchParams]).toEqual([
      ['state', state],
      ['error', 'access_denied'],
    ]);
    expect(status.textContent).toContain('not approved');
    expect(location.replace).toHaveBeenCalledWith(link.href);
  });

  it.each([
    '',
    'code=approved',
    'error=access_denied',
    `state=${state}`,
    'state=short&code=approved',
    `state=${state}&state=${state}&code=approved`,
    `state=${state}&state=${state}&error=denied`,
    `state=${state}&code=one&code=two`,
    `state=${state}&code=`,
    `state=${state}&code=${'x'.repeat(4097)}`,
    `state=${state}&error=one&error=two`,
  ])('rejects incomplete or ambiguous callbacks (case %#)', (query) => {
    const { link, status, location } = run(query);
    expect(link.href).toBe(callbackUrl);
    expect(status.textContent).toContain('incomplete or expired');
    expect(location.replace).not.toHaveBeenCalled();
  });

  it.each([
    { state, code: 'approved+code&value' },
    { state, error: 'access_denied' },
  ])('keeps a usable manual return link when navigation throws (case %#)', (result) => {
    const { link, location } = run(new URLSearchParams(result), true);
    expect(Object.fromEntries(new URL(link.href).searchParams)).toEqual(result);
    expect(location.replace).toHaveBeenCalledWith(link.href);
  });
});
