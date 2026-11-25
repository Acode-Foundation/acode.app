import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { transformAsync } from '@babel/core';
import Database from 'better-sqlite3';
import express from 'express';
import { JSDOM } from 'jsdom';
import * as paymentMethods from '../../shared/paymentMethods';

const { getPaymentMethodType, isPaymentMethodTypeAvailable, validatePaymentMethod } = paymentMethods;
const root = path.resolve(import.meta.dirname, '../..');

const BANK_INDIA = {
  bank_account_holder: 'Example Developer',
  bank_account_number: '9876 5432 101',
  bank_ifsc_code: 'icic0000282',
  bank_name: 'ICICI Bank',
  bank_account_type: 'savings',
};
const BANK_OVERSEAS = {
  bank_country: 'DE',
  bank_account_holder: 'Example Developer',
  bank_account_holder_address: '1 Example Street, Berlin',
  bank_account_number: 'de89 3704 0044 0532 0130 00',
  bank_name: 'Example Bank',
  bank_swift_code: 'deutdeff',
  bank_account_type: 'Current',
};
const PAYPAL = { paypal_email: 'Dev@Example.com' };

describe('validation', () => {
  it('cleans valid details of every type and drops unknown fields', () => {
    const india = validatePaymentMethod('bank_india', { ...BANK_INDIA, user_id: 1, is_default: '1' });
    expect(india.errors).toEqual({});
    expect(india.values).toEqual({
      bank_account_holder: 'Example Developer',
      bank_account_number: '98765432101',
      bank_ifsc_code: 'ICIC0000282',
      bank_name: 'ICICI Bank',
      bank_account_type: 'Savings',
    });
    const overseas = validatePaymentMethod('bank_overseas', BANK_OVERSEAS);
    expect(overseas.errors).toEqual({});
    expect(overseas.values).toMatchObject({ bank_account_number: 'DE89370400440532013000', bank_swift_code: 'DEUTDEFF' });
    expect(validatePaymentMethod('paypal', { paypal_email: ' Dev@Example.com ' })).toEqual({
      values: { paypal_email: 'dev@example.com' },
      errors: {},
    });
  });

  it.each([
    ['bank_india', { ...BANK_INDIA, bank_account_number: '12345' }, 'bank_account_number'],
    ['bank_india', { ...BANK_INDIA, bank_ifsc_code: 'ICIC1000282' }, 'bank_ifsc_code'],
    ['bank_india', { ...BANK_INDIA, bank_account_holder: { toString: () => 'x' } }, 'bank_account_holder'],
    ['bank_india', { ...BANK_INDIA, bank_account_type: 'Loan' }, 'bank_account_type'],
    ['bank_overseas', { ...BANK_OVERSEAS, bank_country: 'IN' }, 'bank_country'],
    ['bank_overseas', { ...BANK_OVERSEAS, bank_swift_code: '' }, 'bank_swift_code'],
    ['bank_overseas', { ...BANK_OVERSEAS, bank_account_number: 'DE88370400440532013000' }, 'bank_account_number'],
    ['bank_overseas', { ...BANK_OVERSEAS, bank_account_holder_address: '' }, 'bank_account_holder_address'],
    ['paypal', { paypal_email: 'not-an-email' }, 'paypal_email'],
    ['amazon_gift_card', {}, 'type'],
    ['wallet', {}, 'type'],
    [undefined, {}, 'type'],
  ])('rejects invalid %s details %#', (type, details, field) => {
    expect(Object.keys(validatePaymentMethod(type, details).errors)).toEqual([field]);
  });

  it('infers legacy types and gates only PayPal by the setting', () => {
    expect(getPaymentMethodType({ paypal_email: 'a@example.com' })).toBe('paypal');
    expect(getPaymentMethodType({ wallet_address: '0x1' })).toBe('wallet');
    expect(getPaymentMethodType({ bank_account_number: '1' })).toBe('bank_india');
    const available = (paypalEnabled) => paymentMethods.PAYMENT_METHOD_TYPES.filter((type) => isPaymentMethodTypeAvailable(type, { paypalEnabled }));
    expect(available(false)).toEqual(['bank_india', 'bank_overseas']);
    expect(available(true)).toEqual(['bank_india', 'bank_overseas', 'paypal']);
    expect(isPaymentMethodTypeAvailable('wallet', { paypalEnabled: true })).toBe(false);
  });
});

