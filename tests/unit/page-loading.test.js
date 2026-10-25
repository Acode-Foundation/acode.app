import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transformAsync } from '@babel/core';
import Handlebars from 'handlebars';
import { safeAccountRedirect } from '../../client/lib/appSource';
import { isAccountRoute, isAdFreeRoute } from '../../shared/adPolicy';

const root = path.resolve(import.meta.dirname, '../..');
const compiled = new Map();

async function loadClient(file, dependencies, globals = {}) {
  if (!compiled.has(file)) {
    const { code } = await transformAsync(fs.readFileSync(path.join(root, file), 'utf8'), {
      filename: path.join(root, file),
      babelrc: false,
      configFile: false,
      plugins: ['html-tag-js/jsx/syntax-parser.js', 'html-tag-js/jsx/jsx-to-tag.js', '@babel/plugin-transform-modules-commonjs'],
    });
    compiled.set(file, code);
  }
  const exports = {};
  vm.runInNewContext(
    compiled.get(file),
    {
      exports,
      ...globals,
      require(name) {
        if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
        return dependencies[name];
      },
    },
    { filename: file },
  );
  return exports;
}

describe('page startup', () => {
  it.each(['index', 'landing'])('uses consent-gated scripts in the %s template', (name) => {
    const html = Handlebars.compile(fs.readFileSync(path.join(root, `server/${name}.hbs`), 'utf8'))({});
    expect(html).toContain('/consent.min.js');
    expect(html).toContain('/consent.css');
    expect(html).not.toContain('googletagmanager.com/gtag');
    expect(html).not.toContain('adsbygoogle.js');
  });
  it.each(['resolve', 'reject'])('starts routing before window load and before account lookup can %s', async (result) => {
    const document = new EventTarget();
    const window = { location: { pathname: '/' } };
    const Router = { add: vi.fn(), on: vi.fn(), listen: vi.fn() };
    const updateAccountButton = vi.fn();
    const addProButton = vi.fn();
    let finish;
    const getLoggedInUser = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          finish = result === 'resolve' ? resolve : reject;
        }),
    );
    const view = {};
    const app = { get: vi.fn(() => ({})), addEventListener: vi.fn() };
    await loadClient(
      'client/main.js',
      {
        'html-tag-js/dist/polyfill': {},
        'core-js': {},
        './main.scss': {},
        './common.scss': {},
        'res/icons/style.css': {},
        'lib/headerTitle': { setupHeaderTitle: vi.fn() },
        'lib/helpers': { getLoggedInUser, showLoading: vi.fn(), hideLoading: vi.fn() },
        'lib/pageMetadata': { applyRouteMetadata: vi.fn() },
        'lib/Router': Router,
        'lib/theme': vi.fn(),
        'themes/dark': {},
        './main.view': { __esModule: true, default: () => view, updateAccountButton, addProButton },
      },
      {
        document,
        window,
        app,
        tag: (component, props) => component(props),
        process: { env: { RAZORPAY_ENABLED: true } },
        console: { error: vi.fn() },
      },
    );

    expect(Router.listen).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(app.content).toBe(view);
    expect(Router.listen).toHaveBeenCalledOnce();
    expect(Router.add).toHaveBeenCalledWith('/plugin/:id/:section?', expect.any(Function));
    expect(updateAccountButton).not.toHaveBeenCalled();
    expect(window.onload).toBeUndefined();

    const user = { id: 42, acode_pro: true };
    finish(result === 'resolve' ? user : new Error('Network unavailable'));
    await vi.waitFor(() => expect(updateAccountButton).toHaveBeenCalledOnce());
    if (result === 'resolve') {
      expect(updateAccountButton).toHaveBeenCalledWith(user);
      expect(addProButton).toHaveBeenCalledWith(user);
    } else {
      expect(updateAccountButton).toHaveBeenCalledWith();
      expect(addProButton).toHaveBeenCalledWith();
    }
    expect(Router.listen).toHaveBeenCalledOnce();
  });

  it('defers the entry script and discovers the plugin LCP image in the initial HTML', () => {
    const render = Handlebars.compile(fs.readFileSync(path.join(root, 'server/index.hbs'), 'utf8'));
    const html = render({ preload_image: '/plugin-icon/test.plugin' });
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain('<script defer src="/main.min.js"></script>');
    expect(html).toContain('<link rel="preload" as="image" href="/plugin-icon/test.plugin" fetchpriority="high" />');
    expect(render({})).not.toContain('as="image"');
  });
});

