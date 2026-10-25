function safeAccountRedirect(value) {
  if (typeof value !== 'string') return '';
  if (value === 'app') return value;
  if (!/^\/(?![/\\])[^\\\r\n\t]*$/.test(value)) return '';
  try {
    const url = new URL(value, 'https://acode.app');
    if (url.pathname.startsWith('//')) return '';
    if (/%(?:2f|5c|3f|23|0[9ad])/i.test(url.pathname)) return '';
    const pathname = decodeURIComponent(url.pathname);
    // App handoff uses a signed-in confirmation screen at this URL, not a login form.
    if (/^\/login\/?$/i.test(pathname) && url.searchParams.getAll('redirect').length === 1 && url.searchParams.get('redirect') === 'app') {
      url.pathname = '/login';
      return `${url.pathname}${url.search}${url.hash}`;
    }
    if (/^\/(?:login|register|logout|change-password|oauth)(?:\/|$)/i.test(pathname)) return '';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '';
  }
}

module.exports = { safeAccountRedirect };
