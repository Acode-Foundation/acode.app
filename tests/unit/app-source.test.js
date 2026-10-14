import { isIOSSource, safeAccountRedirect, withAccountRedirect, withAppSource } from '../../client/lib/appSource';

let storage;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) });
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
  setLocation('/login?src=android');
  expect(isIOSSource()).toBe(false);
});

it('keeps the PKCE flow intact through registration, password reset and return to login', () => {
  for (const page of ['/register', '/change-password?mode=reset']) {
    const target = withAccountRedirect(page, 'app');
    const params = new URL(target, location.href).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({
      src: 'ios',
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
  }
});

it('preserves redirects containing their own queries and does not attach app secrets to account settings', () => {
  const target = new URL(withAccountRedirect('/login', '/profile/edit?src=ios'), location.href);
  expect(target.searchParams.get('redirect')).toBe('/profile/edit?src=ios');
  expect(target.searchParams.has('state')).toBe(false);
  expect(target.searchParams.has('challenge')).toBe(false);
  expect(safeAccountRedirect('/')).toBe('/');
  expect(safeAccountRedirect('/plugins?editor=cm#owned')).toBe('/plugins?editor=cm#owned');
  expect(safeAccountRedirect('app')).toBe('app');
  for (const redirect of ['https://example.com', '//example.com', '/\\example.com', '/\n/example.com', 'javascript:alert(1)']) {
    expect(safeAccountRedirect(redirect)).toBe('');
    expect(new URL(withAccountRedirect('/login', redirect), location.href).searchParams.has('redirect')).toBe(false);
  }
});

it('keeps navigation usable and honors an explicit iOS source when storage is blocked', () => {
  vi.stubGlobal('sessionStorage', {
    getItem() {
      throw new Error('Storage blocked');
    },
    setItem() {
      throw new Error('Storage blocked');
    },
  });
  expect(withAppSource('/profile/edit')).toBe('/profile/edit?src=ios');
  setLocation('/profile/edit');
  expect(isIOSSource()).toBe(false);
  expect(withAppSource('/login')).toBe('/login');
});

function setLocation(path) {
  vi.stubGlobal('location', new URL(path, 'https://acode.app'));
}
