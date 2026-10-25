// @vitest-environment jsdom
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import tag from 'html-tag-js';

const router = { on: vi.fn() };
function load(name, dependencies) {
  const { code } = transformSync(fs.readFileSync(`client/components/dialogs/${name}.js`, 'utf8'), {
    configFile: false,
    babelrc: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
    plugins: ['html-tag-js/jsx/jsx-to-tag.js', 'html-tag-js/jsx/syntax-parser.js'],
  });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, tag, document, setTimeout, require: (name) => dependencies[name] });
  return module.exports.default;
}
const DialogBox = load('dialogBox', { './style.scss': {}, 'lib/Router': router });
const confirm = load('confirm', { './dialogBox': DialogBox });

afterEach(() => {
  document.body.replaceChildren();
  router.on.mockClear();
});

it.each(['OK', 'Cancel', 'overlay', 'navigation'])('settles confirmation on %s without approving a dismissal', async (action) => {
  const result = confirm('Archive promotion?', 'Click history will be kept.');
  if (action === 'navigation') router.on.mock.calls[0][1]();
  else if (action === 'overlay') document.querySelector('.dialog-box-overlay').click();
  else [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === action).click();
  expect(await result).toBe(action === 'OK');
});
