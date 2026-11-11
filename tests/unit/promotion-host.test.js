import { once } from 'node:events';
import http from 'node:http';
import express from 'express';
import { redirectPromotionHost } from '../../server/lib/promotionHost';
import createPromotionRedirect from '../../server/lib/promotionRedirect';

it('serves promotion destinations first and sends other tracking-host visits to the matching site', async () => {
  const app = express();
  const get = (id) => (id === 'active' ? { url: 'https://sponsor.example/offer' } : null);
  const count = vi.fn();
  app.get(
    '/p/:id',
    createPromotionRedirect(() => ({ prepare: () => ({ get }) }), count),
  );
  app.use(redirectPromotionHost);
  app.use((_req, res) => res.send('site'));

  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    async function request(host, path, method = 'GET') {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: { host } });
      const response = once(req, 'response');
      req.end();
      const [res] = await response;
      res.resume();
      return res;
    }
    for (const [host, origin] of [
      ['go.acode.app', 'https://acode.app'],
      ['go.dev.acode.app', 'https://dev.acode.app'],
    ]) {
      for (const [path, destination] of [
        ['/', `${origin}/`],
        ['/favicon.ico', `${origin}/favicon.ico`],
        ['/faqs?src=ios', `${origin}/faqs?src=ios`],
        ['/p/missing?source=web', `${origin}/`],
        ['/p/active', 'https://sponsor.example/offer'],
      ]) {
        const res = await request(host, path);
        expect(res.statusCode).toBe(302);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers.location).toBe(destination);
        if (path !== '/p/active') expect(res.headers.vary).toMatch(/\bHost\b/i);
      }
      expect((await request(host, '/faqs', 'HEAD')).headers.location).toBe(`${origin}/faqs`);
      for (const path of [
        '/api',
        '/api/login',
        '/oauth/apple/callback',
        '/ai/oauth/openrouter',
        '/.well-known/assetlinks.json',
        '/.well-known/apple-app-site-association',
        '/apple-app-site-association',
      ]) {
        const res = await request(host, path);
        expect(res.statusCode).toBe(404);
        expect(res.headers.location).toBeUndefined();
      }
      expect((await request(host, '/api/login', 'HEAD')).statusCode).toBe(404);
      expect((await request(host, '/api/login', 'POST')).statusCode).toBe(405);
    }
    expect((await request('Go.Acode.App:443', '/faqs')).headers.location).toBe('https://acode.app/faqs');
    expect(count).toHaveBeenCalledTimes(2);
    expect((await request('acode.app', '/p/missing')).statusCode).toBe(404);
    expect((await request('acode.app', '/faqs')).statusCode).toBe(200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
