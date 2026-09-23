import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transformAsync } from '@babel/core';
import Handlebars from 'handlebars';

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
        'lib/adUnits': { observeAdUnits: vi.fn() },
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

describe('shared account lookup during page loading', () => {
  let session;
  let fetch;
  let now;

  beforeEach(async () => {
    now = 1000;
    fetch = vi.fn();
    session = await loadClient(
      'client/lib/helpers.js',
      { moment: {}, 'res/user.svg': '' },
      {
        fetch,
        Date: { now: () => now },
      },
    );
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
