import { safeAccountRedirect } from '../../shared/accountRedirect';

const sourceKey = 'acode-app-source';

// Retain a safe return destination across refreshes until sign-in completes.
export function getAccountRedirect(value) {
  const fromStorage = value == null;
  if (fromStorage) {
    try {
      value = sessionStorage.getItem('redirect');
    } catch {
      /* Storage is optional for account navigation. */
    }
  }
  let redirect = safeAccountRedirect(value);
  // App handoffs need their URL-bound state and challenge, never a stored fallback.
  const appRedirect = redirect === 'app' || redirect.startsWith('/login?');
  if (fromStorage && appRedirect) redirect = '';
  try {
    if (redirect && !appRedirect) sessionStorage.setItem('redirect', redirect);
    else sessionStorage.removeItem('redirect');
  } catch {
    /* Explicit URL redirects still work when storage is blocked. */
  }
  return redirect;
}

export function clearAccountRedirect() {
  try {
    sessionStorage.removeItem('redirect');
  } catch {
    /* Storage is optional for account navigation. */
  }
}

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
  if (!url.searchParams.has('src')) url.searchParams.set('src', 'ios');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function withAccountRedirect(value, redirect) {
  const url = new URL(withAppSource(value), location.href);
  if (url.origin !== location.origin) return value;
  redirect = safeAccountRedirect(redirect);
  if (redirect) url.searchParams.set('redirect', redirect);
  if (redirect === 'app') {
    const current = new URLSearchParams(location.search);
    for (const key of ['src', 'androidPackage', 'authFlow', 'state', 'challenge', 'appVersionCode']) {
      if (current.has(key) && (key !== 'src' || !url.searchParams.has(key))) url.searchParams.set(key, current.get(key));
    }
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export { safeAccountRedirect };
