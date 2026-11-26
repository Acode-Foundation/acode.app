// Account flows also omit the site's own promotional banners and upgrade button.
function isAccountRoute(pathname) {
  return /^\/(?:login|register|logout|change-password|api-keys|(?:profile|user)\/edit|add-payment-method(?:\/[^/]*)?|oauth(?:\/.*)?)\/?$/i.test(
    pathname,
  );
}

// The sponsors page shows sponsors only: no Google ads and no promotional banner.
function isPromotionFreeRoute(pathname) {
  return /^\/sponsors\/?$/i.test(pathname) || isAccountRoute(pathname);
}

function isAdFreeRoute(pathname) {
  // Router reloads across this boundary so an already-loaded ad SDK cannot run on ad-free pages.
  return (
    /^\/(?:index\.html?\/?)?$/i.test(pathname) ||
    /^\/(?:policy|terms|refund|about|contact)\/?$/i.test(pathname) ||
    /^\/(?:admin|faqs)(?:\/|$)/i.test(pathname) ||
    isPromotionFreeRoute(pathname)
  );
}

module.exports = { isAccountRoute, isAdFreeRoute, isPromotionFreeRoute };
