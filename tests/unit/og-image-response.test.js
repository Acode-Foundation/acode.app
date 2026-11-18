const { once } = require('node:events');
const express = require('express');
const { createOgImageHandler, createGenerationQueue, OG_CACHE_MS, OG_CACHE_CONTROL } = require('../../server/lib/ogImageResponse');
const { markTemporaryImage } = require('../../server/lib/ogImageCachePolicy');

let now;
beforeEach(() => {
  now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

function request(handler, { id = 'test.plugin', etag, query = {} } = {}) {
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send: vi.fn(),
    end: vi.fn(),
  };
  const next = vi.fn();
  const done = handler(
    {
      params: { id },
      query,
      headers: { 'if-none-match': etag },
      get fresh() {
        return Boolean(etag && etag === headers.ETag);
      },
    },
    res,
    next,
  );
  return { res, headers, next, done };
}

it('deduplicates cold generation and serves fresh images without invoking the loader', async () => {
  const pending = Promise.withResolvers();
  const load = vi.fn(() => pending.promise);
  const handler = createOgImageHandler(load);
  const first = request(handler);
  const second = request(handler);
  expect(first.res.send).not.toHaveBeenCalled();
  pending.resolve(Buffer.from('first image'));
  await Promise.all([first.done, second.done]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(second.res.send).toHaveBeenCalledWith(Buffer.from('first image'));
  now += OG_CACHE_MS - 1;
  const cached = request(handler, { etag: first.headers.ETag });
  await cached.done;
  expect(cached.res.statusCode).toBe(304);
  expect(cached.headers).toMatchObject({ 'Cache-Control': OG_CACHE_CONTROL, ETag: first.headers.ETag, Age: '172799' });
  expect(load).toHaveBeenCalledTimes(1);
});

it('serves stale images immediately during one background refresh and then serves the replacement', async () => {
  const pending = Promise.withResolvers();
  const load = vi
    .fn()
    .mockResolvedValueOnce(Buffer.from('old'))
    .mockImplementation(() => pending.promise);
  const handler = createOgImageHandler(load);
  const first = request(handler);
  await first.done;
  now += OG_CACHE_MS;
  const stale = request(handler);
  const concurrent = request(handler, { etag: first.headers.ETag });
  await Promise.all([stale.done, concurrent.done]);
  // The refresh promise is still unresolved, yet both responses have completed.
  expect(stale.res.send).toHaveBeenCalledWith(Buffer.from('old'));
  expect(concurrent.res.statusCode).toBe(304);
  expect(stale.headers.Age).toBe('172800');
  expect(load).toHaveBeenCalledTimes(2);
  pending.resolve(Buffer.from('new'));
  await vi.waitFor(async () => {
    const fresh = request(handler);
    await fresh.done;
    expect(fresh.res.send).toHaveBeenCalledWith(Buffer.from('new'));
    expect(fresh.headers.ETag).not.toBe(first.headers.ETag);
    expect(fresh.headers.Age).toBe('0');
  });
  expect(load).toHaveBeenCalledTimes(2);
});

it('retains a good image on refresh failure and backs off before retrying', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const load = vi.fn().mockResolvedValueOnce(Buffer.from('good')).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Buffer.from('new'));
  const handler = createOgImageHandler(load);
  await request(handler).done;
  now += OG_CACHE_MS;
  await request(handler).done;
  await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
  now += 59000;
  const stale = request(handler);
  await stale.done;
  expect(stale.res.send).toHaveBeenCalledWith(Buffer.from('good'));
  expect(load).toHaveBeenCalledTimes(2);
  now += 1000;
  await request(handler).done;
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
});

it('removes a cached plugin after the refresh reports it is no longer public', async () => {
  const load = vi.fn().mockResolvedValueOnce(Buffer.from('approved')).mockResolvedValue(null);
  const handler = createOgImageHandler(load);
  await request(handler).done;
  now += OG_CACHE_MS;
  await request(handler).done;
  await vi.waitFor(async () => {
    const missing = request(handler);
    await missing.done;
    expect(missing.res.statusCode).toBe(404);
    expect(missing.headers['Cache-Control']).toBe('no-store');
    expect(missing.headers['X-Content-Type-Options']).toBe('nosniff');
  });
});

it('does not cache cold failures and retries successfully on the next request', async () => {
  const error = new Error('offline');
  const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(Buffer.from('recovered'));
  const handler = createOgImageHandler(load);
  const failed = request(handler);
  await failed.done;
  expect(failed.next).toHaveBeenCalledWith(error);
  expect(failed.headers['Cache-Control']).toBe('no-store');
  const recovered = request(handler);
  await recovered.done;
  expect(recovered.res.send).toHaveBeenCalledWith(Buffer.from('recovered'));
});

