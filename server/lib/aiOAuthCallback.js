const { createHash } = require('node:crypto');

const script = `
const link = document.getElementById('return');
const status = document.getElementById('status');
const query = new URLSearchParams(location.search);
const states = query.getAll('state');
const codes = query.getAll('code');
const errors = query.getAll('error');
const validState = states.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(states[0]);
const validCode = codes.length === 1 && codes[0].length > 0 && codes[0].length <= 4096;
const callback = new URL('acode://ai-agent/oauth/openrouter');
history.replaceState(null, '', location.pathname);
if (validState && ((validCode && errors.length === 0) || errors.length === 1)) {
  callback.searchParams.set('state', states[0]);
  if (errors.length === 1) callback.searchParams.set('error', 'access_denied');
  else callback.searchParams.set('code', codes[0]);
  link.href = callback.href;
  status.textContent = errors.length ? 'Sign-in was not approved. Return to Acode to try again.' : 'Returning to Acode…';
  try { location.replace(callback.href); } catch {}
} else {
  status.textContent = 'This sign-in link is incomplete or expired. Return to Acode and start sign-in again.';
}
`;
const scriptHash = createHash('sha256').update(script).digest('base64');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Return to Acode</title>
<style>body{margin:0;padding:24px;min-height:100vh;box-sizing:border-box;display:grid;place-items:center;background:#101216;color:#f0f2f5;font:16px/1.5 system-ui}main{width:min(100%,420px)}h1{font-size:24px}a{display:block;margin-top:24px;padding:14px 20px;border-radius:12px;background:#69a2ff;color:#081426;text-align:center;font-weight:650;text-decoration:none}small{display:block;margin-top:16px;color:#adb4be}</style>
</head><body><main><h1>Return to Acode</h1><p id="status">Completing OpenRouter sign-in…</p>
<a id="return" href="acode://ai-agent/oauth/openrouter">Return to Acode</a>
<small>If Acode does not open automatically, tap the button.</small>
<noscript>JavaScript is required to complete sign-in. Enable it and try again.</noscript>
</main><script>${script}</script></body></html>`;

module.exports = function aiOAuthCallback(_req, res) {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
    'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.type('html').send(html);
};
