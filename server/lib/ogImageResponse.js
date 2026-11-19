const crypto = require('node:crypto');
const { OG_CACHE_MS, RETRY_MS, CACHE_BYTES, isTemporaryImage } = require('./ogImageCachePolicy');

const OG_CACHE_CONTROL = `public, max-age=${OG_CACHE_MS / 1000}, stale-while-revalidate=86400`;
const CACHE_LIMIT = 100;
const BUSY_RETRY_SECONDS = 5;
const generate = createGenerationQueue();

// Bound both active render jobs and waiting requests across all OG routes.
function createGenerationQueue(concurrency = 2, queueLimit = 16, timeoutMs = 15000) {
  let active = 0;
  const queue = [];
  return (work, label = 'OG') =>
    new Promise((resolve, reject) => {
      let started = false;
      let finished = false;
      const deadline = Date.now() + timeoutMs;
      const timeoutError = () =>
        Object.assign(new Error('OG generation timed out'), { status: 503, code: 'OG_TIMEOUT', retryAfter: Math.ceil(timeoutMs / 1000) });
      const timer = setTimeout(() => {
        // One log per active job, including background refreshes; queue saturation stays quiet.
        if (started) console.error('OG generation timed out; render slot held until work settles', { label });
        finish(reject, timeoutError());
      }, timeoutMs);
      timer.unref?.();

      function finish(settle, value) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (!started) {
          const index = queue.indexOf(run);
          if (index !== -1) queue.splice(index, 1);
        }
        settle(value);
      }

      function complete(settle, value) {
        // A response deadline cannot cancel rendering; hold its slot until work settles.
        active--;
        if (finished && settle === reject) console.error('OG generation failed after its deadline', { label, error: value.message });
        finish(settle, value);
        queue.shift()?.();
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
            (value) => complete(resolve, value),
            (error) => complete(reject, error),
          );
      }
      if (active < concurrency) run();
      else if (queue.length < queueLimit) queue.push(run);
      else finish(reject, Object.assign(new Error('OG generation busy'), { status: 503, code: 'OG_BUSY', retryAfter: BUSY_RETRY_SECONDS }));
    });
}

// Each route has a bounded, process-local cache. Only a cold request waits for generation.
function createOgImageHandler(load, fallback, { maxBytes = CACHE_BYTES } = {}) {
  const cache = new Map();
  const pending = new Map();
  let cacheBytes = 0;

  function remove(key) {
    const previous = cache.get(key);
    if (previous) cacheBytes -= previous.image.length;
    cache.delete(key);
  }

  function imageEntry(image) {
    return { image, etag: `"${crypto.createHash('sha256').update(image).digest('hex')}"`, createdAt: Date.now(), retryAt: 0 };
  }

  function refresh(key, req) {
    if (pending.has(key)) return pending.get(key);
    let started = false;
    const label = `${req.route?.path || req.path || 'OG'} [${String(key).slice(0, 100)}]`;
    const task = generate(async () => {
      started = true;
      try {
        let image;
        let temporary = false;
        try {
          image = await load(req);
        } catch (error) {
          if (!fallback || cache.has(key)) throw error;
          image = await fallback();
          temporary = true;
        }
        if (!image) {
          // A removed/unapproved plugin must stop being served after revalidation.
          remove(key);
          return null;
        }
        const entry = { ...imageEntry(image), temporary: temporary || isTemporaryImage(image) };
        remove(key);
        // Cache late successes too; an expired HTTP response does not invalidate rendered work.
        if (image.length <= maxBytes) {
          cache.set(key, entry);
          cacheBytes += image.length;
          while (cache.size > CACHE_LIMIT || cacheBytes > maxBytes) remove(cache.keys().next().value);
        }
        return entry;
      } finally {
        pending.delete(key);
      }
    }, label);
    pending.set(key, task);
    // A running job retains deduplication after its response deadline until it actually settles.
    void task.catch(() => {
      if (!started) pending.delete(key);
    });
    return task;
  }

  return async function serveOgImage(req, res, next) {
    const key = req.params?.id || 'default';
    res.setHeader('X-Content-Type-Options', 'nosniff');
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
      res.setHeader('Cache-Control', entry.temporary ? 'no-store' : OG_CACHE_CONTROL);
      res.setHeader('Age', String(Math.max(0, Math.floor((Date.now() - entry.createdAt) / 1000))));
      res.setHeader('ETag', entry.etag);
      if (req.fresh) {
        res.status(304).end();
        return;
      }
      res.setHeader('Content-Type', 'image/png');
      res.send(entry.image);
    } catch (error) {
      res.setHeader('Cache-Control', 'no-store');
      if (error.status === 503) {
        res.setHeader('Retry-After', String(error.retryAfter || BUSY_RETRY_SECONDS));
        res.status(503).send({
          error: error.code === 'OG_TIMEOUT' ? 'Image generation timed out, please retry later.' : 'Image generation busy, please retry later.',
        });
        return;
      }
      next(error);
    }
  };
}

module.exports = { createOgImageHandler, createGenerationQueue, OG_CACHE_MS, OG_CACHE_CONTROL };