it('bounds the cache and keeps recently used plugins when evicting old entries', async () => {
  const load = vi.fn(async (req) => Buffer.from(req.params.id));
  const handler = createOgImageHandler(load);
  for (let index = 0; index < 100; index++) await request(handler, { id: String(index) }).done;
  await request(handler, { id: '0' }).done;
  await request(handler, { id: '100' }).done;
  await request(handler, { id: '0' }).done;
  expect(load).toHaveBeenCalledTimes(101);
  await request(handler, { id: '1' }).done;
  expect(load).toHaveBeenCalledTimes(102);
});

it('evicts by image bytes and serves oversized images without retaining them', async () => {
  const load = vi.fn(async (req) => Buffer.alloc(req.params.id === 'large' ? 12 : 4));
  const handler = createOgImageHandler(load, undefined, { maxBytes: 8 });
  for (const id of ['a', 'b', 'a', 'c', 'a']) await request(handler, { id }).done;
  expect(load).toHaveBeenCalledTimes(3);
  await request(handler, { id: 'b' }).done;
  expect(load).toHaveBeenCalledTimes(4);
  await request(handler, { id: 'large' }).done;
  await request(handler, { id: 'large' }).done;
  expect(load).toHaveBeenCalledTimes(6);
  await request(handler, { id: 'a' }).done;
  expect(load).toHaveBeenCalledTimes(6);
});

it('retries temporary asset fallback images after one minute without caching them downstream', async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce(markTemporaryImage(Buffer.from('fallback')))
    .mockResolvedValue(Buffer.from('repaired'));
  const handler = createOgImageHandler(load);
  const fallback = request(handler);
  await fallback.done;
  expect(fallback.headers['Cache-Control']).toBe('no-store');
  now += 60000;
  await request(handler).done;
  await vi.waitFor(async () => {
    const repaired = request(handler);
    await repaired.done;
    expect(repaired.res.send).toHaveBeenCalledWith(Buffer.from('repaired'));
    expect(repaired.headers['Cache-Control']).toBe(OG_CACHE_CONTROL);
  });
  expect(load).toHaveBeenCalledTimes(2);
});

it('keeps the two-day origin cache policy even when callers change v/r query parameters', async () => {
  const load = vi.fn(async () => Buffer.from('cached'));
  const handler = createOgImageHandler(load);
  await request(handler, { query: { v: '1.0.0', r: '5' } }).done;
  for (const query of [{ v: '1.0.1' }, { v: 'arbitrary', r: '9999' }, {}]) {
    await request(handler, { query }).done;
  }
  expect(load).toHaveBeenCalledTimes(1);
});

it('bounds concurrent and queued work, rejects overload, and releases slots after failure', async () => {
  const generate = createGenerationQueue(2, 1);
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const started = vi.fn();
  const a = generate(() => {
    started();
    return first.promise;
  });
  const b = generate(() => {
    started();
    return second.promise;
  });
  const c = generate(() => {
    started();
    throw new Error('render failed');
  });
  const rejected = expect(c).rejects.toThrow('render failed');
  await expect(generate(() => 'overload')).rejects.toMatchObject({ status: 503 });
  expect(started).toHaveBeenCalledTimes(2);
  first.resolve('first');
  await a;
  await rejected;
  expect(started).toHaveBeenCalledTimes(3);
  second.resolve('second');
  await b;
  expect(await generate(() => 'recovered')).toBe('recovered');
});

it('deduplicates and caches a cold fallback for one minute before background recovery', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Buffer.from('recovered'));
  const fallback = vi.fn(async () => Buffer.from('fallback'));
  const handler = createOgImageHandler(load, fallback);
  await Promise.all([request(handler).done, request(handler).done]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(fallback).toHaveBeenCalledTimes(1);
  now += 59999;
  const cached = request(handler);
  await cached.done;
  expect(cached.res.send).toHaveBeenCalledWith(Buffer.from('fallback'));
  expect(cached.headers['Cache-Control']).toBe('no-store');
  expect(load).toHaveBeenCalledTimes(1);
  now += 1;
  await request(handler).done;
  await vi.waitFor(async () => {
    const recovered = request(handler);
    await recovered.done;
    expect(recovered.res.send).toHaveBeenCalledWith(Buffer.from('recovered'));
  });
});

