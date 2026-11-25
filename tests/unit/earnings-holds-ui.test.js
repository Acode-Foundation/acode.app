// @vitest-environment jsdom
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import Database from 'better-sqlite3';
import tag from 'html-tag-js';
import createRefreshButton from '../../client/components/refreshButton';
import * as formatNumber from '../../client/lib/formatNumber';

const { code } = transformSync(fs.readFileSync('client/pages/admin/earningsHolds.js', 'utf8'), {
  configFile: false,
  babelrc: false,
  presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
  plugins: ['html-tag-js/jsx/jsx-to-tag.js', 'html-tag-js/jsx/syntax-parser.js'],
});
const snapshot = [
  { key: 'earnings-hold:7:2026:9:GOOGLE_PURCHASE_REVIEW_REQUIRED', value: '{"code":"GOOGLE_PURCHASE_REVIEW_REQUIRED","revision":"r1"}' },
];
const hold = {
  userId: 7,
  year: 2026,
  month: 9,
  codes: ['GOOGLE_PURCHASE_REVIEW_REQUIRED'],
  snapshot,
  user: { name: 'Example Developer', email: 'dev@example.com' },
  saved: [{ amount: 1234.5, payout: { id: 55, status: 'paid' } }],
  unpaidBalance: 4000,
};
const unpaidRow = (amount) => ({ amount, payout: null });
let lifecycle;
let alert;
let confirm;
let listing;
let cleared;
let recalculated;

beforeEach(() => {
  lifecycle = new AbortController();
  alert = vi.fn();
  confirm = vi.fn().mockResolvedValue(true);
  listing = { holds: [hold], invalidMarkers: [] };
  cleared = { ok: true, status: 200, json: async () => ({ success: true, clearedCodes: hold.codes }) };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      if (init?.method === 'DELETE') return cleared;
      if (init?.method === 'POST') return recalculated;
      const current = listing;
      return { ok: true, status: 200, json: async () => current };
    }),
  );
});

afterEach(() => {
  lifecycle.abort();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function mount() {
  const dependencies = {
    './earningsHolds.scss': {},
    'components/dialogs/alert': alert,
    'components/dialogs/confirm': confirm,
    'components/refreshButton': createRefreshButton,
    'lib/formatNumber': formatNumber,
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    tag,
    AbortController,
    Intl,
    Date,
    fetch: (...args) => fetch(...args),
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
      return dependencies[name];
    },
  });
  const root = module.exports.default({ signal: lifecycle.signal });
  document.body.replaceChildren(root);
  await vi.waitFor(() => expect(root.querySelector('.holds-summary').textContent).not.toBe(''));
  return root;
}

const deletes = () => fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE');

it('shows who is held, why, and what clearing would release', async () => {
  const root = await mount();
  expect(root.querySelector('.hold-user a').getAttribute('href')).toBe('/profile/7');
  const text = root.querySelector('.hold').textContent;
  for (const part of ['Example Developer', 'dev@example.com', 'October 2026', 'late Google purchase', '1,234.50', 'Paid (#55)', '4,000']) {
    expect(text).toContain(part);
  }
  expect(root.querySelector('.hold-warning')).toBeNull();
});

it('clears exactly the reviewed snapshot and zero-based month after confirmation, then reloads', async () => {
  const root = await mount();
  listing = { holds: [], invalidMarkers: [] };
  root.querySelector('.clear-hold').click();
  await vi.waitFor(() => expect(root.querySelector('.holds-summary').textContent).toBe('No earnings are on hold.'));
  expect(confirm.mock.calls[0][1]).toContain('already part of a payout');
  const [[url, init]] = deletes();
  expect(url).toBe('/api/admin/earnings-holds/7/2026/9');
  expect(JSON.parse(init.body)).toEqual({ snapshot });
  expect(root.querySelector('.hold')).toBeNull();
  expect(alert).not.toHaveBeenCalled();
});

it('does nothing when the confirmation is cancelled', async () => {
  confirm.mockResolvedValue(false);
  const root = await mount();
  root.querySelector('.clear-hold').click();
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(deletes()).toHaveLength(0);
  expect(root.querySelector('.hold')).not.toBeNull();
});

