// @vitest-environment jsdom
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import tag from 'html-tag-js';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';

let user;
let iosSource;
let categories;
const router = { reload: vi.fn(), loadUrl: vi.fn() };
const fetch = vi.fn();
const alert = vi.fn();
const shared = { './style.scss': {}, 'html-tag-js/reactive': Reactive };
const Input = load('client/components/input/index.js', shared);
const AjaxForm = load('client/components/ajaxForm/index.js', shared);
const Tabs = load('client/components/tabs/index.js', { ...shared, 'html-tag-js/ref': Ref });
const FAQs = load('client/pages/FAQs/index.js', {
  ...shared,
  'components/input': Input,
  'components/tabs': Tabs,
  'components/ajaxForm': AjaxForm,
  'components/dialogs/alert': alert,
  'components/dialogs/confirm': vi.fn(),
  'html-tag-js/ref': Ref,
  'lib/appSource': { isIOSSource: () => iosSource },
  'lib/helpers': { getLoggedInUser: async () => user, hashString: (value) => value.toLowerCase().replace(/\W/g, '') },
  'lib/markdown': { renderMarkdown: (answer) => answer, handleAnchorLinks: vi.fn() },
  'lib/Router': router,
});

beforeEach(() => {
  user = { isAdmin: true };
  iosSource = false;
  categories = [{ id: 'general', name: 'General', faqs: [{ q: 'Files?', a: 'Use Files.', platform: 'ios' }] }];
  fetch.mockReset().mockImplementation(async () => ({ json: async () => categories }));
  router.reload.mockClear();
  router.loadUrl.mockClear();
  alert.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => document.body.replaceChildren());

it('defaults new FAQs to Both and submits the selected platform through the real form', async () => {
  document.body.append(await FAQs({}));
  const select = document.querySelector('input[name=platform]:checked');
  expect(select.value).toBe('both');
  expect([...document.querySelectorAll('.faq-platform-toggle span')].map((option) => option.textContent.trim())).toEqual(['Both', 'Android', 'iOS']);
  document.querySelector('input[name=q]').value = 'New?';
  document.querySelector('textarea[name=a]').value = 'Answer.';
  document.querySelector('input[name=platform][value=android]').click();
  fetch.mockResolvedValueOnce({ json: async () => ({ message: 'success' }) });
  document.querySelector('[data-tab=preview]').click();
  expect(document.querySelector('#faq-preview').textContent).toContain('Answer.');
  expect(document.querySelector('#faq-edit').hidden).toBe(true);
  document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(router.reload).toHaveBeenCalled());
  const [url, options] = fetch.mock.calls.at(-1);
  expect(url).toBe('/api/faqs');
  expect(options.method).toBe('post');
  expect(Object.fromEntries(options.body)).toMatchObject({ q: 'New?', a: 'Answer.', category: 'general', platform: 'android' });
});

it('retains the saved platform when opening an FAQ for editing and can reset it to Both', async () => {
  document.body.append(await FAQs({}));
  expect(document.querySelector('.faq-platform').textContent).toBe('iOS');
  document.querySelector('[title="Edit this FAQ"]').click();
  const [params] = router.reload.mock.calls.at(-1);
  expect(params.oldPlatform).toBe('ios');
  document.body.replaceChildren(await FAQs(params));
  const select = document.querySelector('input[name=platform]:checked');
  expect(select.value).toBe('ios');
  document.querySelector('input[name=platform][value=both]').click();
  fetch.mockResolvedValueOnce({ json: async () => ({ message: 'success' }) });
  document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(router.loadUrl).toHaveBeenCalled());
  expect(fetch.mock.calls.at(-1)[1].body.get('platform')).toBe('both');
  expect(fetch.mock.calls.at(-1)[1].body.get('old_q')).toBe('Files?');
});

