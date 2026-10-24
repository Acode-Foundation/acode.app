import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from '@babel/core';

const { code } = transformSync(fs.readFileSync(new URL('../../client/components/tabs/index.js', import.meta.url), 'utf8'), {
  configFile: false,
  babelrc: false,
  presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
  plugins: ['html-tag-js/jsx/jsx-to-tag.js', 'html-tag-js/jsx/syntax-parser.js'],
});

let direction;
let resize;
let observe;
let fontsLoaded;
let Tabs;

beforeEach(() => {
  vi.useFakeTimers();
  direction = 'row';
  observe = vi.fn();
  const module = { exports: {} };
  const dependencies = {
    './style.scss': {},
    'html-tag-js/reactive': (value) => ({ value }),
    'html-tag-js/ref': () => ({ el: { append: vi.fn() } }),
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
      return dependencies[name];
    },
    tag: element,
    setTimeout,
    getComputedStyle: () => ({ flexDirection: direction }),
    document: {
      fonts: {
        ready: new Promise((resolve) => {
          fontsLoaded = resolve;
        }),
      },
    },
    ResizeObserver: class {
      constructor(callback) {
        resize = callback;
      }
      observe = observe;
    },
  });
  Tabs = module.exports.default;
});

afterEach(() => vi.useRealTimers());

it.each(['pill', 'underline'])('sets the initial %s orientation before content finishes loading', async (variant) => {
  direction = 'column';
  const wrapper = await Tabs({ variant, tabs: [{ id: 'pending', label: 'Pending', content: new Promise(() => {}) }] });
  await vi.runAllTimersAsync();
  const nav = wrapper.querySelector('.tabs-nav');
  expect(nav['aria-orientation']).toBe('vertical');
  expect(observe).toHaveBeenCalledWith(nav);
});

it.each(['pill', 'underline'])('tracks %s container layout changes in both directions', async (variant) => {
  const wrapper = await Tabs({ variant, tabs: [{ id: 'dashboard', label: 'Dashboard' }] });
  await vi.runAllTimersAsync();
  const nav = wrapper.querySelector('.tabs-nav');
  expect(nav['aria-orientation']).toBe('horizontal');
  direction = 'column';
  resize();
  expect(nav['aria-orientation']).toBe('vertical');
  direction = 'row';
  resize();
  expect(nav['aria-orientation']).toBe('horizontal');
});

it('keeps the pill indicator aligned after resizing and font loading', async () => {
  const wrapper = await Tabs({ tabs: [{ id: 'settings', label: 'Settings' }] });
  await vi.runAllTimersAsync();
  const button = wrapper.querySelector('.tab-btn');
  const indicator = wrapper.querySelector('.tabs-indicator');
  button.offsetLeft = 120;
  button.offsetWidth = 150;
  resize();
  expect(indicator.style).toMatchObject({ transform: 'translateX(120px)', width: '150px' });
  button.offsetLeft = 140;
  button.offsetWidth = 170;
  fontsLoaded();
  await Promise.resolve();
  expect(indicator.style).toMatchObject({ transform: 'translateX(140px)', width: '170px' });
});

function element(name, ...args) {
  const props = args.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
  const node = {
    tagName: name,
    className: args.find((value) => typeof value === 'string') || '',
    children: (args.find(Array.isArray) || []).flat(Infinity).filter((value) => value && typeof value === 'object'),
    ...props,
    ...props.attr,
    style: {},
    offsetLeft: 4,
    offsetWidth: 100,
    setAttribute(key, value) {
      this[key] = value;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const matches = (child) =>
        selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : selector === `[data-tab="${child['data-tab']}"]`;
      return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    },
  };
  return node;
}