it('preserves an existing return path when the header Login link is clicked on registration', async () => {
  const getAccountRedirect = vi.fn();
  const location = new URL('https://acode.app/register?redirect=/plugins');
  const refs = [];
  const view = await loadClient(
    'client/main.view.js',
    {
      './main.scss': {},
      'components/announcementBanner': {},
      'html-tag-js/reactive': (value) => ({ value }),
      'html-tag-js/ref': () => {
        const ref = { el: { replaceWith: vi.fn() } };
        refs.push(ref);
        return ref;
      },
      'lib/appSource': { getAccountRedirect, safeAccountRedirect },
      'lib/helpers': {},
      'res/digitalocean-icon.svg': '',
      'res/logo.svg': '',
      '../shared/adPolicy': {},
    },
    {
      location,
      tag: (...args) => args.find((arg) => arg && typeof arg === 'object' && !Array.isArray(arg)) || {},
    },
  );
  view.updateAccountButton();
  refs[0].el.onclick();
  expect(getAccountRedirect).not.toHaveBeenCalled();
  location.href = 'https://acode.app/plugins?sort=new';
  refs[0].el.onclick();
  expect(getAccountRedirect).toHaveBeenCalledWith('/plugins?sort=new');
});

it('keeps successful website sign-in on-site even when the incoming redirect is malicious', async () => {
  const replace = vi.fn();
  const login = await loadClient(
    'client/pages/login/index.js',
    {
      './style.scss': {},
      'components/ajaxForm': {},
      'components/dialogs/alert': {},
      'components/input': {},
      'components/oauthButton': {},
      'html-tag-js/reactive': (value) => ({ value }),
      'html-tag-js/ref': () => ({}),
      'lib/appSource': { safeAccountRedirect, getAccountRedirect: safeAccountRedirect, clearAccountRedirect: vi.fn() },
      'lib/background': {},
      'lib/helpers': { getLoggedInUser: async () => ({ id: 7 }) },
      'lib/Router': {},
      './appSignIn': {},
    },
    {
      window: { location: { search: '', replace } },
      sessionStorage: { removeItem: vi.fn() },
      URLSearchParams,
      tag: () => ({}),
      setTimeout: (callback) => callback(),
    },
  );
  for (const redirect of ['https://example.com', '/\\example.com', '/register', '/login', '/plugins?editor=cm']) {
    expect(await login.default({ redirect })).toBeNull();
    expect(replace).toHaveBeenLastCalledWith(redirect.startsWith('/plugins') ? redirect : '/');
  }
});

it('ignores a stale registration return path when signing in', async () => {
  const replace = vi.fn();
  const clearAccountRedirect = vi.fn();
  const AjaxForm = {};
  let submit;
  const login = await loadClient(
    'client/pages/login/index.js',
    {
      './style.scss': {},
      'components/ajaxForm': AjaxForm,
      'components/dialogs/alert': {},
      'components/input': {},
      'components/oauthButton': {},
      'html-tag-js/reactive': (value) => ({ value }),
      'html-tag-js/ref': () => ({}),
      'lib/appSource': { safeAccountRedirect, getAccountRedirect: safeAccountRedirect, clearAccountRedirect },
      'lib/background': {},
      'lib/helpers': { getLoggedInUser: async () => null, invalidateLoggedInUser: vi.fn(), withRedirect: (url) => url },
      'lib/Router': {},
      './appSignIn': {},
    },
    {
      window: { location: { search: '', replace } },
      URLSearchParams,

      tag: (component, props) => {
        if (component === AjaxForm) submit = props.onloadend;
        return {};
      },
      setTimeout: (callback) => callback(),
    },
  );
  await login.default({ redirect: '/register' });
  expect(clearAccountRedirect).not.toHaveBeenCalled();
  submit({ message: 'Logged in' });
  expect(clearAccountRedirect).toHaveBeenCalledOnce();
  expect(replace).toHaveBeenCalledWith('/');
});

it('redirects an authenticated registration visitor before building the form', async () => {
  const replace = vi.fn();
  const getLoggedInUser = vi.fn(async () => ({ id: 7 }));
  const render = vi.fn();
  const profile = await loadClient(
    'client/pages/account/index.js',
    {
      './style.scss': {},
      'components/ajaxForm': {},
      'components/dialogs/alert': {},
      'components/input': {},
      'components/oauthButton': {},
      'components/sendOtp': {},
      'html-tag-js/reactive': {},
      'html-tag-js/ref': {},
      'lib/appSource': { safeAccountRedirect, getAccountRedirect: safeAccountRedirect, clearAccountRedirect: vi.fn() },
      'lib/background': {},
      'lib/helpers': { getLoggedInUser, withRedirect: (url, redirect) => `${url}?redirect=${redirect}` },
      'lib/Router': {},
      './deleteAccount': {},
    },
    { window: { location: { replace } }, sessionStorage: { getItem: () => '/register', removeItem: vi.fn() }, tag: render },
  );
  expect(await profile.default({})).toBeNull();
  expect(replace).toHaveBeenLastCalledWith('/');
  expect(getLoggedInUser).toHaveBeenCalledWith({ force: true });
  expect(render).not.toHaveBeenCalled();
  await profile.default({ redirect: 'app' });
  expect(replace).toHaveBeenLastCalledWith('/login?redirect=app');
});

