/**
 * Returns the plugin repository URL only when it is http(s), so `javascript:` and other schemes never become links.
 * @param {unknown} value
 * @returns {string}
 */
function safeRepositoryUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    /* Invalid URLs are not linked. */
  }
  return '';
}

module.exports = { safeRepositoryUrl };
