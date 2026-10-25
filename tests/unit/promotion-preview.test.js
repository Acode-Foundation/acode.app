// @vitest-environment jsdom
import confirm from '../../client/components/dialogs/confirm';
import Promotions from '../../client/pages/admin/promotions';

vi.mock('../../client/components/dialogs/confirm', () => ({ default: vi.fn() }));
vi.mock('../../client/components/input', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const { transformSync } = await import('@babel/core');
  const { default: tag } = await import('html-tag-js');
  const { default: Reactive } = await import('html-tag-js/reactive');
  const { code } = transformSync(readFileSync('client/components/input/index.js', 'utf8'), {
    configFile: false,
    babelrc: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
    plugins: ['html-tag-js/jsx/jsx-to-tag.js', 'html-tag-js/jsx/syntax-parser.js'],
  });
  const module = { exports: {} };
  runInNewContext(code, {
    module,
    exports: module.exports,
    tag,
    require: (name) => {
      if (name === './style.scss') return {};
      if (name === 'html-tag-js/reactive') return Reactive;
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return module.exports;
});

let root;
let failSave;
const promotion = {
  id: 'test-promotion',
  label: 'Example',
  url: 'https://example.com',
  icon: 'https://example.com/icon.png',
  link_text: 'A useful app',
  archived: 0,
  analytics: {
    total: 9,
    recent: 9,
    daily: [],
    origins: [
      { name: 'https://localhost', count: 4 },
      { name: 'https://acode.app', count: 3 },
      { name: 'acode://localhost', count: 1 },
      { name: 'https://other.example', count: 1 },
    ],
  },
};

beforeEach(async () => {
  failSave = false;
  confirm.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      if (options?.method === 'PUT') {
        if (failSave) return { ok: false, json: async () => ({ error: 'Save failed' }) };
        return { ok: true, json: async () => ({ promotion: { ...JSON.parse(options.body).promotion, id: promotion.id } }) };
      }
      return { ok: true, json: async () => (url.includes('archived') ? [] : [structuredClone(promotion)]) };
    }),
  );
  root = Promotions();
  document.body.replaceChildren(root);
  await vi.waitFor(() => expect(root.querySelector('.promotion-card')).not.toBeNull());
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const click = (label) =>
  [...root.querySelectorAll('button')].find((button) => button.textContent === label || button.getAttribute('aria-label') === label).click();
const writes = () => fetch.mock.calls.filter(([, options]) => options?.method === 'PUT');

it('toggles additional mobile analytics without hiding sources or making requests', () => {
  const section = root.querySelector('.promotion-analytics');
  const toggle = section.querySelector('.promotion-analytics-toggle');
  const targets = toggle
    .getAttribute('aria-controls')
    .split(' ')
    .map((id) => document.getElementById(id));
  expect(targets).toHaveLength(3);
  expect(targets.every((target) => section.contains(target))).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  click('More analytics');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(section.classList.contains('is-expanded')).toBe(true);
  click('Less analytics');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(section.classList.contains('is-expanded')).toBe(false);
  expect(section.querySelector('.promotion-breakdowns > div').classList.contains('promotion-breakdown-detail')).toBe(false);
  expect(writes()).toHaveLength(0);
});

it('prioritizes recent clicks and shows lifetime clicks only when different, including an inactive period', async () => {
  expect(root.querySelector('.promotion-metrics strong').textContent).toBe('9');
  expect(root.querySelector('.promotion-metrics span')).toBeNull();
  for (const recent of [4, 0]) {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ ...promotion, analytics: { ...promotion.analytics, recent } }],
    });
    click('Reload');
    await vi.waitFor(() => expect(root.querySelector('.promotion-metrics strong').textContent).toBe(String(recent)));
    expect(root.querySelector('.promotion-metrics span').textContent).toBe('9 all time');
  }
});

it('starts with a summary and readable source labels, and cancels edits without a request', () => {
  expect(root.querySelector('.promotion-fields').hidden).toBe(true);
  expect(root.textContent).toContain('A useful app');
  expect(root.textContent).toContain('Android app');
  expect(root.textContent).toContain('Website');
  expect(root.textContent).toContain('iOS app');
  expect(root.textContent).toContain('https://other.example');
  click('Edit Example');
  expect(root.querySelector('.promotion-fields').hidden).toBe(false);
  expect(root.querySelectorAll('.promotion-fields .custom-input')).toHaveLength(4);
  const input = root.querySelector('input[name=label]');
  expect(document.activeElement).toBe(input);
  input.value = 'Changed';
  input.dispatchEvent(new Event('input'));
  click('Cancel');
  expect(root.querySelector('h3').textContent).toBe('Example');
  expect(root.querySelector('.promotion-fields').hidden).toBe(true);
  expect(writes()).toHaveLength(0);
});