it('still renders registration when the session lookup fails', async () => {
  const AjaxForm = {};
  const form = vi.fn();
  const profile = await loadClient(
    'client/pages/account/index.js',
    {
      './style.scss': {},
      'components/ajaxForm': AjaxForm,
      'components/dialogs/alert': {},
      'components/input': {},
      'components/oauthButton': {},
      'components/sendOtp': {},
      'html-tag-js/reactive': (value) => ({ value }),
      'html-tag-js/ref': () => ({}),
      'lib/appSource': { safeAccountRedirect, getAccountRedirect: safeAccountRedirect },
      'lib/background': {},
      'lib/helpers': {
        getLoggedInUser: async () => {
          throw new Error('Network unavailable');
        },
        withRedirect: (url) => url,
      },
      'lib/Router': {},
      './deleteAccount': {},
    },
    {
      tag: (component, props) => {
        if (component === AjaxForm) form(props);
        return { append: vi.fn() };
      },
    },
  );
  expect(await profile.default({})).toBeTruthy();
  expect(form).toHaveBeenCalledWith(expect.objectContaining({ action: '/api/user', method: 'post' }));
});

describe('ad-free home and account flows', () => {
  const accountPaths = ['/login', '/register', '/change-password', '/api-keys', '/logout', '/profile/edit', '/user/edit', '/oauth/google'];
  const adminPaths = ['/admin', '/admin/', '/ADMIN', '/admin/promotions'];

  it('omits the ad SDK from home and account documents while retaining it on other public pages', () => {
    const render = Handlebars.compile(fs.readFileSync(path.join(root, 'server/index.hbs'), 'utf8'));
    for (const pathname of [...accountPaths, ...adminPaths, '/LOGIN', '/register/', '/', '/index.htm', '/index.html', '/INDEX.HTML/']) {
      expect(isAdFreeRoute(pathname)).toBe(true);
      expect(render({ adsDisabled: isAdFreeRoute(pathname) })).toContain('data-ads-disabled="true"');
    }
    for (const pathname of ['/plugins', '/plugin/example', '/profile/7', '/login-guide', '/index.html-guide', '/administrator']) {
      expect(isAdFreeRoute(pathname)).toBe(false);
      expect(render({ adsDisabled: isAdFreeRoute(pathname) })).toContain('data-ads-disabled="false"');
    }
  });

  it('keeps server-rendered landing pages free of the ad SDK', () => {
    const render = Handlebars.compile(fs.readFileSync(path.join(root, 'server/landing.hbs'), 'utf8'));
    const html = render({});
    expect(html).not.toContain('adsbygoogle');
    const homeLinks = html.match(/<a\b[^>]*href="\/"[^>]*>/g);
    expect(homeLinks).toHaveLength(3);
    for (const link of homeLinks) expect(link).toContain('data-google-vignette="false"');
  });

  it('does not create promotional banners or their rotation timers on account pages', async () => {
    const setProperty = vi.fn();
    const tag = vi.fn();
    const setInterval = vi.fn();
    for (const pathname of accountPaths) {
      const banner = await loadClient(
        'client/components/announcementBanner/index.js',
        { './style.scss': {}, 'res/shellular-logo.png': '', '../../../shared/adPolicy': { isAccountRoute } },
        { location: { pathname }, document: { documentElement: { style: { setProperty } } }, tag, setInterval },
      );
      expect(banner.default()).toBeNull();
    }
    expect(setProperty).toHaveBeenCalledWith('--announcement-height', '0px');
    expect(tag).not.toHaveBeenCalled();
    expect(setInterval).not.toHaveBeenCalled();
    expect(isAccountRoute('/')).toBe(false);
  });

  it.each([
    ['/plugins', '/faqs', '/login?redirect=app&state=StateValue'],
    ['/login', '/register?redirect=app&state=StateValue', '/plugins'],
    ['/', '/index.html', '/plugins'],
    ['/plugins', '/faqs', '/'],
    ['/plugins', '/faqs', '/admin?tab=promotions'],
    ['/admin', '/index.html', '/plugins'],
    ['/', '/index.html', '/login?redirect=app&state=StateValue'],
    ['/login', '/register?redirect=app&state=StateValue', '/'],
  ])('reloads when ad or account policy changes, including history navigation from %s', async (initialPath, samePolicyPath, destination) => {
    const location = new URL(initialPath, 'https://acode.app');
    location.reload = vi.fn();
    const history = {
      pushState: vi.fn((_state, _title, href) => {
        location.href = new URL(href, location.href).href;
      }),
    };
    const router = (
      await loadClient(
        'client/lib/Router.js',
        { './appSource': { withAppSource: (href) => href }, '../../shared/adPolicy': { isAccountRoute, isAdFreeRoute } },
        { location, window: { location, history }, document: { title: 'Acode' }, CustomEvent },
      )
    ).default;
    const render = vi.fn();
    router.add('/plugins', render);
    router.add('/faqs', render);
    router.add('/index.html', render);
    router.add('/register', render);

    router.loadUrl(samePolicyPath);
    expect(render).toHaveBeenCalledOnce();
    expect(location.reload).not.toHaveBeenCalled();

    router.navigate(`${location.pathname}${location.search}#continue`);
    expect(location.reload).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(2);

    router.loadUrl(destination);
    expect(location.pathname + location.search).toBe(destination);
    expect(location.reload).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledTimes(2);

    location.reload.mockClear();
    // popstate invokes navigate() after the browser has changed the URL.
    router.navigate();
    expect(location.reload).toHaveBeenCalledOnce();

    location.reload.mockClear();
    router.setUrl(initialPath);
    expect(location.reload).not.toHaveBeenCalled();
    router.setUrl(destination);
    expect(location.reload).toHaveBeenCalledOnce();
  });

  it('leaves external links to the browser without changing SPA history', async () => {
    const location = new URL('https://acode.app/');
    location.reload = vi.fn();
    const history = { pushState: vi.fn() };
    const router = (
      await loadClient(
        'client/lib/Router.js',
        { './appSource': { withAppSource: (href) => href }, '../../shared/adPolicy': { isAccountRoute, isAdFreeRoute } },
        { location, window: { location, history }, document: { title: 'Acode' }, CustomEvent },
      )
    ).default;
    router.loadUrl('https://example.com/docs');
    expect(location.href).toBe('https://example.com/docs');
    expect(history.pushState).not.toHaveBeenCalled();
  });
});