it('warns that a month without saved earnings would be missing from the payout', async () => {
  listing = { holds: [{ ...hold, codes: ['INVALID_GOOGLE_REPORT'], saved: [] }], invalidMarkers: [] };
  const root = await mount();
  expect(root.querySelector('.hold').textContent).toContain('Not saved');
  expect(root.querySelector('.hold-warning').textContent).toContain('October 2026 were never saved');
  root.querySelector('.clear-hold').click();
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(confirm.mock.calls[0][1]).toContain('missing from the next payout');
  expect(confirm.mock.calls[0][1]).toContain('would clear the calculation problem and save its earnings');
});

it('shows every row of a month that was saved more than once', async () => {
  listing = { holds: [{ ...hold, codes: ['INVALID_GOOGLE_REPORT'], saved: [unpaidRow(10.5), ...hold.saved] }], invalidMarkers: [] };
  const root = await mount();
  const text = root.querySelector('.hold-facts').textContent;
  for (const part of ['10.50', '1,234.50', 'Not paid / Paid (#55)']) expect(text).toContain(part);
  expect(root.querySelector('.hold-warning').textContent).toContain('saved 2 times');
  root.querySelector('.clear-hold').click();
  await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  for (const part of ['saved 2 times', 'already part of a payout']) expect(confirm.mock.calls[0][1]).toContain(part);
  expect(confirm.mock.calls[0][1]).not.toContain('Recalculating this month would');
});

it('recalculates after confirmation and shows the saved amount', async () => {
  listing = { holds: [{ ...hold, codes: ['INVALID_GOOGLE_REPORT'], saved: [] }], invalidMarkers: [] };
  const root = await mount();
  recalculated = { ok: true, status: 200, json: async () => ({ success: true, earnings: 321.5, remainingCodes: [] }) };
  listing = { holds: [], invalidMarkers: [] };
  root.querySelector('.recalculate-hold').click();
  await vi.waitFor(() => expect(root.querySelector('.hold')).toBeNull());
  expect(confirm.mock.calls[0][1]).toContain('No payout is started');
  const [url] = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(url).toBe('/api/admin/earnings-holds/7/2026/9/recalculate');
  expect(alert.mock.calls[0][1]).toContain('321.50 saved for October 2026');
  expect(deletes()).toHaveLength(0);
});

it('shows why a recalculation failed and keeps the hold', async () => {
  listing = { holds: [{ ...hold, codes: ['INVALID_GOOGLE_REPORT'], saved: [] }], invalidMarkers: [] };
  const root = await mount();
  recalculated = { ok: false, status: 409, json: async () => ({ error: 'The Google earnings reports of this month are not available yet.' }) };
  root.querySelector('.recalculate-hold').click();
  await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('ERROR', expect.stringContaining('not available yet')));
  expect(root.querySelector('.hold')).not.toBeNull();
});

it.each([
  ['a calculation problem', { codes: ['INVALID_GOOGLE_REPORT'], saved: [unpaidRow(10)] }, true],
  ['a missing month with a manual review', { codes: ['INVALID_GOOGLE_REPORT', 'GOOGLE_PURCHASE_REVIEW_REQUIRED'], saved: [] }, true],
  ['a saved month with a manual review', { codes: ['INVALID_GOOGLE_REPORT', 'GOOGLE_PURCHASE_REVIEW_REQUIRED'], saved: [unpaidRow(10)] }, false],
  ['a manual review', { saved: [unpaidRow(10)] }, false],
  ['a month saved twice', { codes: ['INVALID_GOOGLE_REPORT'], saved: [unpaidRow(10), unpaidRow(20)] }, false],
  ['a month in a payout', { codes: ['INVALID_GOOGLE_REPORT'] }, false],
])('offers to recalculate %s: %#', async (_name, extra, offered) => {
  listing = { holds: [{ ...hold, ...extra }], invalidMarkers: [] };
  const root = await mount();
  expect(Boolean(root.querySelector('.recalculate-hold'))).toBe(offered);
});

