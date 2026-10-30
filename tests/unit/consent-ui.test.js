import fs from 'node:fs';
import vm from 'node:vm';
import { transformAsync } from '@babel/core';
import * as consent from '../../client/lib/cookieConsent';
import { isAdFreeRoute } from '../../shared/adPolicy';

const { code } = await transformAsync(fs.readFileSync(new URL('../../client/consent.js', import.meta.url), 'utf8'), {
  babelrc: false,
  configFile: false,
  plugins: ['@babel/plugin-transform-modules-commonjs'],
});

function mount(pathname = '/plugins') {
  const nodes = new Map();
  const document = {
    currentScript: { dataset: { adsDisabled: 'false' } },
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  };
  function node() {
    return {
      hidden: false,
      isConnected: true,
      dataset: {},
      listeners: {},
      setAttribute: vi.fn(),
      append: vi.fn(),
      addEventListener(type, fn) {
        this.listeners[type] = fn;
      },
      querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, node());
        return nodes.get(selector);
      },
      focus: vi.fn(function () {
        document.activeElement = this;
      }),
      contains: () => false,
    };
  }
  document.createElement = vi.fn(node);
  document.body = node();
  document.head = node();
  document.documentElement = { classList: { toggle: vi.fn() } };
  const stored = new Map();
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  };
  const win = {
    localStorage: storage,
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  };
  const location = { pathname, reload: vi.fn() };
  let controller;
  const dependencies = {
    './consent.scss': {},
    '../shared/adPolicy': { isAdFreeRoute },
    './lib/adUnits': { observeAdUnits: vi.fn() },
    './lib/cookieConsent': {
      ...consent,
      suppressVignettes: vi.fn(),
      suppressAdIntents: vi.fn(),
      createConsentController(options) {
        controller = consent.createConsentController({ ...options, win });
        return controller;
      },
    },
  };
  vm.runInNewContext(code, { require: (name) => dependencies[name], document, window: win, location });
  const panel = document.body.append.mock.calls[0][0];
  const click = (choice) => panel.listeners.click({ target: { closest: () => ({ dataset: { choice } }) } });
  return {
    document,
    win,
    storage,
    location,
    panel,
    nodes,
    click,
    node,
    get controller() {
      return controller;
    },
  };
}

it('loads both permitted scripts from the entry point and hides the panel after acceptance', () => {
  const ui = mount();
  expect(ui.document.head.append).not.toHaveBeenCalled();
  ui.click('accept');
  expect(ui.document.head.append.mock.calls.map(([script]) => script.src)).toEqual([
    expect.stringContaining('googletagmanager.com'),
    expect.stringContaining('adsbygoogle.js'),
  ]);
  expect(ui.panel.hidden).toBe(true);
});

it.each(['/admin', '/policy', '/terms', '/refund', '/about', '/contact'])(
  'preserves site-wide advertising choice without loading ads on %s',
  (pathname) => {
    const ui = mount(pathname);
    ui.click('accept');
    expect(ui.document.head.append.mock.calls.map(([script]) => script.src)).toEqual([expect.stringContaining('googletagmanager.com')]);
    expect(ui.controller.getChoice().advertising).toBe(true);
  },
);

it('reopens settings from the footer and restores focus on Escape without changing consent', () => {
  const ui = mount();
  ui.click('reject');
  const opener = ui.node();
  opener.focus();
  ui.document.listeners.click({ target: { closest: () => opener } });
  expect(ui.panel.hidden).toBe(false);
  expect(ui.document.activeElement).toBe(ui.nodes.get('[name="analytics"]'));
  const preventDefault = vi.fn();
  ui.panel.listeners.keydown({ key: 'Escape', preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(ui.panel.hidden).toBe(true);
  expect(ui.document.activeElement).toBe(opener);
  expect(ui.controller.getChoice().advertising).toBe(false);
});

it('exposes Google privacy settings only when its API is ready', () => {
  const ui = mount();
  ui.win.googlefc.showRevocationMessage = vi.fn();
  ui.win.googlefc.callbackQueue[0].CONSENT_API_READY();
  const button = ui.nodes.get('[data-google-privacy]');
  expect(button.hidden).toBe(false);
  button.onclick();
  expect(ui.win.googlefc.showRevocationMessage).toHaveBeenCalledOnce();
});

it.each(['cancel', 'Escape'])('allows %s after a persistence failure while keeping optional services off', (action) => {
  const ui = mount();
  ui.click('accept');
  const opener = ui.node();
  opener.focus();
  const openSettings = () => ui.document.listeners.click({ target: { closest: () => opener } });
  openSettings();
  ui.storage.setItem = () => {
    throw Error('blocked');
  };
  ui.storage.removeItem = () => {
    throw Error('blocked');
  };
  ui.click('reject');
  const status = ui.nodes.get('[data-consent-status]');
  expect(status.hidden).toBe(false);
  expect(status.textContent).toContain('could not save');
  if (action === 'Escape') ui.panel.listeners.keydown({ key: 'Escape', preventDefault: vi.fn() });
  else ui.click(action);
  expect(ui.panel.hidden).toBe(true);
  expect(ui.document.activeElement).toBe(opener);
  expect(ui.location.reload).not.toHaveBeenCalled();
  expect(ui.controller.getChoice()).toMatchObject({ analytics: false, advertising: false });
  expect(ui.win[`ga-disable-${consent.GA_ID}`]).toBe(true);
  openSettings();
  expect(ui.panel.hidden).toBe(false);
  expect(status.hidden).toBe(false);
  expect(ui.nodes.get('[name="advertising"]').checked).toBe(false);
});

it('shows a reload notice for cross-tab ad withdrawal without reloading a form', () => {
  const ui = mount();
  ui.click('accept');
  ui.storage.removeItem(consent.CONSENT_KEY);
  ui.win.listeners.storage({ key: consent.CONSENT_KEY, storageArea: ui.storage });
  expect(ui.location.reload).not.toHaveBeenCalled();
  expect(ui.nodes.get('[data-consent-reload]').hidden).toBe(false);
  expect(ui.nodes.get('[data-consent-status]').textContent).toContain('Save any unfinished work');
});
