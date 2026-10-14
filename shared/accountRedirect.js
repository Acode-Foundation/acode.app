function safeAccountRedirect(value) {
  if (typeof value !== 'string') return '';
  return value === 'app' || /^\/(?![/\\])[^\\\r\n\t]*$/.test(value) ? value : '';
}

module.exports = { safeAccountRedirect };