describe('shared account lookup during page loading', () => {
  let session;
  let fetch;
  let now;

  beforeEach(async () => {
    now = 1000;
    fetch = vi.fn();
    session = await loadClient(
      'client/lib/helpers.js',
      { moment: {}, 'res/user.svg': '', './appSource': { withAccountRedirect: vi.fn() } },
      {
        fetch,
        Date: { now: () => now },
      },
    );
  });

  it('refreshes the cached guest state when entering an authentication page', async () => {
    fetch.mockResolvedValueOnce({ json: async () => ({ error: 'Not logged in' }) });
    expect(await session.getLoggedInUser()).toBeNull();
    fetch.mockResolvedValueOnce({ json: async () => ({ id: 42 }) });
    expect(await session.getLoggedInUser({ force: true })).toEqual({ id: 42 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([{ id: 42 }, { error: 'Not logged in' }])('shares concurrent lookups and briefly caches %j', async (response) => {
    let resolve;
    fetch.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = session.getLoggedInUser();
    const second = session.getLoggedInUser();
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/login');
    resolve({ json: async () => response });
    const expected = response.error ? null : response;
    expect(await first).toEqual(expected);
    expect(await second).toEqual(expected);
    expect(await session.getLoggedInUser()).toEqual(expected);
    expect(fetch).toHaveBeenCalledOnce();

    now += 5001;
    fetch.mockResolvedValue({ json: async () => ({ id: 99 }) });
    expect(await session.getLoggedInUser()).toEqual({ id: 99 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries after a failed lookup', async () => {
    fetch.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ json: async () => ({ id: 42 }) });
    await expect(session.getLoggedInUser()).rejects.toThrow('Offline');
    expect(await session.getLoggedInUser()).toEqual({ id: 42 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not restore a stale user or clear a newer lookup after logout', async () => {
    let resolveOld;
    let resolveNew;
    fetch
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          }),
      );
    const old = session.getLoggedInUser();
    session.invalidateLoggedInUser();
    const current = session.getLoggedInUser();
    resolveOld({ json: async () => ({ id: 1 }) });
    expect(await old).toBeNull();
    const shared = session.getLoggedInUser();
    expect(fetch).toHaveBeenCalledTimes(2);
    resolveNew({ json: async () => ({ id: 2 }) });
    expect(await current).toEqual({ id: 2 });
    expect(await shared).toEqual({ id: 2 });
    session.invalidateLoggedInUser();
    fetch.mockResolvedValue({ json: async () => ({ error: 'Not logged in' }) });
    expect(await session.getLoggedInUser()).toBeNull();
  });
});
