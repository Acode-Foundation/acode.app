import fs from 'node:fs';
import vm from 'node:vm';

function loadTeam(fetch, { now = Date.now, abortSignal = AbortSignal } = {}) {
  let handler;
  vm.runInNewContext(fs.readFileSync(new URL('../../server/apis/team.js', import.meta.url), 'utf8'), {
    module: { exports: {} },
    require: () => ({
      Router: () => ({
        get: (_path, callback) => {
          handler = callback;
        },
      }),
    }),
    fetch,
    Date: { now },
    AbortSignal: abortSignal,
  });
  return async (status = 200) => {
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await handler({}, res);
    if (status === 200) expect(res.status).not.toHaveBeenCalled();
    else expect(res.status).toHaveBeenCalledWith(status);
    return res.json.mock.calls[0][0];
  };
}

it('includes additional teammates with GitHub profiles and caches the combined list', async () => {
  const fetch = vi.fn(async (url) => {
    if (url.endsWith('/public_members')) return { ok: true, json: async () => [{ login: 'deadlyjack' }] };
    const login = url.split('/').pop();
    return {
      ok: true,
      json: async () => ({
        login,
        name: `Name of ${login}`,
        avatar_url: `https://avatars.example/${login}`,
        html_url: `https://github.com/${login}`,
      }),
    };
  });
  const getTeam = loadTeam(fetch);
  const members = await getTeam();
  expect(members.map((member) => member.login)).toEqual(['deadlyjack', 'UnschooledGamer', 'Elitex07']);
  expect(members[1]).toMatchObject({
    name: 'Name of UnschooledGamer',
    avatar_url: 'https://avatars.example/UnschooledGamer',
    html_url: 'https://github.com/UnschooledGamer',
  });
  expect(members[2]).toMatchObject({
    name: 'Name of Elitex07',
    avatar_url: 'https://avatars.example/Elitex07',
    html_url: 'https://github.com/Elitex07',
  });
  fetch.mockClear();
  expect(await getTeam()).toEqual(members);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['network', 'http'])('avoids duplicate public members and retains cards after %s profile failures', async (failure) => {
  const publicMember = { login: 'unschooledgamer', avatar_url: 'https://avatars.example/existing', html_url: 'https://github.com/unschooledgamer' };
  const fetch = vi.fn(async (url) => {
    if (url.endsWith('/public_members')) return { ok: true, json: async () => [publicMember] };
    if (failure === 'http') return { ok: false, status: 503 };
    throw new Error('GitHub unavailable');
  });
  const members = await loadTeam(fetch)();
  expect(members).toEqual([
    publicMember,
    { login: 'Elitex07', avatar_url: 'https://github.com/Elitex07.png', html_url: 'https://github.com/Elitex07' },
  ]);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('refreshes an expired cache, serves stale members during failure backoff, and retries after the cooldown', async () => {
  let now = 0;
  let unavailable = false;
  let name = 'Original profile';
  const fetch = vi.fn(async (url) => {
    if (unavailable) return { ok: false, status: 503 };
    if (url.endsWith('/public_members')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({ name }) };
  });
  const getTeam = loadTeam(fetch, { now: () => now });
  const original = await getTeam();
  expect(original.map((member) => member.login)).toEqual(['UnschooledGamer', 'Elitex07']);
  expect(fetch).toHaveBeenCalledTimes(3);

  now = 60 * 60 * 1000 - 1;
  expect(await getTeam()).toEqual(original);
  expect(fetch).toHaveBeenCalledTimes(3);

  now += 1;
  unavailable = true;
  expect(await getTeam()).toEqual(original);
  expect(fetch).toHaveBeenCalledTimes(4);
  now += 29_999;
  expect(await getTeam()).toEqual(original);
  expect(fetch).toHaveBeenCalledTimes(4);

  now += 1;
  unavailable = false;
  name = 'Updated profile';
  const refreshed = await getTeam();
  expect(refreshed.map((member) => member.name)).toEqual([name, name]);
  expect(fetch).toHaveBeenCalledTimes(7);
  expect(await getTeam()).toEqual(refreshed);
  expect(fetch).toHaveBeenCalledTimes(7);
});

it('shares concurrent refreshes and backs off cold-cache failures before retrying', async () => {
  let now = 0;
  let fail;
  const fetch = vi.fn(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const getTeam = loadTeam(fetch, { now: () => now });
  const pending = [getTeam(500), getTeam(500)];
  expect(fetch).toHaveBeenCalledTimes(1);
  fail(new Error('GitHub unavailable'));
  expect(await Promise.all(pending)).toEqual([{ error: 'GitHub unavailable' }, { error: 'GitHub unavailable' }]);

  now = 29_999;
  expect(await getTeam(500)).toEqual({ error: 'GitHub unavailable' });
  expect(fetch).toHaveBeenCalledTimes(1);

  now = 30_000;
  fetch.mockImplementation(async (url) => ({ ok: true, json: async () => (url.endsWith('/public_members') ? [] : { name: 'Recovered' }) }));
  const [first, second] = await Promise.all([getTeam(), getTeam()]);
  expect(first.map((member) => member.name)).toEqual(['Recovered', 'Recovered']);
  expect(second).toEqual(first);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it.each(['organization', 'profile body'])('bounds a stalled %s request with the shared refresh timeout', async (phase) => {
  const controller = new AbortController();
  const timeout = vi.fn(() => controller.signal);
  let waiting;
  const ready = new Promise((resolve) => {
    waiting = resolve;
  });
  const waitForAbort = (signal) =>
    new Promise((_resolve, reject) => {
      signal.throwIfAborted();
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      waiting();
    });
  const fetch = vi.fn(async (url, { signal }) => {
    if (url.endsWith('/public_members')) {
      if (phase === 'organization') return waitForAbort(signal);
      return { ok: true, json: async () => [] };
    }
    return { ok: true, json: () => waitForAbort(signal) };
  });
  const pending = loadTeam(fetch, { abortSignal: { timeout } })(phase === 'organization' ? 500 : 200);
  await ready;
  controller.abort(new Error('GitHub timed out'));
  const result = await pending;
  if (phase === 'organization') expect(result).toEqual({ error: 'GitHub timed out' });
  else expect(result.map((member) => member.login)).toEqual(['UnschooledGamer', 'Elitex07']);
  expect(timeout).toHaveBeenCalledExactlyOnceWith(5000);
  for (const [, options] of fetch.mock.calls) expect(options.signal).toBe(controller.signal);
});