it('shows untagged FAQs as Both for admins and hides editing controls from visitors', async () => {
  categories[0].faqs[0] = { q: 'Files?', a: 'Use Files.' };
  document.body.append(await FAQs({}));
  expect(document.querySelector('.faq-platform').textContent).toBe('Both');
  user = null;
  document.body.replaceChildren(await FAQs({}));
  expect(document.querySelector('form, .faq-actions')).toBeNull();
  expect(document.body.textContent).toContain('Files?');
});

it('combines clearable platform filters with search on ordinary website visits', async () => {
  user = null;
  categories[0].faqs = [
    { q: 'Shared?', a: 'Editor', platform: 'both' },
    { q: 'Legacy?', a: 'Editor' },
    { q: 'Files?', a: 'Editor', platform: 'ios' },
    { q: 'Storage?', a: 'Editor', platform: 'android' },
  ];
  document.body.append(await FAQs({}));
  const [ios, android] = document.querySelectorAll('.faq-platform-filters button');
  const questions = () => [...document.querySelectorAll('.faq h2')].map((item) => item.textContent);
  expect(ios.getAttribute('aria-pressed')).toBe('false');
  expect(questions()).toHaveLength(4);
  ios.click();
  expect(questions()).toEqual(['Shared?', 'Legacy?', 'Files?']);
  ios.click();
  expect(questions()).toHaveLength(4);
  android.click();
  expect(questions()).toEqual(['Shared?', 'Legacy?', 'Storage?']);
  const search = document.querySelector('input[type=search]');
  search.value = 'Files';
  search.dispatchEvent(new Event('input'));
  ios.click();
  expect(questions()).toEqual(['Files?']);
  android.click();
  expect(document.querySelector('.faq-no-results').textContent).toContain('No FAQs');
  search.value = '';
  search.dispatchEvent(new Event('input'));
  android.click();
  expect(questions()).toHaveLength(4);
  expect([...document.querySelectorAll('.faq-platform-filters button')].every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(
    true,
  );
});

it('hides browsing platform controls in iOS context while retaining filtering, search and admin platform editing', async () => {
  iosSource = true;
  categories[0].faqs.push({ q: 'Android storage?', a: 'Android answer.', platform: 'android' });
  document.body.append(await FAQs({}));
  expect(document.querySelector('.faq-platform-filters')).toBeNull();
  expect([...document.querySelectorAll('.faq h2')].map((item) => item.textContent)).toEqual(['Files?']);
  expect(document.querySelector('.search-count')).toBeNull();
  expect(document.querySelectorAll('.faq-platform-toggle input')).toHaveLength(3);
  const search = document.querySelector('input[type=search]');
  search.value = 'Android';
  search.dispatchEvent(new Event('input'));
  await vi.waitFor(() => expect(document.querySelector('.faq-no-results')).not.toBeNull());
});

it.each(['ios', 'android'])('opens a direct link to a %s FAQ with its platform selected', async (platform) => {
  user = null;
  iosSource = true;
  categories[0].faqs.push({ q: 'Linked?', a: 'Linked answer.', platform });
  document.body.append(await FAQs({ qHash: 'linked' }));
  const target = document.getElementById('linked');
  expect(target).not.toBeNull();
  expect(document.querySelector('.faq-platform-filters')).toBeNull();
  expect(document.getElementById('files') !== null).toBe(platform === 'ios');
  await vi.waitFor(() => expect(target.scrollIntoView).toHaveBeenCalled());
  expect(target.scrollIntoView.mock.contexts).toContain(target);
});

function load(file, dependencies) {
  const { code } = transformSync(fs.readFileSync(file, 'utf8'), {
    configFile: false,
    babelrc: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
    plugins: ['html-tag-js/jsx/jsx-to-tag.js', 'html-tag-js/jsx/syntax-parser.js'],
  });
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    tag,
    document,
    window,
    FormData,
    getComputedStyle,
    setTimeout,
    clearTimeout,
    fetch: (...args) => fetch(...args),
    require: (name) => dependencies[name],
  });
  return exports.default;
}
