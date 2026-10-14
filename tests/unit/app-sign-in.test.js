import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import { withAccountRedirect } from '../../client/lib/appSource';

const user = { id: 7, name: 'Alex Morgan', email: 'alex@example.com', github: 'alex-fixture' };
const query = '?redirect=app&src=ios&authFlow=app-code&state=StateValue&challenge=ChallengeValue&appVersionCode=1017';
const sources = Object.fromEntries(
  ['index', 'appSignIn'].map((name) => [
    name,
    transformSync(fs.readFileSync(new URL(`../../client/pages/login/${name}.js`, import.meta.url), 'utf8'), {
      configFile: false,
      babelrc: false,
      presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
      plugins: ['html-tag-js/jsx/jsx-to-tag.js', 'html-tag-js/jsx/syntax-parser.js'],
    }).code,
  ]),
);

let request;
let replace;
let helpers;

beforeEach(() => {
  const location = new URL(`https://dev.acode.app/login${query}`);
  replace = vi.fn();
  location.replace = replace;
  vi.stubGlobal('location', location);
  vi.stubGlobal('window', { location });
  const storage = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  });
  request = vi.fn(async () => Response.json(user));
  vi.stubGlobal('fetch', request);
  helpers = {
    gravatar: (github) => `https://avatars.githubusercontent.com/${github}`,
    getLoggedInUser: vi.fn(async () => user),
    invalidateLoggedInUser: vi.fn(),
    withRedirect: withAccountRedirect,
    loadingStart: vi.fn(),
    loadingEnd: vi.fn(),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(['', 'Sign-in was cancelled. Please try again.'])(
  'shows OAuth feedback %s and waits for confirmation with an existing session',
  async (message) => {
    if (message) location.search += `&error=${encodeURIComponent(message)}`;
    const page = await load('index', { './appSignIn': load('appSignIn') })({ redirect: 'app' });
    expect(find(page, (node) => node.role === 'alert').children.find((child) => typeof child === 'object').value).toBe(message);
    expect(request).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  },
);

it('returns a fresh email sign-in to confirmation while preserving app and OAuth context', async () => {
  helpers.getLoggedInUser.mockResolvedValue(null);
  const page = await load('index')({ redirect: 'app' });
  const form = find(page, (node) => node.tagName === 'form');
  const oauth = find(page, (node) => node.provider === 'google');
  expect(new URL(oauth.redirectUrl, location.href).searchParams.get('challenge')).toBe('ChallengeValue');
  form.onloadend({ message: 'Logged in' });
  expect(helpers.invalidateLoggedInUser).toHaveBeenCalledOnce();
  expect(replace).toHaveBeenCalledOnce();
  expect(new URL(replace.mock.calls[0][0], location.href).search).toContain('redirect=app');
  expect(replace.mock.calls[0][0]).toContain('state=StateValue');
  expect(request).not.toHaveBeenCalled();
});

it.each([
  ['app-code', null],
  ['legacy', null],
  ['app-code', 'com.foxdebug.acode'],
  ['app-code', 'com.foxdebug.acodefree'],
])('issues %s credentials for %s only on Continue, blocking competing clicks', async (flow, androidPackage) => {
  if (flow === 'legacy') location.search = '?redirect=app';
  if (androidPackage) location.search = `${query.replace('src=ios', 'src=android')}&androidPackage=${androidPackage}`;
  let finish;
  request.mockResolvedValueOnce(Response.json(user)).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const page = load('appSignIn')({ user });
  const form = find(page, (node) => node.tagName === 'form');
  const switchButton = find(page, (node) => node.className === 'switch-account');
  expect(request).not.toHaveBeenCalled();
  const pending = form.onsubmit({ preventDefault() {} });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await form.onsubmit({ preventDefault() {} });
  await switchButton.onclick();
  expect(switchButton.disabled).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
  if (flow === 'app-code') {
    expect(request.mock.calls[1][0]).toBe('/api/user/app-auth-code');
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ state: 'StateValue', challenge: 'ChallengeValue', appVersionCode: '1017' });
  } else expect(request.mock.calls[1][0]).toBe('/api/user/app-token');
  finish(Response.json(flow === 'app-code' ? { code: 'fixture-code' } : { token: 'fixture-token' }));
  await pending;
  const callback = androidPackage
    ? `intent://auth/callback?code=fixture-code&state=StateValue#Intent;scheme=acode;package=${androidPackage};end`
    : 'acode://auth/callback?code=fixture-code&state=StateValue';
  expect(replace).toHaveBeenCalledWith(flow === 'app-code' ? callback : 'acode://user/login/fixture-token');
});

it('rejects an unrecognized Android target before issuing a code', async () => {
  location.search = `${query}&androidPackage=${encodeURIComponent('com.foxdebug.acode;component=other.app/.Activity')}`;
  const page = load('appSignIn')({ user });
  await find(page, (node) => node.tagName === 'form').onsubmit({ preventDefault() {} });
  expect(request).toHaveBeenCalledOnce();
  expect(replace).not.toHaveBeenCalled();
  expect(find(page, (node) => node.role === 'alert').children.find((child) => typeof child === 'object').value).toContain('unsupported app');
});

