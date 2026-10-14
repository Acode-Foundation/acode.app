import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from '@babel/core';

const sources = Object.fromEntries(
  ['client/pages/user/index.js', 'client/components/dialogs/dialogBox.js'].map((file) => [
    file,
    transformSync(fs.readFileSync(file, 'utf8'), {
      configFile: false,
      babelrc: false,
      presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
      plugins: ['html-tag-js/jsx/jsx-to-tag.js', 'html-tag-js/jsx/syntax-parser.js'],
    }).code,
  ]),
);
let alert;
let location;
let user;
let history;

beforeEach(() => {
  alert = vi.fn();
  location = new URL('https://acode.app/profile?linked=apple&tab=owned#account');
  user = { id: 7, name: 'Example User', apple_id: true, github_id: true, google_id: true };
  history = { state: { retained: true }, replaceState: vi.fn() };
});

it.each([
  ['apple', 'Apple'],
  ['github', 'GitHub'],
  ['google', 'Google'],
])('shows the correct %s label and logo and clears only the link feedback', async (provider, label) => {
  location.search = `?linked=${provider}&tab=owned`;
  await profile()({});
  expect(alert).toHaveBeenCalledExactlyOnceWith(
    `${label} account linked`,
    `You can now sign in to Acode with ${label}.`,
    expect.any(Function),
    false,
    { icon: provider, variant: 'success' },
  );
  alert.mock.calls[0][2]();
  expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(history.state, '', '/profile?tab=owned#account');
});

it('does not invent Google success for unknown providers', async () => {
  for (const provider of ['unknown', 'constructor', '__proto__']) {
    location.search = `?linked=${provider}`;
    await profile()({});
  }
  expect(alert).not.toHaveBeenCalled();
});

it('does not show success for an unlinked account or someone else’s profile', async () => {
  user.apple_id = false;
  await profile()({});
  user.apple_id = true;
  await profile()({ userId: 8 });
  expect(alert).not.toHaveBeenCalled();
});

it('renders the success logo, check and Done button while retaining ordinary dialog defaults', () => {
  const DialogBox = load('client/components/dialogs/dialogBox.js', { './style.scss': {}, 'lib/Router': { on: vi.fn() } });
  const success = DialogBox({ title: 'Apple account linked', icon: 'apple', variant: 'success', message: 'Connected', onok: vi.fn() }, []);
  expect(find(success, (node) => node.role === 'dialog')).toMatchObject({
    className: 'dialog-box dialog-box--success',
    'aria-labelledby': 'dialog-title-1',
  });
  expect(find(success, (node) => node.tagName === 'h2').id).toBe('dialog-title-1');
  expect(find(success, (node) => node.role === 'dialog')).not.toHaveProperty('aria-modal');
  expect(find(success, (node) => node.className === 'icon apple')).toBeDefined();
  expect(find(success, (node) => node.className === 'icon check_circle dialog-status')).toBeDefined();
  expect(find(success, (node) => node.tagName === 'button').children).toContain('Done');
  const ordinary = DialogBox({ title: 'Notice', message: 'Information', onok: vi.fn() }, []);
  expect(find(ordinary, (node) => node.role === 'dialog').className).toBe('dialog-box');
  expect(find(ordinary, (node) => node.role === 'dialog')['aria-labelledby']).toBe('dialog-title-2');
  expect(find(ordinary, (node) => node.tagName === 'button').children).toContain('OK');
});

function profile() {
  return load('client/pages/user/index.js', {
    './style.scss': {},
    'components/dialogs/alert': alert,
    'components/dialogs/confirm': vi.fn(),
    'components/dialogs/select': vi.fn(),
    'components/plugins': vi.fn(),
    'components/tabs': vi.fn(),
    'html-tag-js/ref': () => ({ el: { getAll: () => [] } }),
    'lib/appSource': { isIOSSource: () => false },
    'lib/helpers': { getLoggedInUser: async () => user, gravatar: () => '/avatar.svg', showLoading: vi.fn(), hideLoading: vi.fn() },
    'lib/pageMetadata': { beginProfileMetadataRequest: vi.fn(), applyProfileMetadata: vi.fn() },
    'lib/Router': { loadUrl: vi.fn() },
    './dashboard': vi.fn(),
    './pluginManager': vi.fn(),
  });
}

function load(file, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(sources[file], {
    module,
    exports: module.exports,
    tag: element,
    URL,
    URLSearchParams,
    history,
    location,
    window: { location },
    fetch: async (url) => ({
      json: async () => {
        if (url.startsWith('/api/user/payment-methods')) return [];
        if (url.startsWith('/api/user/dashboard')) return { error: 'No dashboard' };
        return { id: 8, name: 'Other User' };
      },
    }),
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
      return dependencies[name];
    },
  });
  return module.exports.default;
}

function element(name, ...args) {
  const props = args.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
  return {
    tagName: name,
    className: args.find((value) => typeof value === 'string'),
    id: args.filter((value) => typeof value === 'string')[1],
    children: (args.find(Array.isArray) || []).flat(Infinity),
    ...props,
    ...props.attr,
  };
}

function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const result = find(child, predicate);
    if (result) return result;
  }
}