it('gives every migration its own version, because an applied version is skipped', () => {
  const dir = path.join(root, 'server/migrations');
  const versions = fs.readdirSync(dir).map((file) => {
    const { version } = require(path.join(dir, file));
    expect(Number.parseInt(file, 10)).toBe(version);
    return version;
  });
  expect(new Set(versions).size).toBe(versions.length);
});

it('migrates existing rows, retires deleted defaults and promotes their replacement', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE payment_method (
      id INTEGER PRIMARY KEY, user_id INTEGER, paypal_email TEXT, wallet_address TEXT, bank_account_number TEXT,
      created_at TEXT, is_default INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0
    );
    INSERT INTO payment_method VALUES
      (1, 1, NULL, NULL, '111', '2026-01-01', 1, 1),
      (2, 1, NULL, NULL, '222', '2026-02-01', 0, 0),
      (3, 2, 'a@example.com', NULL, NULL, '2026-01-01', 1, 0),
      (4, 2, NULL, NULL, '444', '2026-02-01', 0, 0),
      (5, 3, NULL, '0x1', NULL, '2026-01-01', 1, 0),
      (6, 4, 'b@example.com', NULL, NULL, '2026-03-01', 1, 0),
      (7, 4, NULL, NULL, '777', '2026-01-01', 1, 0),
      (8, 4, NULL, NULL, '888', '2026-02-01', 1, 0);`);
  const migration = require('../../server/migrations/019_add_payment_method_types');
  migration.up(db);
  migration.up(db); // Fresh databases already have the columns.
  expect(db.prepare('SELECT id, type, is_default FROM payment_method ORDER BY id').all()).toEqual([
    { id: 1, type: 'bank_india', is_default: 0 },
    { id: 2, type: 'bank_india', is_default: 1 },
    { id: 3, type: 'paypal', is_default: 1 },
    { id: 4, type: 'bank_india', is_default: 0 },
    { id: 5, type: 'wallet', is_default: 1 },
    { id: 6, type: 'paypal', is_default: 0 },
    { id: 7, type: 'bank_india', is_default: 0 },
    { id: 8, type: 'bank_india', is_default: 1 },
  ]);
  db.close();
});

describe('API', () => {
  let db;
  let server;
  let origin;
  let loggedInUser;
  let Plugin;
  let PaymentMethod;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
      INSERT INTO user VALUES (1, 'Developer', 'dev@example.com'), (2, 'Other', 'other@example.com');`);
    loggedInUser = { id: 1 };
    const real = new Map();
    const originalLoad = Module._load;
    // Load the real entities against the in-memory database; other dependencies are irrelevant here.
    Module._load = function load(request, parent, isMain) {
      const file = parent?.filename || '';
      if (request === '../lib/db') return db;
      if (file.endsWith('server/apis/user.js')) {
        if (request === '../lib/helpers') {
          return {
            getLoggedInUser: async () => loggedInUser,
            getWebLoggedInUser: async () => loggedInUser,
            getCountryFromIp: () => 'DE',
            areSameUser: (id, user) => Number(id) === user.id,
          };
        }
        if (request === '../lib/rateLimits') return new Proxy({}, { get: () => (_req, _res, next) => next() });
        if (request === '../lib/guestOnly') return { rejectSignedIn: (_req, _res, next) => next() };
        if (request === '../entities/user') return { ID: 'id', get: async ([, id]) => db.prepare('SELECT * FROM user WHERE id = ?').all(id) };
        if (/^\.\.\/entities\/(?!payment|appConfig)/.test(request) || (/^\.\.\/lib\//.test(request) && request !== '../lib/db')) return {};
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      for (const key of Object.keys(require.cache)) {
        if (/server\/(entities|apis\/user|lib\/db)/.test(key)) {
          real.set(key, require.cache[key]);
          delete require.cache[key];
        }
      }
      const app = express();
      app.use(express.json());
      app.use('/api/user', require('../../server/apis/user'));
      Plugin = require('../../server/entities/plugin');
      PaymentMethod = require('../../server/entities/paymentMethod');
      server = app.listen(0);
      await new Promise((resolve) => server.once('listening', resolve));
      origin = `http://127.0.0.1:${server.address().port}/api/user`;
    } finally {
      Module._load = originalLoad;
    }
  });

  afterEach(() => {
    server.close();
    db.close();
  });

  async function call(method, url, body) {
    const res = await fetch(`${origin}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  }
  const add = (type, details, extra) => call('POST', '/payment-method', { type, ...details, ...extra });
  const list = async () => (await call('GET', '/payment-methods?user=1')).body;
  const setPayPal = (enabled) => db.prepare("UPDATE app_config SET value = ? WHERE key = 'paypal_payouts_enabled'").run(enabled ? '1' : '0');
  const payoutMethods = () => db.prepare('SELECT id FROM payment_method WHERE is_default = 1 AND is_deleted = 0 AND user_id = 1').all();

  it('offers PayPal until an admin turns it off', async () => {
    expect((await call('GET', '/payment-method-options')).body.types).toContain('paypal');
    expect((await add('paypal', { paypal_email: 'dev@example.com' })).status).toBe(200);
  });

  it('adds every type, masks the details and makes the first one the default', async () => {
    expect((await add('bank_india', BANK_INDIA)).status).toBe(200);
    expect((await add('bank_overseas', BANK_OVERSEAS)).status).toBe(200);
    expect((await add('paypal', PAYPAL)).status).toBe(200);
    const rows = await list();
    expect(rows.map(({ type }) => type).sort()).toEqual(['bank_india', 'bank_overseas', 'paypal']);
    const byType = Object.fromEntries(rows.map((row) => [row.type, row]));
    expect(byType.bank_india).toMatchObject({ is_default: 1, available: true, bank_account_number: '••••2101', bank_name: 'ICICI Bank' });
    expect(byType.bank_overseas).toMatchObject({ is_default: 0, bank_account_number: '••••3000', bank_country: 'DE' });
    expect(byType.paypal).toMatchObject({ is_default: 0, available: true, paypal_email: 'de•••@example.com' });
    expect(JSON.stringify(rows)).not.toContain('98765432101');
    expect((await add('paypal', { paypal_email: 'other@example.com' })).body.error).toContain('only 3');
  });

  it('follows the PayPal switch when adding, listing and choosing a default', async () => {
    setPayPal(false);
    expect((await call('GET', '/payment-method-options')).body).toMatchObject({
      types: ['bank_india', 'bank_overseas'],
      count: 0,
      limit: 3,
      hasDefault: false,
      country: 'DE',
    });
    expect((await add('paypal', { paypal_email: 'dev@example.com' })).status).toBe(400);
    setPayPal(true);
    expect((await call('GET', '/payment-method-options')).body.types).toContain('paypal');
    expect((await add('paypal', { paypal_email: 'dev@example.com' })).status).toBe(200);
    setPayPal(false);
    const [paypal] = await list();
    expect(paypal).toMatchObject({ type: 'paypal', available: false, is_default: 1 });
    expect((await call('PATCH', `/payment-method/update-default/${paypal.id}`)).status).toBe(400);
    // An unusable default is replaced by the next method that can be paid.
    await add('bank_india', BANK_INDIA);
    expect((await list()).find((row) => row.is_default)).toMatchObject({ type: 'bank_india' });
    expect(payoutMethods()).toHaveLength(1);
  });

  it('replaces the default on request and rejects duplicates and invalid details', async () => {
    await add('bank_india', BANK_INDIA);
    expect((await add('bank_india', { ...BANK_INDIA, bank_account_number: '98765432101' })).body.error).toContain('already added');
    const invalid = await add('bank_india', { ...BANK_INDIA, bank_ifsc_code: 'nope', bank_name: '' });
    expect(invalid.status).toBe(400);
    expect(Object.keys(invalid.body.errors)).toEqual(['bank_ifsc_code', 'bank_name']);
    await add('paypal', PAYPAL, { is_default: '1' });
    expect((await list()).filter((row) => row.is_default).map((row) => row.type)).toEqual(['paypal']);
    loggedInUser = null;
    expect((await add('paypal', PAYPAL)).status).toBe(401);
    expect((await call('GET', '/payment-method-options')).status).toBe(401);
  });

  it('refuses to delete the default until another method replaces it', async () => {
    await add('bank_india', BANK_INDIA);
    const [{ id }] = payoutMethods();
    const refused = await call('DELETE', `/payment-method/${id}`);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('Set another payment method as default');
    expect(payoutMethods()).toEqual([{ id }]);

    await add('paypal', PAYPAL);
    const replacement = (await list()).find((row) => row.type === 'paypal');
    expect((await call('PATCH', `/payment-method/update-default/${replacement.id}`)).status).toBe(200);
    expect((await call('DELETE', `/payment-method/${id}`)).status).toBe(200);
    expect((await list()).map((row) => row.id)).toEqual([replacement.id]);
  });

  it('lets a user with only unavailable methods recover without an admin', async () => {
    for (const name of ['a', 'b', 'c']) await add('paypal', { paypal_email: `${name}@example.com` });
    setPayPal(false);
    const rows = await list();
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => !row.available)).toBe(true);
    const spare = rows.find((row) => !row.is_default);
    expect((await call('DELETE', `/payment-method/${spare.id}`)).status).toBe(200);
    expect((await add('bank_india', BANK_INDIA)).status).toBe(200);
    expect((await list()).filter((row) => row.is_default).map((row) => row.type)).toEqual(['bank_india']);
  });

  it('keeps the current default when the new one was deleted or belongs to someone else', async () => {
    await add('bank_india', BANK_INDIA);
    await add('paypal', PAYPAL);
    const [current] = payoutMethods();
    const other = (await list()).find((row) => !row.is_default);
    expect(PaymentMethod.setDefault(2, other.id)).toBe(false);
    db.prepare('UPDATE payment_method SET is_deleted = 1 WHERE id = ?').run(other.id);
    expect(PaymentMethod.setDefault(1, other.id)).toBe(false);
    expect(payoutMethods()).toEqual([current]);

    db.prepare('UPDATE payment_method SET is_deleted = 0 WHERE id = ?').run(other.id);
    vi.spyOn(PaymentMethod, 'setDefault').mockReturnValueOnce(false);
    const res = await call('PATCH', `/payment-method/update-default/${other.id}`);
    expect(res).toMatchObject({ status: 400, body: { error: 'Payment method not found' } });
  });

  it('keeps one default and no duplicates when requests overlap', async () => {
    const added = await Promise.all([add('bank_india', BANK_INDIA), add('bank_india', BANK_INDIA), add('bank_india', BANK_INDIA)]);
    expect(added.map((res) => res.status).sort()).toEqual([200, 400, 400]);
    await add('paypal', PAYPAL);
    await add('bank_overseas', BANK_OVERSEAS);
    const ids = (await list()).map((row) => row.id);
    await Promise.all(ids.map((id) => call('PATCH', `/payment-method/update-default/${id}`)));
    expect(payoutMethods()).toHaveLength(1);
  });

  it.each([
    ['legacy-no-at', '•••'],
    ['a@example.com', 'a•••@example.com'],
    ['@example.com', '•••'],
    ['dev@example.com', 'de•••@example.com'],
  ])('masks the stored email %s as %s', async (email, masked) => {
    db.prepare("INSERT INTO payment_method (user_id, type, paypal_email, is_default) VALUES (1, 'paypal', ?, 1)").run(email);
    const [{ id }] = payoutMethods();
    db.prepare("INSERT INTO payment (user_id, amount, payment_method_id, date_from, date_to) VALUES (1, 100, ?, '2026-01-01', '2026-01-31')").run(id);
    expect((await list())[0].paypal_email).toBe(masked);
    expect((await call('GET', '/payments?user=1')).body[0].paypal_email).toBe(masked);
  });

  it('never pays a deleted method', async () => {
    await add('bank_india', BANK_INDIA);
    const [{ id }] = payoutMethods();
    db.prepare("INSERT INTO payment (user_id, amount, payment_method_id, date_from, date_to) VALUES (1, 100, ?, '2026-01-01', '2026-01-31')").run(id);
    await add('paypal', PAYPAL, { is_default: '1' });
    const [replacement] = payoutMethods();
    expect((await call('DELETE', `/payment-method/${id}`)).status).toBe(200);
    expect(db.prepare('SELECT is_default, is_deleted FROM payment_method WHERE id = ?').get(id)).toEqual({ is_default: 0, is_deleted: 1 });

    // A default left behind on a deleted row must not reach the payout run either.
    db.prepare('UPDATE payment_method SET is_default = 1 WHERE id = ?').run(id);
    db.prepare("INSERT INTO plugin (id, sku, name, user_id) VALUES ('fixture.plugin', 'fixture', 'Fixture', 1)").run();
    expect((await Plugin.getUsersWithPlugin()).map((user) => user.payment_method_id)).toEqual([replacement.id]);
  });

  it('accepts an Indian bank account from a page that was loaded before the types existed', async () => {
    const { status } = await call('POST', '/payment-method', { ...BANK_INDIA, bank_account_type: 'savings' });
    expect(status).toBe(200);
    expect((await list())[0]).toMatchObject({ type: 'bank_india', bank_account_type: 'Savings' });
    expect((await call('POST', '/payment-method', { paypal_email: 'dev@example.com' })).body.error).toBe('Select a payment method');
  });

  it('shows where an old crypto payout went, without the full address', async () => {
    db.prepare(
      "INSERT INTO payment_method (id, user_id, type, wallet_type, wallet_address) VALUES (9, 1, 'wallet', 'btc', 'abcd1234567890wxyz')",
    ).run();
    db.prepare("INSERT INTO payment (user_id, amount, payment_method_id, date_from, date_to) VALUES (1, 100, 9, '2026-01-01', '2026-01-31')").run();
    const [payment] = (await call('GET', '/payments?user=1')).body;
    expect(payment).toMatchObject({ payment_method_type: 'wallet', wallet_type: 'btc', wallet_address: 'abcd...wxyz' });
  });

  it('shows the payout destination of each type in the payment history', async () => {
    await add('paypal', PAYPAL);
    const [{ id }] = payoutMethods();
    db.prepare("INSERT INTO payment (user_id, amount, payment_method_id, date_from, date_to) VALUES (1, 100, ?, '2026-01-01', '2026-01-31')").run(id);
    expect((await call('GET', '/payments?user=1')).body).toEqual([
      expect.objectContaining({ payment_method_type: 'paypal', paypal_email: 'de•••@example.com', bank_account_number: null }),
    ]);
  });
});

describe('form', () => {
  let code;
  let dom;
  let requests;
  let alert;
  let Router;

  beforeAll(async () => {
    const compile = async (file) =>
      (
        await transformAsync(fs.readFileSync(path.join(root, file), 'utf8'), {
          filename: path.join(root, file),
          babelrc: false,
          configFile: false,
          presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
          plugins: ['html-tag-js/jsx/syntax-parser.js', 'html-tag-js/jsx/jsx-to-tag.js'],
        })
      ).code;
    code = {
      page: await compile('client/pages/addPaymentMethod/index.js'),
      form: await compile('client/components/ajaxForm/index.js'),
      input: await compile('client/components/input/index.js'),
    };
  });

  async function mount({ mode, options = {}, user = { id: 1 } } = {}) {
    dom = new JSDOM('', { runScripts: 'outside-only', url: 'https://acode.app/add-payment-method' });
    const context = dom.getInternalVMContext();
    requests = [];
    alert = vi.fn();
    Router = { loadUrl: vi.fn() };
    const evaluate = (source) => {
      const module = { exports: {} };
      context.module = module;
      context.exports = module.exports;
      vm.runInContext(source, context);
      return module.exports;
    };
    const dependencies = {
      './style.scss': {},
      'components/dialogs/alert': alert,
      'lib/helpers': {
        getLoggedInUser: async () => user,
        showLoading: vi.fn(),
        hideLoading: vi.fn(),
        loadingStart: vi.fn(),
        loadingEnd: vi.fn(),
        withRedirect: (url, redirect) => `${url}?redirect=${redirect}`,
      },
      'lib/Router': Router,
      '../../../shared/paymentMethods': paymentMethods,
    };
    Object.assign(context, {
      fetch: async (url, init) => {
        requests.push({ url, body: init?.body && Object.fromEntries(init.body) });
        const types = ['bank_india', 'bank_overseas'];
        return { json: async () => (url.endsWith('options') ? { types, count: 0, limit: 3, hasDefault: false, threshold: 15000, ...options } : {}) };
      },
      require: (name) => {
        if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
        return dependencies[name];
      },
    });
    vm.runInContext(fs.readFileSync(require.resolve('html-tag-js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(require.resolve('html-tag-js/dist/polyfill'), 'utf8'), context);
    for (const name of ['html-tag-js/ref', 'html-tag-js/reactive']) dependencies[name] = evaluate(fs.readFileSync(require.resolve(name), 'utf8'));
    dependencies['components/ajaxForm'] = evaluate(code.form);
    dependencies['components/input'] = evaluate(code.input);
    const page = await evaluate(code.page).default({ mode });
    dom.window.document.body.append(page);
    return dom.window.document;
  }

  afterEach(() => dom.window.close());

  const visible = (document) => [...document.querySelectorAll('.method-fields')].filter((panel) => !panel.hidden).map((panel) => panel.dataset.type);
  const submit = async (document) => {
    document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve));
  };
  function fill(document, type, details) {
    const panel = document.querySelector(`[data-type="${type}"]`);
    for (const [name, value] of Object.entries(details)) {
      const control = panel.querySelector(`[name="${name}"]`);
      control.value = value;
      control.dispatchEvent(new dom.window.Event('input'));
    }
  }

  it('offers only the enabled methods and shows the fields of the selected one', async () => {
    const document = await mount({ mode: 'paypal' });
    expect([...document.querySelectorAll('.method-picker input')].map((input) => input.value)).toEqual(['bank_india', 'bank_overseas']);
    expect(visible(document)).toEqual(['bank_india']); // PayPal is off, so its link falls back.
    const option = document.querySelector('[value="bank_overseas"]');
    option.checked = true;
    option.dispatchEvent(new dom.window.Event('change'));
    expect(visible(document)).toEqual(['bank_overseas']);
  });

  it('preselects the method in the URL when it is enabled', async () => {
    const document = await mount({ mode: 'paypal', options: { types: paymentMethods.PAYMENT_METHOD_TYPES } });
    expect(visible(document)).toEqual(['paypal']);
    expect(document.querySelector('.method-picker input:checked').value).toBe('paypal');
  });

  it('preselects the country of the visitor', async () => {
    const document = await mount({ options: { country: 'DE' } });
    expect(visible(document)).toEqual(['bank_overseas']);
    const country = document.querySelector('[name="bank_country"]');
    expect(country.value).toBe('DE');
    expect(document.querySelector('#bank_overseas-bank_country-hint').textContent.trim()).toBe('Selected from your location');
    country.value = 'FR';
    country.dispatchEvent(new dom.window.Event('change'));
    expect(document.querySelector('#bank_overseas-bank_country-hint')).toBeNull();
  });

  it.each([
    ['IN', 'bank_india', ''],
    ['NP', 'bank_overseas', 'NP'],
    [null, 'bank_india', ''],
  ])('only preselects what applies to a visitor from %s', async (country, type, bankCountry) => {
    const document = await mount({ options: { country } });
    expect(visible(document)).toEqual([type]);
    expect(document.querySelector('[name="bank_country"]').value).toBe(bankCountry);
  });

  it('shows errors next to the fields and requires matching account numbers', async () => {
    const document = await mount();
    await submit(document);
    expect(document.querySelector('#bank_india-bank_ifsc_code-error').textContent).toBe('IFSC code is required');
    expect(requests).toHaveLength(1);
    fill(document, 'bank_india', { ...without(BANK_INDIA, 'bank_account_type'), bank_account_number_confirm: '98765432100' });
    await submit(document);
    expect(document.querySelector('#bank_india-bank_account_number_confirm-error').textContent).toBe('Account numbers do not match');
    expect(document.activeElement.name).toBe('bank_account_number_confirm');
    fill(document, 'bank_india', { bank_account_number_confirm: '98765432101' });
    expect(document.querySelectorAll('.field--invalid')).toHaveLength(0);
    await submit(document);
    expect(requests[1].url).toBe('/api/user/payment-method');
    expect(requests[1].body).toMatchObject({ type: 'bank_india', bank_ifsc_code: 'icic0000282', bank_account_type: 'Savings' });
    expect(Object.keys(requests[1].body)).not.toContain('bank_account_number_confirm');
    expect(Object.keys(requests[1].body)).not.toContain('bank_country');
    expect(alert).toHaveBeenCalledOnce();
    alert.mock.calls[0][2]();
    expect(Router.loadUrl).toHaveBeenCalledWith('/profile');
  });

  it('explains the limit instead of showing a form that cannot be saved', async () => {
    const document = await mount({ options: { count: 3 } });
    expect(document.querySelector('form')).toBeNull();
    expect(document.body.textContent).toContain('3 payment methods');
  });

  it('sends guests to the login page', async () => {
    await mount({ user: null });
    expect(Router.loadUrl).toHaveBeenCalledWith('/login?redirect=/add-payment-method');
    expect(requests).toHaveLength(0);
  });

  function without(object, key) {
    return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
  }
});