it('keeps failed edits open and closes the editor only after a successful save', async () => {
  click('Edit Example');
  const input = root.querySelector('input[name=label]');
  input.value = 'Changed';
  input.dispatchEvent(new Event('input'));
  failSave = true;
  click('Save changes');
  await vi.waitFor(() => expect(root.textContent).toContain('Save failed'));
  expect(root.querySelector('.promotion-fields').hidden).toBe(false);
  expect(root.querySelector('input[name=label]').value).toBe('Changed');
  expect(document.activeElement).toBe(root.querySelector('input[name=label]'));
  failSave = false;
  click('Save changes');
  await vi.waitFor(() => expect(root.textContent).toContain('Promotion saved.'));
  expect(root.querySelector('.promotion-fields').hidden).toBe(true);
  expect(document.activeElement).toBe(root.querySelector('.promotion-edit'));
  expect(JSON.parse(writes().at(-1)[1].body).promotion.label).toBe('Changed');
});

it('requires confirmation before archiving, preserves failed status, and restores archived cards', async () => {
  confirm.mockResolvedValueOnce(false);
  click('Archive Example');
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(writes()).toHaveLength(0);
  failSave = true;
  confirm.mockResolvedValue(true);
  click('Archive Example');
  await vi.waitFor(() => expect(root.textContent).toContain('Save failed'));
  expect(root.querySelector('.promotion-state').textContent).toBe('Active');
  failSave = false;
  click('Archive Example');
  await vi.waitFor(() => expect(root.textContent).toContain('Promotion archived.'));
  expect(root.querySelector('details .promotion-state').textContent).toBe('Archived');
  expect(root.querySelector('details').open).toBe(true);
  expect(document.activeElement.textContent).toBe('Restore');
  expect(root.textContent).toContain('0 / 3 slots');
  click('Restore');
  await vi.waitFor(() => expect(root.textContent).toContain('Promotion restored.'));
  expect(root.querySelector('.promotion-state').textContent).toBe('Active');
});

it('keeps edits open when a successful response does not contain the saved promotion', async () => {
  click('Edit Example');
  const input = root.querySelector('input[name=label]');
  input.value = 'Changed';
  input.dispatchEvent(new Event('input'));
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
  click('Save changes');
  await vi.waitFor(() => expect(root.textContent).toContain('Unexpected server response'));
  expect(root.querySelector('.promotion-fields').hidden).toBe(false);
  expect(root.querySelector('input[name=label]').value).toBe('Changed');
  expect(root.querySelector('.promotion-save').disabled).toBe(false);
});

it('opens new drafts for editing and removes cancelled drafts without a request', () => {
  click('Add promotion');
  expect(root.querySelectorAll('.promotion-fields')[1].hidden).toBe(false);
  expect(root.textContent).toContain('2 / 3 slots · 1 unsaved');
  const draft = root.querySelectorAll('.promotion-card')[1];
  expect(document.activeElement).toBe(draft.querySelector('input'));
  [...draft.querySelectorAll('button')].find((button) => button.textContent === 'Cancel').click();
  expect(root.querySelectorAll('.promotion-card')).toHaveLength(1);
  expect(document.activeElement.textContent).toBe('Add promotion');
  expect(writes()).toHaveLength(0);
});

it('preserves another card’s unsaved edits when archiving and enforces the slot limit on restore', async () => {
  click('Add promotion');
  const input = root.querySelectorAll('.promotion-card')[1].querySelector('input[name=label]');
  input.value = 'Unsaved title';
  input.dispatchEvent(new Event('input'));
  confirm.mockResolvedValue(true);
  click('Archive Example');
  await vi.waitFor(() => expect(root.textContent).toContain('Promotion archived.'));
  expect(root.querySelector('input[name=label]').value).toBe('Unsaved title');
  expect(root.querySelector('.promotion-fields').hidden).toBe(false);
  click('Add promotion');
  click('Add promotion');
  const restore = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Restore');
  expect(restore.disabled).toBe(true);
  restore.click();
  expect(writes()).toHaveLength(1);
  click('Cancel');
  expect([...root.querySelectorAll('button')].find((button) => button.textContent === 'Restore').disabled).toBe(false);
});

it('previews only credential-free HTTP(S) URLs and clears invalid or empty previews', () => {
  click('Edit Example');
  const preview = root.querySelector('img');
  const icon = root.querySelector('input[name=icon]');
  for (const invalid of ['', 'invalid', '/relative.png', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://user:pass@example.com/a.png']) {
    icon.value = 'https://example.com/a.png?size=40&theme=dark';
    icon.dispatchEvent(new Event('change'));
    expect(preview.getAttribute('src')).toBe(icon.value);
    expect(icon.validationMessage).toBe('');
    icon.value = invalid;
    icon.dispatchEvent(new Event('change'));
    expect(preview.hasAttribute('src')).toBe(false);
    expect(preview.style.visibility).toBe('hidden');
    if (invalid) expect(icon.validationMessage).toContain('HTTP or HTTPS');
    icon.value = 'https://example.com/corrected.png';
    icon.dispatchEvent(new Event('input'));
    expect(icon.validationMessage).toBe('');
  }
});
