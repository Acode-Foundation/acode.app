// @vitest-environment jsdom
import createRefreshButton from '../../client/components/refreshButton';

let lifecycle;
beforeEach(() => {
  vi.useFakeTimers();
  lifecycle = new AbortController();
});
afterEach(() => {
  lifecycle.abort();
  vi.useRealTimers();
});

it('spins for fast responses, shows a check, returns to idle, and coalesces repeated clicks', async () => {
  const load = vi.fn(async () => true);
  const { button, run } = createRefreshButton({ label: 'Refresh dashboard', onRefresh: load, signal: lifecycle.signal });
  const pending = run();
  button.click();
  expect(load).toHaveBeenCalledOnce();
  expect(button.dataset.state).toBe('loading');
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  await vi.advanceTimersByTimeAsync(499);
  expect(button.dataset.state).toBe('loading');
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(button.dataset.state).toBe('success');
  expect(button.getAttribute('aria-label')).toBe('Updated');
  expect(button.disabled).toBe(true);
  button.click();
  await run();
  expect(load).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1400);
  expect(button.dataset.state).toBe('idle');
  expect(button.getAttribute('aria-label')).toBe('Refresh dashboard');
  expect(button.disabled).toBe(true);
  await run();
  expect(load).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3600);
  expect(button.disabled).toBe(false);
  button.click();
  expect(load).toHaveBeenCalledTimes(2);
});

it('waits for the request and never shows a success check after failure', async () => {
  let finish;
  const { button, run } = createRefreshButton({
    label: 'Refresh promotions',
    signal: lifecycle.signal,
    onRefresh: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = run();
  await vi.advanceTimersByTimeAsync(2000);
  expect(button.dataset.state).toBe('loading');
  finish(false);
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(button.dataset.state).toBe('error');
  expect(button.title).toContain('Try again');
  expect(button.disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(1400);
  expect(button.dataset.state).toBe('idle');
  expect(button.disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(3600);
  expect(button.disabled).toBe(false);
});

it('does not refresh blocked or disposed views and clears the success reset on disposal', async () => {
  let allowed = false;
  const load = vi.fn(async () => true);
  const { button, run } = createRefreshButton({ label: 'Refresh', onRefresh: load, canRefresh: () => allowed, signal: lifecycle.signal });
  await run();
  expect(load).not.toHaveBeenCalled();
  allowed = true;
  const pending = run();
  await vi.advanceTimersByTimeAsync(500);
  await pending;
  lifecycle.abort();
  expect(vi.getTimerCount()).toBe(0);
  button.click();
  expect(load).toHaveBeenCalledOnce();
});
