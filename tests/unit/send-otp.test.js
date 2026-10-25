// @vitest-environment jsdom
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import tag from 'html-tag-js';

const { code } = transformSync(fs.readFileSync('client/components/sendOtp.js', 'utf8'), {
  configFile: false,
  babelrc: false,
  presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
  plugins: ['html-tag-js/jsx/jsx-to-tag.js', 'html-tag-js/jsx/syntax-parser.js'],
});
let button;
let email;
let errorText;
let ref;
let request;
beforeEach(() => {
  vi.useFakeTimers();
  email = 'first@example.com';
  errorText = { value: '' };
  ref = {};
  request = vi.fn(async () => ({ json: async () => ({}) }));
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    tag,
    Date,
    FormData,
    setInterval,
    clearInterval,
    fetch: (...args) => request(...args),
    require: (name) => {
      if (name === './sendOtp.scss') return {};
      throw new Error(`Unexpected import ${name}`);
    },
  });
  button = module.exports.default({ errorText, getEmail: () => email, ref });
  document.body.replaceChildren(button);
  ref.onref(button);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('uses a non-submit button and enforces a separate cooldown for each email', async () => {
  expect(button.type).toBe('button');
  await button.onclick({ currentTarget: button });
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe('Resend in 60s');
  email = 'second@example.com';
  ref.refresh();
  expect(button.disabled).toBe(false);
  await button.onclick({ currentTarget: button });
  expect(request).toHaveBeenCalledTimes(2);
  email = 'first@example.com';
  ref.refresh();
  expect(button.disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe('Send code');
});

it('blocks duplicate sends while pending and enables retry after errors', async () => {
  let resolve;
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const send = button.onclick;
  const pending = send({ currentTarget: button });
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe('Sending…');
  await send({ currentTarget: button });
  expect(request).toHaveBeenCalledOnce();
  resolve({ json: async () => ({ error: 'Try again later' }) });
  await pending;
  expect(button.disabled).toBe(false);
  expect(errorText.value).toBe('Try again later');
});

it('does not request a code for an empty or invalid email', async () => {
  email = '';
  await button.onclick({ currentTarget: button });
  expect(errorText.value).toBe('Email is required');
  const form = document.createElement('form');
  form.innerHTML = '<input type="email" value="invalid">';
  form.append(button);
  document.body.append(form);
  email = 'invalid';
  await button.onclick({ currentTarget: button });
  expect(request).not.toHaveBeenCalled();
});

it('preserves autofilled email casing for verification and allows retry after a network failure', async () => {
  const form = document.createElement('form');
  form.innerHTML = '<input type="email" name="email" value="Filled@Example.com">';
  form.append(button);
  document.body.replaceChildren(form);
  email = '';
  request.mockRejectedValueOnce(new Error('Network unavailable'));
  await button.onclick({ currentTarget: button });
  expect(request.mock.calls[0][1].body.get('email')).toBe(new FormData(form).get('email'));
  expect(errorText.value).toBe('Network unavailable');
  expect(button.disabled).toBe(false);
  await button.onclick({ currentTarget: button });
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe('Resend in 60s');
  expect(errorText.value).toBe('');
  form.querySelector('input').value = 'filled@example.com';
  ref.refresh();
  expect(button.disabled).toBe(true);
});