it('switches accounts without issuing app credentials or losing the pending request', async () => {
  location.search = `${query.replace('src=ios', 'src=android')}&androidPackage=com.foxdebug.acodefree`;
  request.mockResolvedValue(Response.json({ message: 'Logged out' }));
  const page = load('appSignIn')({ user });
  await find(page, (node) => node.className === 'switch-account').onclick();
  expect(request).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith('/api/login', expect.objectContaining({ method: 'DELETE' }));
  expect(helpers.invalidateLoggedInUser).toHaveBeenCalledOnce();
  const returned = new URL(replace.mock.calls[0][0], location.href);
  expect(Object.fromEntries(returned.searchParams)).toEqual(Object.fromEntries(new URLSearchParams(location.search)));
});

it.each([Response.json({ id: 8 }), Response.json({ error: 'Signed out' }, { status: 401 })])(
  'requires confirmation again when the displayed session has changed or expired',
  async (response) => {
    request.mockResolvedValue(response);
    const page = load('appSignIn')({ user });
    await find(page, (node) => node.tagName === 'form').onsubmit({ preventDefault() {} });
    expect(request).toHaveBeenCalledOnce();
    expect(replace.mock.calls[0][0]).toMatch(/^\/login\?/);
  },
);

it('shows rate-limit feedback and enables retry after a failed handoff', async () => {
  request.mockResolvedValueOnce(Response.json(user)).mockResolvedValueOnce(Response.json({}, { status: 429, headers: { 'Retry-After': '120' } }));
  const page = load('appSignIn')({ user });
  const form = find(page, (node) => node.tagName === 'form');
  await form.onsubmit({ preventDefault() {} });
  expect(find(page, (node) => node.role === 'alert').children.find((child) => typeof child === 'object').value).toContain('2 minutes');
  expect(find(page, (node) => node.type === 'submit').disabled).toBe(false);
  expect(replace).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(Response.json(user)).mockResolvedValueOnce(Response.json({ code: 'retry-code' }));
  await form.onsubmit({ preventDefault() {} });
  expect(replace).toHaveBeenCalledWith('acode://auth/callback?code=retry-code&state=StateValue');
});

it('does not pretend to sign out after a network failure and bounds stalled requests', async () => {
  vi.useFakeTimers();
  request.mockImplementation(
    (...[, options]) =>
      new Promise((...[, reject]) => {
        options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
      }),
  );
  const page = load('appSignIn')({ user });
  const pending = find(page, (node) => node.className === 'switch-account').onclick();
  await vi.advanceTimersByTimeAsync(15_000);
  await pending;
  expect(find(page, (node) => node.role === 'alert').children.find((child) => typeof child === 'object').value).toContain('took too long');
  expect(find(page, (node) => node.type === 'submit').disabled).toBe(false);
  expect(helpers.invalidateLoggedInUser).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});

it('does not launch the app after the user leaves the confirmation page', async () => {
  let finish;
  request.mockResolvedValueOnce(Response.json(user)).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const page = load('appSignIn')({ user });
  const pending = find(page, (node) => node.tagName === 'form').onsubmit({ preventDefault() {} });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  page.isConnected = false;
  finish(Response.json({ code: 'fixture-code' }));
  await pending;
  expect(replace).not.toHaveBeenCalled();
});

function load(name, overrides = {}) {
  const module = { exports: {} };
  const dependencies = {
    './style.scss': {},
    'html-tag-js/reactive': (value) => ({ value }),
    'html-tag-js/ref': () => ({}),
    'lib/helpers': helpers,
    'lib/appSource': require('../../shared/accountRedirect'),
    'lib/background': () => {},
    'lib/Router': {},
    'res/logo.svg': '/logo.svg',
    './appSignIn': () => element('confirmation'),
    'components/ajaxForm': (props, children) => element('form', props, children),
    'components/input': (props) => element('input', props),
    'components/oauthButton': (props) => element('oauth', props),
    'components/dialogs/alert': vi.fn(),
    ...overrides,
  };
  vm.runInNewContext(sources[name], {
    module,
    exports: module.exports,
    tag: element,
    window,
    location,
    sessionStorage,
    fetch: request,
    URL,
    URLSearchParams,
    AbortController,
    Error,
    TypeError,
    setTimeout,
    clearTimeout,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
      return dependencies[name];
    },
  });
  return module.exports.default;
}

function element(name, ...args) {
  const children = args.find(Array.isArray) || [];
  const props = args.find((value) => typeof value === 'object' && !Array.isArray(value)) || {};
  if (typeof name === 'function') return name(props, children);
  const node = {
    tagName: name,
    className: args.find((value) => typeof value === 'string'),
    children,
    ...props,
    isConnected: true,
    setAttribute: vi.fn(),
  };
  if (props.ref) props.ref.el = node;
  return node;
}

function find(node, predicate) {
  if (!node) return;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    if (typeof child !== 'object') continue;
    const match = find(child, predicate);
    if (match) return match;
  }
}
