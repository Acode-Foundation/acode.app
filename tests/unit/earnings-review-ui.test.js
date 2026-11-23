import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transformAsync } from '@babel/core';
import { JSDOM } from 'jsdom';
import moment from 'moment';

const root = path.resolve(import.meta.dirname, '../..');
const compiled = new Map();
const files = ['pages/earnings/index.js', 'pages/user/dashboard.js', 'components/MonthSelect.js', 'components/YearSelect.js', 'lib/formatNumber.js'];
let dom;

beforeAll(async () => {
  await Promise.all(
    files.map(async (file) => {
      const filename = path.join(root, 'client', file);
      const { code } = await transformAsync(fs.readFileSync(filename, 'utf8'), {
        filename,
        babelrc: false,
        configFile: false,
        presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
        plugins: ['html-tag-js/jsx/syntax-parser.js', 'html-tag-js/jsx/jsx-to-tag.js'],
      });
      compiled.set(file, code);
    }),
  );
});
afterEach(() => dom?.window.close());

function mount(fetch) {
  dom = new JSDOM('', { runScripts: 'outside-only', url: 'https://example.invalid' });
  const context = dom.getInternalVMContext();
  const charts = [];
  class Chart {
    static defaults = { font: {} };
    constructor(_canvas, config) {
      charts.push(config);
    }
  }
  const dependencies = {
    moment,
    './style.scss': {},
    'components/dialogs/alert': vi.fn(),
    'lib/helpers': { showLoading: vi.fn(), hideLoading: vi.fn() },
    'lib/Router': {},
    'lib/dashboardCharts': {
      createChartLifecycle: () => ({ track() {} }),
      createChartSafely: ({ createChart }) => createChart(),
      drawCrosshair() {},
    },
    'chart.js/auto': Chart,
  };
  function evaluate(code) {
    const module = { exports: {} };
    context.module = module;
    context.exports = module.exports;
    vm.runInContext(code, context);
    return module.exports;
  }
  Object.assign(context, {
    fetch,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
      return dependencies[name];
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('html-tag-js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('html-tag-js/dist/polyfill'), 'utf8'), context);
  for (const name of ['html-tag-js/ref', 'html-tag-js/reactive']) dependencies[name] = evaluate(fs.readFileSync(require.resolve(name), 'utf8'));
  for (const file of ['components/MonthSelect.js', 'components/YearSelect.js', 'lib/formatNumber.js'])
    dependencies[file.slice(0, -3)] = evaluate(compiled.get(file));
  return { render: (file, props) => evaluate(compiled.get(file)).default(props), charts };
}

const reply = (body, status = 200) => ({ status, json: async () => body });

it.each([409, 503])('keeps payment history and month selection when the unpaid request fails (%s)', async (status) => {
  const fetch = vi.fn(async (url) => {
    if (url.includes('/unpaid-earnings')) return reply({ error: 'Accounting unavailable' }, status);
    if (url.includes('/payments/'))
      return reply([{ id: 1, created_at: '2026-01-15', amount: 123, bank_name: 'Fixture Bank', bank_account_number: 'XXX1', status: 'paid' }]);
    if (url.includes('/earnings/')) return reply({ earnings: 42 });
    throw new Error(`Unexpected URL ${url}`);
  });
  const { render } = mount(fetch);
  dom.window.document.body.append(await render('pages/earnings/index.js', { user: 7 }));
  await vi.waitFor(() => expect(dom.window.document.querySelector('.payments tbody').textContent).toContain('Fixture Bank'));
  expect(dom.window.document.querySelectorAll('.info select')).toHaveLength(2);
  expect(dom.window.document.querySelector('.info').textContent).toContain(status === 409 ? 'Earnings under review' : 'Accounting unavailable');
  expect(dom.window.document.querySelector('.payments button').title).toBe('download');
  const month = dom.window.document.querySelector('[name="month"]');
  month.value = '0';
  month.dispatchEvent(new dom.window.Event('change'));
  await vi.waitFor(() => expect(dom.window.document.querySelector('[title="Your earnings"]').textContent).toBe('₹ 42'));
});

it('shows a held monthly amount as text without a currency prefix or zero', async () => {
  const { render } = mount(async (url) => {
    if (url.includes('/unpaid-earnings')) return reply({ earnings: 10, threshold: 12345, from: '2026-01-01', to: '2026-01-31' });
    if (url.includes('/payments/')) return reply([]);
    return reply({ error: 'Missing INR' }, 409);
  });
  dom.window.document.body.append(await render('pages/earnings/index.js', { user: 7 }));
  await vi.waitFor(() => expect(dom.window.document.querySelector('[title="Your earnings"]').textContent).toBe('Earnings under review'));
  expect(dom.window.document.querySelector('.info').textContent).toContain('12,345');
});

it('keeps dashboard statistics, settled chart values, and payment methods visible during a hold', async () => {
  const { render, charts } = mount(async () => reply({ error: 'Missing INR' }, 409));
  const stats = {
    range: 30,
    totals: { plugins: 1, paidPlugins: 1, downloads: 42, recentDownloads: 5, previousDownloads: 3, lifetimeEarnings: null },
    monthly: [
      { year: 2026, month: 7, amount: 75, paid: true },
      { year: 2026, month: 8, amount: 0, paid: true },
      { year: 2026, month: 9, amount: 12, estimated: true },
      { year: 2026, month: 10, amount: null },
      { year: 2026, month: 11, amount: null, reviewRequired: true },
    ],
    plugins: [],
    daily: [],
  };
  const paymentMethods = dom.window.document.createElement('div');
  paymentMethods.textContent = 'Fixture bank account';
  dom.window.document.body.append(await render('pages/user/dashboard.js', { user: { id: 7 }, stats, isSelf: true, paymentMethods }));
  await vi.waitFor(() => expect(dom.window.document.querySelector('.payout').textContent).toContain('Earnings under review'));
  expect(dom.window.document.querySelector('.payout').textContent).toContain('Fixture bank account');
  expect(dom.window.document.querySelector('.payout a').getAttribute('href')).toBe('/earnings?user=7');
  const values = [...dom.window.document.querySelectorAll('.stat-value')].map((node) => node.textContent.trim());
  expect(values).toEqual(['—', '—', '5', '42']);
  await vi.waitFor(() => expect(charts).toHaveLength(2));
  expect(charts[1].data.datasets[0].data).toEqual([75, 0, 12, null, null]);
  const tooltipLabel = charts[1].options.plugins.tooltip.callbacks.label;
  expect(tooltipLabel({ dataIndex: 0, raw: 75 })).toBe('₹75.00 · paid');
  expect(tooltipLabel({ dataIndex: 1, raw: 0 })).toBe('₹0.00 · paid');
  expect(tooltipLabel({ dataIndex: 2, raw: 12 })).toBe('₹12.00 (estimated)');
  expect(tooltipLabel({ dataIndex: 3, raw: null })).toBe('Earnings unavailable');
  expect(tooltipLabel({ dataIndex: 4, raw: null })).toBe('Earnings under review');
});
