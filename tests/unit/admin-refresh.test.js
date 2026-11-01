// @vitest-environment jsdom
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import tag from 'html-tag-js';
import Ref from 'html-tag-js/ref';
import createRefreshButton from '../../client/components/refreshButton';
import { createChartSafely } from '../../client/lib/dashboardCharts';

// Render the actual dashboard without importing admin APIs or opening a database.
const source = fs.readFileSync('client/pages/admin/index.js', 'utf8');
const { code } = transformSync(
  `${source.slice(source.indexOf('function Dashboard('), source.indexOf('function lineChartConfig('))}\nmodule.exports = Dashboard;`,
  {
    configFile: false,
    babelrc: false,
    plugins: ['html-tag-js/jsx/jsx-to-tag.js', 'html-tag-js/jsx/syntax-parser.js'],
  },
);
let lifecycle;
let root;
let charts;
let finish;

beforeEach(async () => {
  lifecycle = new AbortController();
  charts = new Map();
  class Chart {
    constructor(canvas, config) {
      this.config = config;
      this.update = vi.fn();
      this.destroy = vi.fn(() => charts.delete(canvas));
      charts.set(canvas, this);
    }
    static getChart(canvas) {
      return charts.get(canvas);
    }
  }
  const config = () => ({ options: {} });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    tag,
    Ref,
    Chart,
    createRefreshButton,
    createChartSafely,
    console,
    document,
    fetch: (...args) => fetch(...args),
    Card: ({ title, value }) => tag('div', { textContent: `${title}: ${value}` }),
    lineChartConfig: config,
    horizontalBarChartConfig: config,
    providerStatusChartConfig: config,
    doughnutChartConfig: config,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ users: 10 }) })),
  );
  root = module.exports({ signal: lifecycle.signal });
  document.body.replaceChildren(root);
  await vi.waitFor(() => expect(root.querySelectorAll('canvas')).toHaveLength(6));
});

afterEach(() => {
  lifecycle.abort();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function startRefresh() {
  fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  root.refreshButton.click();
}

it('keeps content while refreshing and updates the existing charts without replaying their animations', async () => {
  const grid = root.firstElementChild;
  const previous = [...charts.values()];
  startRefresh();
  document.dispatchEvent(new Event('visibilitychange'));
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(root.firstElementChild).toBe(grid);
  finish({ ok: true, json: async () => ({ users: 20 }) });
  await vi.waitFor(() => expect(root.textContent).toContain('Total Users: 20'));
  expect(root.querySelectorAll('.dashboard-grid')).toHaveLength(1);
  expect(charts.size).toBe(6);
  expect([...charts.values()]).toEqual(previous);
  expect(previous.every((chart) => chart.destroy.mock.calls.length === 0)).toBe(true);
  for (const chart of previous) expect(chart.update).toHaveBeenCalledWith('none');
});

it('keeps the last successful dashboard when a refresh request fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const grid = root.firstElementChild;
  startRefresh();
  finish({ ok: false });
  await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
  expect(root.firstElementChild).toBe(grid);
  expect(charts.size).toBe(6);
});

it('destroys charts and ignores late responses after leaving the page', async () => {
  startRefresh();
  lifecycle.abort();
  expect(charts.size).toBe(0);
  finish({ ok: true, json: async () => ({ users: 20 }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.textContent).toContain('Total Users: 10');
  expect(charts.size).toBe(0);
  window.dispatchEvent(new Event('focus'));
  expect(fetch).toHaveBeenCalledTimes(6);
});

it('recovers a failed chart in its original canvas and cleans it up on navigation', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const canvas = root.querySelector('canvas');
  const original = charts.get(canvas);
  original.update.mockImplementationOnce(() => {
    throw new Error('Chart failed');
  });
  root.refreshButton.click();
  await vi.advanceTimersByTimeAsync(500);
  expect(original.destroy).toHaveBeenCalledOnce();
  expect(canvas.isConnected).toBe(true);
  expect(canvas.parentElement.classList.contains('chart-container--error')).toBe(true);
  expect(canvas.parentElement.querySelector('.chart-error').textContent).toBe('Chart unavailable');
  await vi.advanceTimersByTimeAsync(5000);
  root.refreshButton.click();
  await vi.advanceTimersByTimeAsync(500);
  expect(canvas.parentElement.querySelector('.chart-error')).toBeNull();
  expect(canvas.parentElement.classList.contains('chart-container--error')).toBe(false);
  expect(charts.get(canvas)).toBeDefined();
  expect(charts.size).toBe(6);
  lifecycle.abort();
  expect(charts.size).toBe(0);
});
