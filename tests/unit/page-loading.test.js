import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transformAsync } from '@babel/core';
import Handlebars from 'handlebars';
import { JSDOM } from 'jsdom';
import { safeAccountRedirect } from '../../client/lib/appSource';
import { isAccountRoute, isAdFreeRoute } from '../../shared/adPolicy';
import landingPages from '../../shared/landingPages.json';

const root = path.resolve(import.meta.dirname, '../..');
const compiled = new Map();

async function loadClient(file, dependencies, globals = {}) {
  if (!compiled.has(file)) {
    const { code } = await transformAsync(fs.readFileSync(path.join(root, file), 'utf8'), {
      filename: path.join(root, file),
      babelrc: false,
      configFile: false,
      presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
      plugins: ['html-tag-js/jsx/syntax-parser.js', 'html-tag-js/jsx/jsx-to-tag.js'],
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
        if (name.startsWith('components/') && 'components/*' in dependencies) return dependencies['components/*'];
        if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
        return dependencies[name];
      },
    },
    { filename: file },
  );
  return exports;
}

function loadMain(dependencies, globals) {
  return loadClient(
    'client/main.js',
    {
      'html-tag-js/dist/polyfill': {},
      'core-js': {},
      './main.scss': {},
      './common.scss': {},
      'res/icons/style.css': {},
      'lib/headerTitle': { setupHeaderTitle: vi.fn() },
      'lib/theme': vi.fn(),
      'themes/dark': {},
      ...dependencies,
    },
    {
      tag: (component, props) => component(props),
      process: { env: { RAZORPAY_ENABLED: true } },
      console: { error: vi.fn() },
      ...globals,
    },
  );
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
    const window = { location: { pathname: '/', replace: vi.fn() } };
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
    const detail = result === 'reject' ? {} : null;
    const main = { append: vi.fn() };
    const applyRouteMetadata = vi.fn();
    const app = { querySelector: () => detail, get: vi.fn(() => main), addEventListener: vi.fn() };
    await loadMain(
      {
        'lib/helpers': { getLoggedInUser, showLoading: vi.fn(), hideLoading: vi.fn() },
        'lib/pageMetadata': { applyRouteMetadata },
        'lib/Router': Router,
        './main.view': { __esModule: true, default: () => view, updateAccountButton, addProButton },
      },
      { document, window, app },
    );

    expect(Router.listen).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    if (detail) expect(main.append).toHaveBeenCalledWith(detail);
    expect(applyRouteMetadata).toHaveBeenCalledTimes(detail ? 0 : 1);
    Router.add.mock.calls.find(([route]) => route === '/docs/run-python')[1]();
    expect(window.location.replace).toHaveBeenCalledWith('https://docs.acode.app/tutorials/python-language-server');
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

  it.each(['offline', 'server error'])('clears loading when logout supersedes a page load and fails (%s)', async (failure) => {
    const document = new EventTarget();
    const window = { location: { pathname: '/contact' } };
    const main = {};
    const app = { querySelector: () => null, get: () => main, addEventListener: vi.fn() };
    const routes = new Map();
    const contact = vi.fn();
    const helpers = { getLoggedInUser: vi.fn().mockResolvedValue(null), showLoading: vi.fn(), hideLoading: vi.fn(), invalidateLoggedInUser: vi.fn() };
    const fetch = failure === 'offline' ? vi.fn().mockRejectedValue(new Error('Offline')) : vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await loadMain(
      {
        'lib/helpers': helpers,
        'lib/Router': { add: (path, handler) => routes.set(path, handler), listen: vi.fn(), on: vi.fn() },
        'lib/pageMetadata': { applyRouteMetadata: vi.fn() },
        './main.view': { __esModule: true, default: () => main, updateAccountButton: vi.fn(), addProButton: vi.fn() },
        './pages/contact': contact,
      },
      { document, window, app, fetch, tag: (type, props, children) => (typeof type === 'function' ? type(props) : children.join('')) },
    );
    document.dispatchEvent(new Event('DOMContentLoaded'));
    const pending = routes.get('/contact')();
    window.location.pathname = '/logout';
    await Promise.all([pending, routes.get('/logout')()]);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/login', { method: 'DELETE' });
    expect(contact).not.toHaveBeenCalled();
    expect(helpers.hideLoading).toHaveBeenCalledOnce();
    expect(helpers.invalidateLoggedInUser).not.toHaveBeenCalled();
    expect(main.content).toContain('Couldn’t log out');
  });

  it('restores the initial server description when the plugin request fails', async () => {
    const render = Handlebars.compile(fs.readFileSync(path.join(root, 'server/index.hbs'), 'utf8'));
    const html = render({ detail: { icon: '/plugin-icon/example', heading: 'Example', text: 'Offline description' } });
    const { window } = new JSDOM(html, {
      url: 'https://acode.test/plugin/example',
      runScripts: 'dangerously',
      // Exercise routing recovery independently of the fallback for a missing app bundle.
      beforeParse: (window) => {
        window.setTimeout = vi.fn();
      },
    });
    const { document } = window;
    const app = document.querySelector('#app');
    const main = document.createElement('main');
    for (const el of [app, main])
      Object.defineProperty(el, 'content', {
        set(value) {
          el.replaceChildren(value);
        },
      });
    app.get = (selector) => app.querySelector(selector);
    const helpers = { showLoading: vi.fn(), hideLoading: vi.fn(), getLoggedInUser: vi.fn().mockResolvedValue(null) };
    const fetch = vi.fn().mockRejectedValue(new Error('Offline'));
    const excerpt = document.querySelector('.plugin-preview-body');
    expect(excerpt.hidden).toBe(true);
    const { default: router } = await loadClient(
      'client/lib/Router.js',
      {
        '../../shared/adPolicy': { isAdFreeRoute, isAccountRoute },
        '../../shared/landingPages.json': landingPages,
        './appSource': {},
      },
      { document, window, location: window.location, CustomEvent: window.CustomEvent },
    );
    const plugin = await loadClient(
      'client/pages/plugin/index.js',
      {
        './style.scss': {},
        'lib/helpers': helpers,
        'lib/Router': router,
        'lib/pageMetadata': {},
        'lib/relativeTime': {},
        'html-tag-js/ref': {},
        'moment/moment': {},
        '../../../shared/repositoryUrl': {},
        'components/*': {},
      },
      { window, fetch },
    );
    await loadMain(
      {
        './pages/plugin': plugin,
        'lib/helpers': helpers,
        'lib/Router': router,
        'lib/pageMetadata': { applyRouteMetadata: vi.fn() },
        './main.view': { __esModule: true, default: () => main, updateAccountButton: vi.fn(), addProButton: vi.fn() },
      },
      { document, window, app, tag: Object.assign((component, props) => component(props), { get: () => ({ checked: false }) }) },
    );
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/plugin/example');
      expect(main.contains(excerpt)).toBe(true);
      expect(excerpt.hidden).toBe(false);
    });
    window.close();
  });

  it('defers the entry script and discovers the plugin LCP image in the initial HTML', () => {
    const render = Handlebars.compile(fs.readFileSync(path.join(root, 'server/index.hbs'), 'utf8'));
    const html = render({ preload_image: '/plugin-icon/test.plugin' });
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain('<script defer src="/main.min.js"></script>');
    expect(html).toContain('<link rel="preload" as="image" href="/plugin-icon/test.plugin" fetchpriority="high" />');
    expect(render({})).not.toContain('as="image"');
  });

  it('serves readable, escaped detail content before the app starts', () => {
    const render = Handlebars.compile(fs.readFileSync(path.join(root, 'server/index.hbs'), 'utf8'));
    const html = render({ detail: { heading: 'GitHub & Acode', text: 'Use <branch> here.', parentPath: '/plugins', parentLabel: 'All plugins' } });
    expect(html).toContain('<h1>GitHub &amp; Acode</h1>');
    expect(html).toContain('Use &lt;branch&gt; here.');
    expect(html).toContain('<a href="/plugins">All plugins</a>');
    expect(html).not.toContain('Please enable javascript');
  });

  it('shows the plugin skeleton during startup and restores the excerpt if the app never loads', async () => {
    const render = Handlebars.compile(fs.readFileSync(path.join(root, 'server/index.hbs'), 'utf8'));
    const html = render({ detail: { icon: '/plugin-icon/test', heading: 'Test Plugin', text: 'Plugin description' } });
    const withoutScripts = new JSDOM(html);
    expect(withoutScripts.window.document.querySelector('.plugin-preview-body').hidden).toBe(false);
    expect(withoutScripts.window.document.querySelector('.public-detail .plugin-skeleton')).toBeNull();
    withoutScripts.window.close();

    const schedule = vi.fn();
    const { window } = new JSDOM(html, {
      runScripts: 'dangerously',
      beforeParse: (window) => {
        window.setTimeout = schedule;
      },
    });
    const excerpt = window.document.querySelector('.plugin-preview-body');
    expect(excerpt.hidden).toBe(true);
    expect(excerpt.nextElementSibling.className).toBe('plugin-skeleton');
    expect(window.document.querySelector('h1').closest('[hidden]')).toBeNull();
    await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    schedule.mock.calls[0][0]();
    expect(excerpt.hidden).toBe(false);
    window.close();
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

describe('ad-free routes and account flows', () => {
  const accountPaths = ['/login', '/register', '/change-password', '/api-keys', '/logout', '/profile/edit', '/user/edit', '/oauth/google'];
  const adminPaths = ['/admin', '/admin/', '/ADMIN', '/admin/promotions'];
  const companyPaths = ['/policy', '/terms', '/refund', '/about', '/contact'];
  const faqPaths = ['/faqs', '/faqs/', '/FAQS', '/faqs/question-id'];

  it('disables ads on ad-free documents while retaining them on other public pages', () => {
    const render = Handlebars.compile(fs.readFileSync(path.join(root, 'server/index.hbs'), 'utf8'));
    const companyVariants = companyPaths.flatMap((pathname) => [pathname, `${pathname}/`, pathname.toUpperCase()]);
    for (const pathname of [
      ...accountPaths,
      ...adminPaths,
      ...companyVariants,
      ...faqPaths,
      '/LOGIN',
      '/register/',
      '/',
      '/index.htm',
      '/index.html',
      '/INDEX.HTML/',
    ]) {
      expect(isAdFreeRoute(pathname)).toBe(true);
      expect(render({ adsDisabled: isAdFreeRoute(pathname) })).toContain('data-ads-disabled="true"');
    }
    for (const pathname of [
      '/plugins',
      '/plugin/example',
      '/profile/7',
      '/login-guide',
      '/index.html-guide',
      '/administrator',
      '/about-guide',
      '/policy/example',
      '/faqs-guide',
    ]) {
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
    ['/plugins', '/plugin/example', '/login?redirect=app&state=StateValue'],
    ['/login', '/register?redirect=app&state=StateValue', '/plugins'],
    ['/', '/index.html', '/plugins'],
    ['/plugins', '/plugin/example', '/'],
    ['/plugins', '/plugin/example', '/admin?tab=promotions'],
    ['/admin', '/index.html', '/plugins'],
    ['/', '/index.html', '/login?redirect=app&state=StateValue'],
    ['/login', '/register?redirect=app&state=StateValue', '/'],
    ...[...companyPaths, ...faqPaths].flatMap((pathname) => [
      ['/plugins', '/plugin/example', pathname],
      [pathname, '/index.html', '/plugins'],
    ]),
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
        {
          './appSource': { withAppSource: (href) => href },
          '../../shared/adPolicy': { isAccountRoute, isAdFreeRoute },
          '../../shared/landingPages.json': landingPages,
        },
        { location, window: { location, history }, document: { title: 'Acode' }, CustomEvent, URL },
      )
    ).default;
    const render = vi.fn();
    router.add('/plugins', render);
    router.add('/plugin/:id', render);
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

  it.each([
    'https://example.com/docs',
    'https://acode.app/code-editor-ios?src=ios',
    'https://acode.app/git-android',
    '/code-editor-ios?src=ios',
    '/git-android/',
  ])('loads %s as a full document without changing SPA history', async (destination) => {
    const location = { href: 'https://acode.app/', pathname: '/', hostname: 'acode.app', reload: vi.fn() };
    const history = { pushState: vi.fn() };
    const router = (
      await loadClient(
        'client/lib/Router.js',
        {
          './appSource': { withAppSource: (href) => href },
          '../../shared/adPolicy': { isAccountRoute, isAdFreeRoute },
          '../../shared/landingPages.json': landingPages,
        },
        { location, window: { location, history }, document: { title: 'Acode' }, CustomEvent, URL },
      )
    ).default;
    router.loadUrl(destination);
    expect(location.href).toBe(destination);
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
