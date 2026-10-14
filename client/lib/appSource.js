import { safeAccountRedirect } from '../../shared/accountRedirect';

const sourceKey = 'acode-app-source';

// Presentation only: never use this flag to authorize account access or purchases.
export function isIOSSource() {
  const source = new URLSearchParams(location.search).get('src');
  try {
    if (source !== null) sessionStorage.setItem(sourceKey, source === 'ios' ? 'ios' : '');
    return source === null ? sessionStorage.getItem(sourceKey) === 'ios' : source === 'ios';
  } catch {
    return source === 'ios';
  }
}

export function withAppSource(value) {
  const url = new URL(value, location.href);
  if (url.origin !== location.origin || !isIOSSource()) return value;
  url.searchParams.set('src', 'ios');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function withAccountRedirect(value, redirect) {
  const url = new URL(withAppSource(value), location.href);
  if (url.origin !== location.origin) return value;
  redirect = safeAccountRedirect(redirect);
  if (redirect) url.searchParams.set('redirect', redirect);
  if (redirect === 'app') {
    const current = new URLSearchParams(location.search);
    for (const key of ['authFlow', 'state', 'challenge', 'appVersionCode']) {
      if (current.has(key)) url.searchParams.set(key, current.get(key));
    }
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export { safeAccountRedirect };
