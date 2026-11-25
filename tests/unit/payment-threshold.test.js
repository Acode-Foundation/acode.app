import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transformAsync } from '@babel/core';
import { Router } from 'express';
import { JSDOM } from 'jsdom';
import { PAYMENT_THRESHOLD } from '../../constants.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const tagSource = fs.readFileSync(require.resolve('html-tag-js'), 'utf8');
let termsCode;
let policyCode;
let configuredThreshold;
let settings;
let endpoint;

function load(file, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    module,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

beforeAll(async () => {
  async function compile(file) {
    const filename = path.join(root, file);
    const { code } = await transformAsync(fs.readFileSync(filename, 'utf8'), {
      filename,
      babelrc: false,
      configFile: false,
      presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
      plugins: ['html-tag-js/jsx/syntax-parser.js', 'html-tag-js/jsx/jsx-to-tag.js'],
    });
    return code;
  }
  [termsCode, policyCode] = await Promise.all([compile('client/pages/termsOfService/index.js'), compile('client/components/policyPage/index.js')]);
});

beforeEach(() => {
  configuredThreshold = '10000';
  settings = load('server/entities/appConfig.js', {
    './entity': class {
      insertOrIgnore() {}
      async get() {
        return configuredThreshold === null ? [] : [{ value: configuredThreshold }];
      }
    },
    '../../constants.mjs': { PAYMENT_THRESHOLD },
  });
  const dependencies = {
    express: { Router },
    'node:child_process': {},
    '../lib/db': {},
    '../entities/appConfig': settings,
  };
  const apiSource = fs.readFileSync(path.join(root, 'server/routes/apis.js'), 'utf8');
  for (const [, name] of apiSource.matchAll(/require\('(\.\.\/apis\/[^']+)'\)/g)) dependencies[name] = Router();
  const router = load('server/routes/apis.js', dependencies);
  endpoint = router.stack.find((layer) => layer.route?.path === '/payment-threshold').route.stack[0].handle;
});

async function requestThreshold() {
  let body;
  const res = { statusCode: 200, set: vi.fn(), json: (value) => (body = value) };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  await endpoint({}, res);
  return { res, body };
}

async function renderTerms(fetch, onrender) {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  try {
    const context = dom.getInternalVMContext();
    let policyPage;
    Object.assign(context, {
      exports: {},
      fetch,
      AbortController,
      setTimeout,
      clearTimeout,
      require(name) {
        if (name === 'components/policyPage') return policyPage;
        if (name !== './style.scss') throw new Error(`Unmocked dependency: ${name}`);
        return {};
      },
    });
    vm.runInContext(tagSource, context);
    vm.runInContext(policyCode, context);
    policyPage = context.exports;
    context.exports = {};
    vm.runInContext(termsCode, context);
    const page = await context.exports.default();
    onrender?.(page.outerHTML);
    await vi.waitFor(() => expect(page.textContent).not.toContain('loading…'));
    return page.outerHTML;
  } finally {
    dom.window.close();
  }
}

it('renders JSX Terms with the shared threshold fetched on the client and picks up setting changes', async () => {
  const fetch = vi.fn(async () => {
    const { res, body } = await requestThreshold();
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(body).toEqual({ threshold: await settings.getPaymentThreshold() });
    return { ok: res.statusCode === 200, json: async () => body };
  });
  expect(await renderTerms(fetch)).toContain('<strong>₹10,000 INR</strong>');
  configuredThreshold = '12345';
  const updated = await renderTerms(fetch);
  expect(updated).toContain('<strong>₹12,345 INR</strong>');
  expect(updated).not.toContain('₹10,000');
  expect(fetch).toHaveBeenLastCalledWith('/api/payment-threshold', { cache: 'no-store', signal: expect.any(AbortSignal) });
});

it('shows the Terms before the threshold has loaded', async () => {
  let initial;
  let respond;
  const rendered = renderTerms(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
    (html) => {
      initial = html;
      respond({ ok: true, json: async () => ({ threshold: 10000 }) });
    },
  );
  expect(await rendered).toContain('<strong>₹10,000 INR</strong>');
  expect(initial).toContain('Developers receive 85% of the reported net earnings');
  expect(initial).not.toContain('₹');
});

it('shares the existing payout fallback when the setting is missing', async () => {
  configuredThreshold = null;
  expect((await requestThreshold()).body).toEqual({ threshold: PAYMENT_THRESHOLD });
});

it('does not expose settings errors or cache an unavailable response', async () => {
  settings.getValue = async () => {
    throw new Error('Private database details');
  };
  const { res, body } = await requestThreshold();
  expect(res.statusCode).toBe(503);
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(body).toEqual({ error: 'Payment threshold temporarily unavailable.' });
});

it.each(['network', 'http', 'invalid'])('keeps Terms readable without a guessed threshold on %s failure', async (failure) => {
  const html = await renderTerms(async () => {
    if (failure === 'network') throw new Error('Offline');
    return { ok: failure !== 'http', json: async () => ({ threshold: '<script>bad</script>' }) };
  });
  expect(html).toContain('temporarily unavailable');
  expect(html).toContain('href="/earnings"');
  expect(html).toContain('Developers receive 85% of the reported net earnings');
  expect(html).toContain('Developers receive 70% of the original INR plugin price');
  expect(html).not.toMatch(/₹|PAYMENT_THRESHOLD|<\s*script\b/i);
});

it('aborts a stalled threshold response body and still renders Terms', async () => {
  vi.useFakeTimers();
  try {
    let signal;
    const rendered = renderTerms(async (_url, options) => {
      signal = options.signal;
      return { ok: true, json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')))) };
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await rendered).toContain('temporarily unavailable');
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
