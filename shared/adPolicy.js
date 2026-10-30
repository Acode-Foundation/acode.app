// Account flows also omit the site's own promotional banners and upgrade button.
function isAccountRoute(pathname) {
  return /^\/(?:login|register|logout|change-password|api-keys|(?:profile|user)\/edit|oauth(?:\/.*)?)\/?$/i.test(pathname);
}

function isAdFreeRoute(pathname) {
  // Router reloads across this boundary so an already-loaded ad SDK cannot run on ad-free pages.
  return (
    /^\/(?:index\.html?\/?)?$/i.test(pathname) ||
    /^\/(?:policy|terms|refund|about|contact)\/?$/i.test(pathname) ||
    /^\/admin(?:\/|$)/i.test(pathname) ||
    isAccountRoute(pathname)
  );
}

module.exports = { isAccountRoute, isAdFreeRoute };
