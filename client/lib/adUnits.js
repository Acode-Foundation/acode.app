const AD_SELECTOR = '[data-acode-ad] > ins.adsbygoogle';
const LOADING_TIMEOUT = 10_000;

/** Observe manual ad units across SPA navigation and asynchronously mounted tabs. */
export function observeAdUnits(root) {
  const requested = new WeakSet();
  const pending = new Set();
  const loadingDeadlines = new WeakMap();
  const loadingTimers = new Map();
  let disposed = false;
  const sizes = new ResizeObserver((entries) => {
    for (const { target } of entries) request(target);
  });
  const changes = new MutationObserver((records) => {
    if (disposed) return;
    if (records.some(({ type }) => type === 'childList')) sync();
    for (const { type, target } of records) {
      if (type === 'attributes' && target.matches(AD_SELECTOR)) updateStatus(target);
    }
  });

  changes.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ad-status'] });
  sync();

  return () => {
    disposed = true;
    changes.disconnect();
    sizes.disconnect();
    pending.clear();
    for (const unit of loadingTimers.keys()) hideLoading(unit);
  };

  function hideLoading(unit) {
    clearTimeout(loadingTimers.get(unit));
    loadingTimers.delete(unit);
    const loader = unit.parentElement?.querySelector(':scope > .dots-loading');
    if (loader) loader.style.display = 'none';
  }

  function finishLoading(unit) {
    loadingDeadlines.set(unit, 0);
    hideLoading(unit);
  }

  function showLoading(unit) {
    if (loadingTimers.has(unit)) return;
    // Keep the original deadline when a tab removes and remounts the same unit.
    const deadline = loadingDeadlines.get(unit) ?? Date.now() + LOADING_TIMEOUT;
    loadingDeadlines.set(unit, deadline);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      finishLoading(unit);
      return;
    }
    const loader = unit.parentElement?.querySelector(':scope > .dots-loading');
    if (loader) loader.style.display = '';
    loadingTimers.set(
      unit,
      setTimeout(() => finishLoading(unit), remaining),
    );
  }

  function updateStatus(unit) {
    const status = unit.getAttribute('data-ad-status');
    if (status !== 'filled' && status !== 'unfilled') return;
    finishLoading(unit);
    // Leave Google's ad contents alone; collapse only our empty placement.
    if (unit.parentElement) unit.parentElement.hidden = status === 'unfilled';
  }

  function forget(unit) {
    sizes.unobserve(unit);
    pending.delete(unit);
  }

  function isRequested(unit) {
    return requested.has(unit) || unit.hasAttribute('data-adsbygoogle-status') || unit.hasAttribute('data-ad-status');
  }

  function request(unit) {
    if (disposed || !pending.has(unit)) return;
    if (!unit.isConnected || !root.contains(unit)) {
      hideLoading(unit);
      forget(unit);
      return;
    }
    if (isRequested(unit)) {
      forget(unit);
      return;
    }
    if (unit.getBoundingClientRect().width <= 0) return;

    // Mark before push: Google may synchronously mutate the unit or throw.
    requested.add(unit);
    forget(unit);
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch {
      finishLoading(unit);
      unit.parentElement.hidden = true;
      console.warn('AdSense could not initialize an ad unit.');
    }
  }

  function sync() {
    if (disposed) return;
    for (const unit of loadingTimers.keys()) {
      if (!unit.isConnected || !root.contains(unit)) hideLoading(unit);
    }
    for (const unit of pending) {
      if (!unit.isConnected || !root.contains(unit)) forget(unit);
    }
    for (const unit of root.querySelectorAll(AD_SELECTOR)) {
      if (!unit.isConnected) continue;
      showLoading(unit);
      updateStatus(unit);
      if (isRequested(unit)) {
        forget(unit);
        continue;
      }
      if (!pending.has(unit)) {
        pending.add(unit);
        sizes.observe(unit);
      }
      request(unit);
    }
  }
}
