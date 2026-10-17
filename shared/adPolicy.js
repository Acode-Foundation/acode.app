// Account flows also omit the site's own promotional banners and upgrade button.
function isAccountRoute(pathname) {
  return /^\/(?:login|register|logout|change-password|(?:profile|user)\/edit|oauth(?:\/.*)?)\/?$/i.test(pathname);
}

function isAdFreeRoute(pathname) {
  return /^\/(?:index\.html?\/?)?$/i.test(pathname) || isAccountRoute(pathname);
}

module.exports = { isAccountRoute, isAdFreeRoute };
