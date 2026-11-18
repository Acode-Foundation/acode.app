const crypto = require('node:crypto');

const OG_CACHE_MS = 2 * 24 * 60 * 60 * 1000;
const OG_CACHE_CONTROL = `public, max-age=${OG_CACHE_MS / 1000}, stale-while-revalidate=86400`;
const CACHE_LIMIT = 100;
const RETRY_MS = 60 * 1000;
const BUSY_RETRY_SECONDS = 5;
const generate = createGenerationQueue();

// Bound both active Sharp work and waiting requests across all OG routes.
function createGenerationQueue(concurrency = 2, queueLimit = 16, timeoutMs = 15000) {
  let active = 0;
  const queue = [];
  return (work) =>
    new Promise((resolve, reject) => {
      let started = false;
      let finished = false;
      const deadline = Date.now() + timeoutMs;
      const timeoutError = () => Object.assign(new Error('OG generation timed out'), { status: 503 });
      const timer = setTimeout(() => finish(reject, timeoutError()), timeoutMs);
      timer.unref?.();

      function finish(settle, value) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (started) {
          active--;
          queue.shift()?.();
        } else {
          const index = queue.indexOf(run);
          if (index !== -1) queue.splice(index, 1);
        }
        settle(value);
      }

      function run() {
        if (Date.now() >= deadline) {
          finish(reject, timeoutError());
          queue.shift()?.();
          return;
        }
        started = true;
        active++;
        Promise.resolve()
          .then(work)
          .then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error),
          );
      }
      if (active < concurrency) run();
      else if (queue.length < queueLimit) queue.push(run);
      else finish(reject, Object.assign(new Error('OG generation busy'), { status: 503 }));
    });
}

// Each route has a bounded, process-local cache. Only a cold request waits for generation.
function createOgImageHandler(load, fallback) {
  const cache = new Map();
  const pending = new Map();

  function imageEntry(image) {
    return { image, etag: `"${crypto.createHash('sha256').update(image).digest('hex')}"`, createdAt: Date.now(), retryAt: 0 };
  }

  function refresh(key, req) {
    if (pending.has(key)) return pending.get(key);
    const task = generate(async () => {
      try {
        return { image: await load(req), temporary: false };
      } catch (error) {
        if (!fallback || cache.has(key)) throw error;
        return { image: await fallback(), temporary: true };
      }
    })
      .then(({ image, temporary }) => {
        if (!image) {
          // A removed/unapproved plugin must stop being served after revalidation.
          cache.delete(key);
          return null;
        }
        const entry = { ...imageEntry(image), temporary };
        cache.delete(key);
        cache.set(key, entry);
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
        return entry;
      })
      .finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  return async function serveOgImage(req, res, next) {
    const key = req.params?.id || 'default';
    try {
      let entry = cache.get(key);
      if (entry) {
        cache.delete(key);
        cache.set(key, entry);
        const lifetime = entry.temporary ? RETRY_MS : OG_CACHE_MS;
        if (Date.now() - entry.createdAt >= lifetime && Date.now() >= entry.retryAt && !pending.has(key)) {
          // Keep serving the last successful image if refresh fails; avoid retry storms.
          void refresh(key, req).catch((error) => {
            entry.retryAt = Date.now() + RETRY_MS;
            if (error.status !== 503) console.error('Failed to refresh OG image:', error);
          });
        }
      } else {
        entry = await refresh(key, req);
      }

      if (!entry) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(404).send({ error: 'Image not found' });
        return;
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', entry.temporary ? 'no-store' : OG_CACHE_CONTROL);
      res.setHeader('Age', String(Math.max(0, Math.floor((Date.now() - entry.createdAt) / 1000))));
      res.setHeader('ETag', entry.etag);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.headers['if-none-match'] === entry.etag) {
        res.status(304).end();
        return;
      }
      res.send(entry.image);
    } catch (error) {
      res.setHeader('Cache-Control', 'no-store');
      if (error.status === 503) {
        res.setHeader('Retry-After', String(BUSY_RETRY_SECONDS));
        res.status(503).send({ error: 'Image generation busy, please retry later.' });
        return;
      }
      next(error);
    }
  };
}

module.exports = { createOgImageHandler, createGenerationQueue, OG_CACHE_MS, OG_CACHE_CONTROL };
