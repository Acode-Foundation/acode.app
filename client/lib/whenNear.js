// Run once when a section approaches the viewport; dispose with its page lifecycle.
export function whenNear(element, callback, signal) {
  if (!element || signal.aborted) return;
  if (typeof IntersectionObserver !== 'function') return callback();
  let started = false;
  const observer = new IntersectionObserver(
    (entries) => {
      if (started || !entries.some((entry) => entry.isIntersecting)) return;
      started = true;
      observer.disconnect();
      if (!signal.aborted) callback();
    },
    { rootMargin: '300px' },
  );
  observer.observe(element);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
}
