// @vitest-environment jsdom
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import tag from 'html-tag-js';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import moment from 'moment';
import createRefreshButton from '../../client/components/refreshButton';

const source = fs.readFileSync('client/pages/admin/index.js', 'utf8');
const { code } = transformSync(
  `${source.slice(source.indexOf('function Sponsors('), source.indexOf('/** Updates to published plugins'))}\n${source.slice(source.indexOf('function Users('), source.indexOf('async function clickHandler('))}\nmodule.exports = { Sponsors, Plugins, Users };`,
  {
    configFile: false,
    babelrc: false,
    plugins: ['html-tag-js/jsx/jsx-to-tag.js', 'html-tag-js/jsx/syntax-parser.js'],
  },
);
let lifecycle;
let components;
const sponsor = { id: 1, name: 'Sponsor', tier: 1, email: 'sponsor@example.com', status: 0 };
const plugin = {
  id: 'example.plugin',
  name: 'Example',
  author: 'Developer',
  status: 1,
  status_text: 'approved',
  supported_editor: 'all',
  downloads: 10,
};
const user = { id: 1, name: 'Example user', email: 'example@example.com' };
const response = (data) => ({ ok: true, json: async () => data });

beforeEach(() => {
  lifecycle = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (url.includes('users')) return response({ users: [user], pages: 2 });
      if (url.includes('sponsors')) return response({ sponsors: [sponsor], pages: 2 });
      return response({ plugins: [plugin], pages: 2, total: 11 });
    }),
  );
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    tag,
    Ref,
    Reactive,
    moment,
    createRefreshButton,
    Input: (props) => tag('input', props),
    clickHandler: vi.fn(),
    AbortController,
    console,
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    fetch: (...args) => fetch(...args),
  });
  components = module.exports;
});
afterEach(() => {
  lifecycle.abort();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function mount(name) {
  const root = components[name]({ signal: lifecycle.signal });
  document.body.replaceChildren(root);
  await vi.waitFor(() => expect(root.refreshButton.disabled).toBe(false));
  return root;
}

it('refreshes the current sponsor page without clearing the table during the request', async () => {
  const root = await mount('Sponsors');
  root.querySelector('[title="next page"]').click();
  await vi.waitFor(() => expect(root.querySelector('.pagination').textContent).toMatch(/2\s*\/\s*2/));
  const row = root.querySelector('tbody tr');
  let finish;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  root.refreshButton.click();
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/admin/sponsors?page=2&limit=10');
  expect(root.querySelector('tbody tr')).toBe(row);
  finish(response({ sponsors: [{ ...sponsor, name: 'Updated sponsor' }], pages: 2 }));
  await vi.waitFor(() => expect(root.textContent).toContain('Updated sponsor'));
});

it('refreshes plugins with the current search, status, and page and keeps existing rows visible', async () => {
  const root = await mount('Plugins');
  const search = root.querySelector('input');
  search.value = 'example';
  search.dispatchEvent(new Event('input'));
  const filter = root.querySelector('select');
  filter.value = '1';
  filter.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(root.querySelector('[title="Next page"]').disabled).toBe(false));
  root.querySelector('[title="Next page"]').click();
  await vi.waitFor(() => expect(root.querySelector('.pagination').textContent).toMatch(/2\s*\/\s*2/));
  const row = root.querySelector('tbody tr');
  let finish;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  root.refreshButton.click();
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/admin/plugins?page=2&limit=10&status=1&search=example');
  expect(root.querySelector('tbody tr')).toBe(row);
  finish(response({ plugins: [{ ...plugin, name: 'Updated plugin' }], pages: 2, total: 11 }));
  await vi.waitFor(() => expect(root.textContent).toContain('Updated plugin'));
});

it('ignores a late plugin refresh after the filter changes', async () => {
  const root = await mount('Plugins');
  let finish;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  root.refreshButton.click();
  const requestSignal = fetch.mock.calls.at(-1)[1].signal;
  const filter = root.querySelector('select');
  filter.value = '2';
  filter.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(root.querySelector('tbody').textContent).toContain('Example'));
  expect(requestSignal.aborted).toBe(true);
  finish(response({ plugins: [{ ...plugin, name: 'Stale result' }], pages: 2, total: 11 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.textContent).not.toContain('Stale result');
});

it.each(['Sponsors', 'Plugins', 'Users'])('keeps the current %s rows on a refresh failure', async (name) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = await mount(name);
  const row = root.querySelector('tbody tr');
  fetch.mockResolvedValueOnce({ ok: false });
  root.refreshButton.click();
  await vi.waitFor(() => expect(root.refreshButton.dataset.state).toBe('error'));
  expect(root.querySelector('tbody tr')).toBe(row);
});

it('refreshes users on the current page with both search fields without clearing existing rows', async () => {
  const root = await mount('Users');
  for (const [name, value] of [
    ['name', 'Example User'],
    ['email', 'example@example.com'],
  ]) {
    const input = root.querySelector(`input[name=${name}]`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  await vi.waitFor(() => expect(fetch.mock.calls.at(-1)[0]).toContain('email=example%40example.com'));
  root.querySelector('[title="next page"]').click();
  await vi.waitFor(() => expect(root.querySelector('.pagination').textContent).toMatch(/2\s*\/\s*2/));
  const row = root.querySelector('tbody tr');
  let finish;
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  root.refreshButton.click();
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/admin/users?page=2&limit=10&name=Example%20User&email=example%40example.com');
  expect(root.querySelector('tbody tr')).toBe(row);
  finish(response({ users: [{ ...user, name: 'Updated user' }], pages: 2 }));
  await vi.waitFor(() => expect(root.textContent).toContain('Updated user'));
});

it('shows an actionable initial plugin error and recovers on refresh', async () => {
  fetch.mockResolvedValueOnce({ ok: false, status: 503 });
  const root = await mount('Plugins');
  expect(root.querySelector('.error-cell').textContent).toContain('503');
  expect(root.querySelector('.summary-text').textContent).toBe('');
  root.refreshButton.click();
  await vi.waitFor(() => expect(root.querySelector('tbody').textContent).toContain('Example'));
  expect(root.querySelector('.summary-text').textContent).toContain('Showing');
});

it('cancels the pending plugin search when the status filter changes', async () => {
  const root = await mount('Plugins');
  vi.useFakeTimers();
  const search = root.querySelector('input');
  search.value = 'example';
  search.dispatchEvent(new Event('input'));
  const filter = root.querySelector('select');
  filter.value = '1';
  filter.dispatchEvent(new Event('change'));
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.at(-1)[0]).toContain('status=1&search=example');
});

const listCases = [
  ['Sponsors', 'sponsors', sponsor],
  ['Users', 'users', user],
  ['Plugins', 'plugins', plugin],
];
it.each(['Users', 'Plugins'])('starts a pending %s search on page one when refresh is clicked', async (name) => {
  const root = await mount(name);
  root.querySelector('.navigate_next').click();
  await vi.waitFor(() => expect(root.querySelector('.pagination').textContent).toMatch(/2\s*\/\s*2/));
  vi.useFakeTimers();
  const search = root.querySelector('input');
  search.value = 'new query';
  search.dispatchEvent(new Event('input'));
  root.refreshButton.click();
  expect(fetch.mock.calls.at(-1)[0]).toContain('page=1');
  expect(fetch.mock.calls.at(-1)[0]).toMatch(/(?:name|search)=new%20query/);
  await vi.advanceTimersByTimeAsync(600);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it.each(['Users', 'Sponsors'])('shows %s pagination failures without removing existing rows and clears them on recovery', async (name) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const root = await mount(name);
  const row = root.querySelector('tbody tr');
  fetch.mockResolvedValueOnce({ ok: false });
  root.querySelector('.navigate_next').click();
  await vi.waitFor(() => expect(root.querySelector('[role=alert]')?.textContent).toContain('Failed to load'));
  expect(row.isConnected).toBe(true);
  expect(root.querySelector('.pagination').textContent).toMatch(/1\s*\/\s*2/);
  root.refreshButton.click();
  await vi.waitFor(() => expect(root.querySelector('[role=alert]')).toBeNull());
});

it.each(listCases)('refreshes the last remaining page when %s pagination shrinks', async (name, key, row) => {
  const root = await mount(name);
  root.querySelector('.navigate_next').click();
  await vi.waitFor(() => expect(root.querySelector('.pagination').textContent).toMatch(/2\s*\/\s*2/));
  fetch.mockResolvedValueOnce(response({ [key]: [], pages: 1, total: 1 }));
  fetch.mockResolvedValueOnce(response({ [key]: [row], pages: 1, total: 1 }));
  root.refreshButton.click();
  await vi.waitFor(() => expect(root.querySelector('.pagination').textContent).toMatch(/1\s*\/\s*1/));
  expect(fetch.mock.calls.at(-1)[0]).toContain('page=1');
  expect(root.querySelector('tbody').textContent).toContain(row.name);
});

it.each(listCases)('shows 0/0 when a refreshed %s list becomes empty', async (name, key) => {
  const root = await mount(name);
  fetch.mockResolvedValueOnce(response({ [key]: [], pages: 0, total: 0 }));
  root.refreshButton.click();
  await vi.waitFor(() => expect(root.querySelector('.pagination').textContent).toMatch(/0\s*\/\s*0/));
  expect(fetch).toHaveBeenCalledTimes(2);
});
