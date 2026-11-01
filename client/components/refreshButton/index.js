import './style.scss';

export default function createRefreshButton({ label, onRefresh, signal, canRefresh = () => true }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'refresh-button';
  button.innerHTML = `<span class="icon refresh refresh-button-arrow" aria-hidden="true"></span>
    <svg class="refresh-button-loader" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" pathLength="100"/></svg>
    <span class="icon done refresh-button-check" aria-hidden="true"></span>
    <span class="refresh-button-status" role="status"></span>`;
  const status = button.querySelector('[role=status]');
  let pending = false;
  let resetTimer;
  let cooldownTimer;
  let nextRefreshAt = 0;
  setState('idle');
  button.onclick = () => run();
  signal?.addEventListener(
    'abort',
    () => {
      clearTimeout(resetTimer);
      clearTimeout(cooldownTimer);
      updateDisabled();
    },
    { once: true },
  );
  return { button, run, updateDisabled };

  function updateDisabled() {
    button.disabled = pending || Date.now() < nextRefreshAt || signal?.aborted || !canRefresh();
  }

  function setState(state) {
    button.dataset.state = state;
    const message = { idle: label, loading: 'Refreshing…', success: 'Updated', error: 'Refresh failed. Try again shortly.' }[state];
    button.setAttribute('aria-label', message);
    button.setAttribute('aria-busy', String(state === 'loading'));
    button.title = message;
    status.textContent = state === 'idle' ? '' : message;
    updateDisabled();
  }

  async function run(feedback = true) {
    if (pending || Date.now() < nextRefreshAt || signal?.aborted || !canRefresh()) return;
    pending = true;
    clearTimeout(resetTimer);
    setState('loading');
    const started = Date.now();
    let success = false;
    try {
      success = (await onRefresh()) === true;
    } catch (error) {
      if (error?.name !== 'AbortError') console.error('Failed to refresh', error);
    }
    // Keep the loader visible briefly even for a cached response.
    if (feedback) await new Promise((resolve) => setTimeout(resolve, Math.max(0, 500 - (Date.now() - started))));
    pending = false;
    if (signal?.aborted) return;
    if (feedback) nextRefreshAt = Date.now() + 5000;
    const result = success ? 'success' : 'error';
    setState(feedback ? result : 'idle');
    if (feedback) {
      resetTimer = setTimeout(() => setState('idle'), 1400);
      cooldownTimer = setTimeout(updateDisabled, 5000);
    }
  }
}
