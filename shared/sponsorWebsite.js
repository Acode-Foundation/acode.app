const { safeRepositoryUrl } = require('./repositoryUrl');

function safeSponsorWebsite(value) {
  if (typeof value !== 'string') return '';
  const website = value.trim();
  if (!website || website.includes('\\') || [...website].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return '';
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(website);
  // A dotted hostname or localhost followed by a numeric port is not a URL scheme.
  const host = /^([^:/?#@\s]+):\d+(?=[/?#]|$)/.exec(website)?.[1];
  const hasHostPort = host && (host.toLowerCase() === 'localhost' || host.slice(1, -1).includes('.'));
  let candidate = hasScheme && !hasHostPort ? website : `https://${website}`;
  if (website.startsWith('//')) candidate = `https:${website}`;
  const normalized = safeRepositoryUrl(candidate);
  if (!normalized) return '';
  const url = new URL(normalized);
  return url.username || url.password ? '' : normalized;
}

module.exports = { safeSponsorWebsite };
