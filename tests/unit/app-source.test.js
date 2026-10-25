import {
  clearAccountRedirect,
  getAccountRedirect,
  isIOSSource,
  safeAccountRedirect,
  withAccountRedirect,
  withAppSource,
} from '../../client/lib/appSource';

let storage;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  });
  setLocation('/login?src=ios&redirect=app&authFlow=app-code&state=StateValue&challenge=ChallengeValue&appVersionCode=1016');
});
afterEach(() => vi.unstubAllGlobals());

it('preserves iOS context across internal navigation and reloads without tagging other sites', () => {
  expect(isIOSSource()).toBe(true);
  expect(withAppSource('/profile/edit')).toBe('/profile/edit?src=ios');
  setLocation('/profile/edit');
  expect(isIOSSource()).toBe(true);
  expect(withAppSource('https://example.com/pro')).toBe('https://example.com/pro');
  expect(withAccountRedirect('https://example.com/return?x=1', 'app')).toBe('https://example.com/return?x=1');
  const androidLink = withAppSource('/login?src=android');
  expect(androidLink).toBe('/login?src=android');
  expect(withAppSource('/login?src=')).toBe('/login?src=');
  setLocation(androidLink);
  expect(isIOSSource()).toBe(false);
  setLocation('/profile/edit');
  expect(withAppSource('/pro')).toBe('/pro');
});

it.each([null, 'com.foxdebug.acode', 'com.foxdebug.acodefree'])(
  'keeps the PKCE flow and app target %s through registration and password reset',
  (androidPackage) => {
    if (androidPackage) setLocation(`${location.pathname}${location.search.replace('src=ios', 'src=android')}&androidPackage=${androidPackage}`);
    for (const page of ['/register', '/change-password?mode=reset']) {
      const target = withAccountRedirect(page, 'app');
      const params = new URL(target, location.href).searchParams;
      expect(Object.fromEntries(params)).toMatchObject({
        src: androidPackage ? 'android' : 'ios',
        redirect: 'app',
        authFlow: 'app-code',
        state: 'StateValue',
        challenge: 'ChallengeValue',
        appVersionCode: '1016',
      });
      setLocation(target);
      const returned = new URL(withAccountRedirect('/login', 'app'), location.href);
      expect(returned.searchParams.get('state')).toBe('StateValue');
      expect(returned.searchParams.get('challenge')).toBe('ChallengeValue');
      expect(returned.searchParams.get('androidPackage')).toBe(androidPackage);
    }
  },
);

it('preserves redirects containing their own queries and does not attach app secrets to account settings', () => {
  const target = new URL(withAccountRedirect('/login', '/profile/edit?src=ios'), location.href);
  expect(target.searchParams.get('redirect')).toBe('/profile/edit?src=ios');
  expect(target.searchParams.has('state')).toBe(false);
  expect(target.searchParams.has('challenge')).toBe(false);
  expect(safeAccountRedirect('/')).toBe('/');
  expect(safeAccountRedirect('/plugins?editor=cm#owned')).toBe('/plugins?editor=cm#owned');
  expect(safeAccountRedirect('app')).toBe('app');
  expect(safeAccountRedirect('/login?redirect=app&src=ios')).toBe('/login?redirect=app&src=ios');
  for (const redirect of ['https://example.com', '//example.com', '/\\example.com', '/\n/example.com', 'javascript:alert(1)']) {
    expect(safeAccountRedirect(redirect)).toBe('');
    expect(new URL(withAccountRedirect('/login', redirect), location.href).searchParams.has('redirect')).toBe(false);
  }
});

it.each([
  '/register',
  '/REGISTER/?redirect=/plugins',
  '/login?redirect=/register',
  '/logout',
  '/change-password?mode=reset',
  '/oauth/google',
  '/%72egister',
  '/plugins/../register',
  '/login%3Fredirect%3Dapp',
  '/%5c%5cevil',
  '/%2f%2fevil.com',
  '/plugins%23other',
  '/plugins/..//evil.com',
  '/plugins/%2e%2e//evil.com',
  '/login?redirect=app&redirect=/plugins',
  '/login?redirect=/plugins&redirect=app',
])('does not return signed-in users to %s', (redirect) => {
  expect(safeAccountRedirect(redirect)).toBe('');
  expect(withAccountRedirect('/login', redirect)).not.toContain('redirect=');
});

it('retains safe account destinations through refreshes and clears stale or completed returns', () => {
  expect(getAccountRedirect('/plugins?sort=new')).toBe('/plugins?sort=new');
  expect(getAccountRedirect()).toBe('/plugins?sort=new');
  clearAccountRedirect();
  expect(storage.has('redirect')).toBe(false);
  storage.set('redirect', '/register');
  expect(getAccountRedirect()).toBe('');
  expect(storage.has('redirect')).toBe(false);
  expect(safeAccountRedirect('/login/?redirect=app&state=abc')).toBe('/login?redirect=app&state=abc');
});

it.each(['app', '/login?redirect=app&state=old-state&challenge=old-challenge'])(
  'keeps %s in explicit navigation only, never a stored fallback',
  (redirect) => {
    expect(getAccountRedirect(redirect)).toBe(redirect);
    expect(storage.has('redirect')).toBe(false);
    expect(getAccountRedirect()).toBe('');
    storage.set('redirect', redirect);
    expect(getAccountRedirect()).toBe('');
    expect(storage.has('redirect')).toBe(false);
  },
);

it('keeps navigation usable and honors an explicit iOS source when storage is blocked', () => {
  vi.stubGlobal('sessionStorage', {
    getItem() {
      throw new Error('Storage blocked');
    },
    setItem() {
      throw new Error('Storage blocked');
    },
    removeItem() {
      throw new Error('Storage blocked');
    },
  });
  expect(getAccountRedirect()).toBe('');
  expect(getAccountRedirect('/plugins')).toBe('/plugins');
  expect(() => clearAccountRedirect()).not.toThrow();
  expect(withAppSource('/profile/edit')).toBe('/profile/edit?src=ios');
  setLocation('/profile/edit');
  expect(isIOSSource()).toBe(false);
  expect(withAppSource('/login')).toBe('/login');
});

function setLocation(path) {
  vi.stubGlobal('location', new URL(path, 'https://acode.app'));
}