it('reports a hold that changed after it was listed and shows the new state', async () => {
  const root = await mount();
  cleared = { ok: false, status: 409, json: async () => ({ error: 'Earnings holds changed. Reload and review them before clearing.' }) };
  listing = { holds: [{ ...hold, codes: [...hold.codes, 'MISSING_RAZORPAY_INR'] }], invalidMarkers: [] };
  root.querySelector('.clear-hold').click();
  await vi.waitFor(() => expect(root.querySelectorAll('.hold-reasons li')).toHaveLength(2));
  expect(alert).toHaveBeenCalledWith('ERROR', expect.stringContaining('holds changed'));
});

it('shows damaged records without a way to clear them, and treats stored text as text', async () => {
  const value = '<img src=x onerror=alert(1)>';
  listing = {
    holds: [{ ...hold, user: { name: value, email: null }, codes: ['SOME_NEW_CODE'] }],
    invalidMarkers: [{ key: 'earnings-hold:7:bad', value, code: 'INVALID_MARKER' }],
  };
  const root = await mount();
  expect(root.querySelector('.holds-invalid').hidden).toBe(false);
  expect(root.querySelector('.holds-invalid').textContent).toContain('earnings-hold:7:bad');
  expect(root.querySelector('.holds-invalid button')).toBeNull();
  expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('.hold-reasons').textContent).toContain('SOME_NEW_CODE');
});

it('does not keep an outdated list when loading fails', async () => {
  const root = await mount();
  fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Database unavailable' }) });
  root.refreshButton.click();
  await vi.waitFor(() => expect(root.querySelector('.holds-summary').textContent).toBe('Database unavailable'));
  expect(root.querySelector('.hold')).toBeNull();
});

it('adds the developer, saved earnings and payout to each hold without touching its snapshot', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
    CREATE TABLE payment (id INTEGER PRIMARY KEY, status INTEGER);
    CREATE TABLE user_earnings (id INTEGER PRIMARY KEY, user_id INTEGER, year INTEGER, month INTEGER, amount REAL, payment_id INTEGER);
    INSERT INTO user VALUES (7, 'Example Developer', 'dev@example.com');
    INSERT INTO payment VALUES (55, 1);
    INSERT INTO user_earnings VALUES (5, 9, '2026', '9', 5, 404), (1, 7, 2026, 9, 100.5, 55), (2, 7, 2026, 10, 20.1, NULL), (3, 7, 2025, 9, 10.2, NULL), (4, 8, 2026, 9, 999, NULL);
  `);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('server/lib/earningsHoldDetails.js', 'utf8'), {
    module,
    require: (name) => {
      if (name === '../entities/entity') return { execSql: async (sql, values) => db.prepare(sql).all(...values) };
      if (name === '../entities/payment') return { STATUS_NONE: 0, STATUS_PAID: 1, STATUS_INITIATED: 2 };
      return {};
    },
  });
  const details = module.exports;
  const base = (extra) => ({ userId: 7, year: 2026, month: 9, codes: ['A'], snapshot, ...extra });
  const [paid, unpaid, unsaved, missing] = await details([base(), base({ month: 10 }), base({ month: 11 }), base({ userId: 99 })]);
  const [orphan] = await details([base({ userId: 9 })]);
  expect(orphan).toMatchObject({ saved: [{ amount: 5, payout: { id: 404, status: 'unknown' } }] });
  expect(paid).toEqual({
    ...base(),
    user: { name: 'Example Developer', email: 'dev@example.com' },
    saved: [{ amount: 100.5, payout: { id: 55, status: 'paid' } }],
    unpaidBalance: 30.3,
  });
  expect(paid.snapshot).toBe(snapshot);
  expect(unpaid).toMatchObject({ saved: [unpaidRow(20.1)] });
  expect(unsaved).toMatchObject({ saved: [], unpaidBalance: 30.3 });
  expect(missing).toMatchObject({ user: null, saved: [], unpaidBalance: 0 });
  // Migration 020 keeps months that were saved twice.
  db.exec('INSERT INTO user_earnings VALUES (9, 7, 2026, 9, 60, NULL), (6, 7, 2026, 9, 50, 404)');
  const [repeated] = await details([base()]);
  expect(repeated.saved).toEqual([
    { amount: 100.5, payout: { id: 55, status: 'paid' } },
    { amount: 50, payout: { id: 404, status: 'unknown' } },
    unpaidRow(60),
  ]);
  expect(await details([])).toHaveLength(0);
  db.close();
});