it('returns retryable 503 on generation overload while cached images remain available', async () => {
  const pending = Promise.withResolvers();
  const load = vi
    .fn()
    .mockResolvedValueOnce(Buffer.from('warm'))
    .mockImplementation(() => pending.promise);
  const handler = createOgImageHandler(load);
  await request(handler, { id: 'warm' }).done;
  const cold = Array.from({ length: 18 }, (_, index) => request(handler, { id: `cold-${index}` }));
  try {
    const busy = request(handler, { id: 'overflow' });
    await busy.done;
    expect(busy.res.statusCode).toBe(503);
    expect(busy.headers).toMatchObject({ 'Cache-Control': 'no-store', 'Retry-After': '5' });
    expect(busy.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(load).toHaveBeenCalledTimes(3); // warm entry + two active cold renders
    const warm = request(handler, { id: 'warm' });
    await warm.done;
    expect(warm.res.send).toHaveBeenCalledWith(Buffer.from('warm'));
  } finally {
    pending.resolve(Buffer.from('cold'));
    await Promise.all(cold.map(({ done }) => done));
  }
});

it('preserves real Express GET, conditional GET and HEAD response semantics', async () => {
  const load = vi.fn(async () => Buffer.from('image'));
  const app = express();
  app.get('/og/plugin/:id.png', createOgImageHandler(load));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/og/plugin/test.plugin.png`;
    const first = await fetch(url);
    expect(first.headers.get('content-type')).toContain('image/png');
    expect(first.headers.get('cache-control')).toBe(OG_CACHE_CONTROL);
    const headers = { 'If-None-Match': first.headers.get('etag'), 'Cache-Control': 'max-age=0' };
    const unchanged = await fetch(url, { headers });
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get('etag')).toBe(headers['If-None-Match']);
    expect(unchanged.headers.has('content-type')).toBe(false);
    expect(await unchanged.text()).toBe('');
    const head = await fetch(url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('5');
    expect(await head.text()).toBe('');
    for (const validator of ['*', `W/${headers['If-None-Match']}`, `"other", ${headers['If-None-Match']}`]) {
      const conditional = await fetch(url, { headers: { ...headers, 'If-None-Match': validator } });
      expect(conditional.status).toBe(304);
      expect(conditional.headers.has('content-type')).toBe(false);
    }
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

it('keeps timed-out renders deduplicated and caches their late success', async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const pending = Promise.withResolvers();
  const load = vi.fn(() => pending.promise);
  const handler = createOgImageHandler(load);
  try {
    const first = request(handler, { id: 'slow.plugin' });
    await vi.advanceTimersByTimeAsync(15000);
    await first.done;
    expect(first.res.statusCode).toBe(503);
    expect(first.headers).toMatchObject({ 'Retry-After': '15', 'X-Content-Type-Options': 'nosniff' });
    expect(log).toHaveBeenCalledWith(expect.any(String), { label: 'OG [slow.plugin]' });
    await request(handler, { id: 'slow.plugin' }).done;
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve(Buffer.from('late image'));
    await vi.advanceTimersByTimeAsync(0);
    const cached = request(handler, { id: 'slow.plugin' });
    await cached.done;
    expect(cached.res.statusCode).toBe(200);
    expect(cached.res.send).toHaveBeenCalledWith(Buffer.from('late image'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    pending.resolve(Buffer.from('late image'));
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  }
});

it.each(['resolve', 'reject'])('keeps timed-out work in its slot until late %s, then admits queued work', async (settle) => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const generate = createGenerationQueue(1, 1, 15000);
    const late = Promise.withResolvers();
    const first = generate(() => late.promise);
    const timedOut = expect(first).rejects.toMatchObject({ status: 503, message: 'OG generation timed out' });
    await vi.advanceTimersByTimeAsync(15000);
    await timedOut;
    expect(log).toHaveBeenCalledExactlyOnceWith('OG generation timed out; render slot held until work settles', { label: 'OG' });
    const next = Promise.withResolvers();
    const nextWork = vi.fn(() => next.promise);
    const second = generate(nextWork);
    await Promise.resolve();
    expect(nextWork).not.toHaveBeenCalled();
    await expect(generate(() => 'overload')).rejects.toMatchObject({ status: 503 });
    late[settle](settle === 'resolve' ? 'too late' : new Error('late failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(nextWork).toHaveBeenCalledTimes(1);
    const queuedWork = vi.fn(() => 'queued');
    const queued = generate(queuedWork);
    expect(queuedWork).not.toHaveBeenCalled();
    next.resolve('next');
    expect(await second).toBe('next');
    expect(await queued).toBe('queued');
    expect(log).toHaveBeenCalledTimes(settle === 'reject' ? 2 : 1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('counts waiting time toward the deadline and never runs expired queued work', async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const generate = createGenerationQueue(1, 1, 15000);
    const active = Promise.withResolvers();
    const hung = generate(() => active.promise);
    const timedOut = expect(hung).rejects.toMatchObject({ status: 503 });
    const queuedWork = vi.fn(() => new Promise(() => {}));
    const queued = generate(queuedWork);
    const queuedTimeout = expect(queued).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(15000);
    await Promise.all([timedOut, queuedTimeout]);
    expect(log).toHaveBeenCalledTimes(1); // Only active work logs, not expired waiting jobs.
    expect(queuedWork).not.toHaveBeenCalled();
    const recoveryWork = vi.fn(() => 'recovered');
    const recovery = generate(recoveryWork);
    await Promise.resolve();
    expect(recoveryWork).not.toHaveBeenCalled();
    active.resolve('late');
    expect(await recovery).toBe('recovered');
    expect(queuedWork).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
