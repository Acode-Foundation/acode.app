// Account flows must stay free of both advertising and promotional banners.
function isAdFreeRoute(pathname) {
  return /^\/(?:login|register|logout|change-password|(?:profile|user)\/edit|oauth(?:\/.*)?)\/?$/i.test(pathname);
}

module.exports = { isAdFreeRoute };
