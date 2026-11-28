import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const purchaseRules = require('../../server/lib/sponsorPurchase');
const purchaseDate = Date.UTC(2026, 10, 20);

import { VerificationException, VerificationStatus } from '@apple/app-store-server-library';
import { safeSponsorWebsite } from '../../shared/sponsorWebsite';

let post;
let sponsor;
let apple;
let google;
let email;
let image;
let removeImage;
let logError;

beforeEach(() => {
  sponsor = Object.fromEntries(
    ['id', 'name', 'tier', 'email', 'public', 'image', 'website', 'tagline', 'token', 'package_name', 'order_id', 'status', 'expires_at'].map(
      (key) => [key.toUpperCase(), key],
    ),
  );
  Object.assign(sponsor, {
    STATE_PURCHASED: 0,
    STATE_CANCELED: 1,
    get: vi.fn(async () => []),
    insertPurchase: vi.fn(async () => [{ id: 1 }]),
    refreshPurchase: vi.fn(async () => []),
  });
  apple = vi.fn(async () => ({ orderId: 'appstore:Production:42', purchaseState: 0, purchaseDate }));
  google = vi.fn(async () => ({ data: { orderId: 'GPA.42', purchaseState: 0, purchaseTimeMillis: String(purchaseDate) } }));
  email = vi.fn(async () => {});
  image = vi.fn();
  removeImage = vi.fn(async () => {});
  logError = vi.fn();
  const loggerModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../../server/lib/sponsorError.js', import.meta.url), 'utf8'), {
    module: loggerModule,
    require,
    console: { error: logError },
    __dirname: path.resolve(import.meta.dirname, '../../server/lib'),
  });
  const limiter = vi.fn();
  const dependencies = {
    'node:path': path,
    express: {
      Router: () => ({
        get() {},
        delete() {},
        post(path, middleware, handler) {
          expect(path).toBe('/');
          expect(middleware).toBe(limiter);
          post = handler;
        },
      }),
    },
    '../entities/sponsor': sponsor,
    googleapis: { google: { androidpublisher: () => ({ purchases: { products: { get: google } } }) } },
    '../lib/helpers': {},
    '../lib/sendEmail': email,
    '../lib/sponsorImage': { saveSponsorImage: image, removeSponsorImage: removeImage },
    '../lib/rateLimits': { sponsorRegisterLimiter: limiter },
    '@apple/app-store-server-library': { VerificationException, VerificationStatus },
    '../lib/sponsorScope': {},
    '../lib/sponsorPurchase': purchaseRules,
    '../lib/sponsorError': loggerModule.exports,
    '../lib/appleSponsorPurchase': { bundleId: 'app.acode', verifyAppleSponsorPurchase: apple },
    '../../shared/sponsorTiers': { TIER_ORDER: ['crystal', 'gold'] },
    '../../shared/sponsorWebsite': { safeSponsorWebsite },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../../server/apis/sponsor.js', import.meta.url), 'utf8'), {
    require: (name) => {
      if (!(name in dependencies)) throw Error(name);
      return dependencies[name];
    },
    module: { exports: {} },
    console: { error: logError, warn: vi.fn() },
    process,
    Date,
    __dirname: path.resolve(import.meta.dirname, '../../server/apis'),
  });
});

afterEach(() => vi.unstubAllEnvs());

it('verifies Apple orders, records 30 days and uses no Google API', async () => {
  const response = await submit();
  expect(response.code).toBe(201);
  expect(apple).toHaveBeenCalledWith('signed', 'crystal');
  expect(google).not.toHaveBeenCalled();
  const values = Object.fromEntries(sponsor.insertPurchase.mock.calls[0]);
  expect(values).toMatchObject({ package_name: 'app.acode', order_id: 'appstore:Production:42', email: '', public: 1, status: 0 });
  expect(values.expires_at).toBe('2026-12-20T00:00:00.000Z');
  expect(values.token).toBe('');
});

it.each(['java\tscript:alert(1)', 'https://acode.app@evil.example', '//user:password@evil.example'])(
  'rejects unsafe website %s before verification and identifies the editable field',
  async (website) => {
    const response = await submit({ website });
    expect(response.code).toBe(400);
    expect(response.body.field).toBe('website');
    expect(apple).not.toHaveBeenCalled();
  },
);

it.each(['example.com/path', 'example.com:8080/path'])('normalizes %s before saving the paid sponsorship', async (website) => {
  expect((await submit({ website })).code).toBe(201);
  expect(Object.fromEntries(sponsor.insertPurchase.mock.calls[0]).website).toBe(`https://${website}`);
});

it('keeps Android verification working and rejects unpaid transactions', async () => {
  expect((await submit({ packageName: 'com.foxdebug.acode' })).code).toBe(201);
  expect(apple).not.toHaveBeenCalled();
  google.mockResolvedValueOnce({ data: { orderId: 'pending', purchaseState: 2 } });
  expect((await submit({ packageName: 'com.foxdebug.acode' })).code).toBe(403);
  expect(sponsor.insertPurchase).toHaveBeenCalledOnce();
});

it('uses verified Google purchase time and keeps the token needed for refresh', async () => {
  expect((await submit({ packageName: 'com.foxdebug.acodefree' })).code).toBe(201);
  expect(Object.fromEntries(sponsor.insertPurchase.mock.calls[0])).toMatchObject({ expires_at: '2026-12-20T00:00:00.000Z', token: 'signed' });
});

it.each([{ orderId: undefined }, { quantity: 2 }, { purchaseTimeMillis: undefined }, { purchaseTimeMillis: 'garbage' }, { purchaseTimeMillis: '' }])(
  'rejects an incomplete or unsupported Google purchase: %j',
  async (override) => {
    google.mockResolvedValueOnce({ data: { orderId: 'GPA.42', purchaseState: 0, purchaseTimeMillis: String(purchaseDate), ...override } });
    expect((await submit({ packageName: 'com.foxdebug.acode' })).code).toBe(403);
    expect(sponsor.insertPurchase).not.toHaveBeenCalled();
  },
);

it('rejects an already refunded order without saving another logo', async () => {
  sponsor.get.mockResolvedValueOnce([{ id: 1, status: 1 }]);
  expect((await submit({ image: 'upload' })).code).toBe(403);
  expect(image).not.toHaveBeenCalled();
  expect(sponsor.insertPurchase).not.toHaveBeenCalled();
});

it('treats retried and concurrently inserted orders as success without extending benefits or emailing', async () => {
  sponsor.get.mockResolvedValueOnce([{ id: 1 }]);
  expect((await submit({ email: 'test@example.test' })).code).toBe(200);
  expect(sponsor.insertPurchase).not.toHaveBeenCalled();
  expect(image).not.toHaveBeenCalled();
  sponsor.insertPurchase.mockResolvedValueOnce([]);
  expect((await submit({ email: 'test@example.test' })).code).toBe(200);
  expect(email).not.toHaveBeenCalled();
});

it('repairs a verified legacy Google order before acknowledging the duplicate', async () => {
  sponsor.get.mockResolvedValueOnce([{ id: 7, expires_at: null }]);
  expect((await submit({ packageName: 'com.foxdebug.acode', image: 'upload' })).code).toBe(200);
  expect(sponsor.refreshPurchase).toHaveBeenCalledExactlyOnceWith(7, {
    orderId: 'GPA.42',
    purchaseState: 0,
    purchaseTimeMillis: String(purchaseDate),
  });
  expect(image).not.toHaveBeenCalled();
  expect(sponsor.insertPurchase).not.toHaveBeenCalled();
  expect(email).not.toHaveBeenCalled();
});

it('does not acknowledge a legacy duplicate if expiry recovery fails', async () => {
  sponsor.get.mockResolvedValueOnce([{ id: 7, expires_at: null }]);
  sponsor.refreshPurchase.mockRejectedValueOnce(new Error('db failed'));
  expect((await submit({ packageName: 'com.foxdebug.acode' })).code).toBe(500);
});

it('leaves an existing expiry unchanged on a duplicate Google registration', async () => {
  sponsor.get.mockResolvedValueOnce([{ id: 7, expires_at: '2026-10-01T00:00:00.000Z' }]);
  expect((await submit({ packageName: 'com.foxdebug.acode' })).code).toBe(200);
  expect(sponsor.refreshPurchase).not.toHaveBeenCalled();
});

it.each([
  { name: {} },
  { name: '   ' },
  { name: 'x'.repeat(201) },
  { email: [] },
  { email: 'x'.repeat(321) },
  { website: true },
  { website: 'x'.repeat(2049) },
  { tagline: 42 },
  { tagline: 'x'.repeat(501) },
  { image: {} },
  { image: 'x'.repeat(2 * 1024 * 1024 + 1) },
  { public: 'false' },
  { public: 'true' },
  { public: 2 },
  { packageName: [] },
  { packageName: 'other.app' },
  { purchaseToken: {} },
  { purchaseToken: 'x'.repeat(32769) },
])('rejects malformed sponsor fields before verifying the purchase (%#)', async (values) => {
  expect((await submit(values)).code).toBe(400);
  expect(apple).not.toHaveBeenCalled();
  expect(google).not.toHaveBeenCalled();
  expect(sponsor.get).not.toHaveBeenCalled();
});

it.each([undefined, null, [], 'invalid'])('rejects a malformed request body (%#)', async (body) => {
  expect((await submit({}, body)).code).toBe(400);
  expect(apple).not.toHaveBeenCalled();
});

it.each([
  [false, 0],
  [true, 1],
  [0, 0],
  [1, 1],
  [undefined, 0],
])('accepts supported visibility %s as %s', async (show, visible) => {
  expect((await submit({ public: show, email: null, website: null, tagline: null, image: null })).code).toBe(201);
  expect(Object.fromEntries(sponsor.insertPurchase.mock.calls[0]).public).toBe(visible);
});

it('logs programming error type and source location without the message or unrelated frames', async () => {
  const error = new TypeError('secret-receipt buyer@example.test');
  error.stack = `TypeError: secret-receipt buyer@example.test\n    at dynamicSecret (${path.resolve(import.meta.dirname, '../../server/entities/sponsor.js')}:77:9)\n    at fetch (https://provider.test/secret-receipt:10:2)`;
  sponsor.insertPurchase.mockRejectedValueOnce(error);
  expect((await submit()).code).toBe(500);
  expect(logError).toHaveBeenCalledWith(
    'Sponsor operation failed:',
    expect.objectContaining({ name: 'TypeError', frames: ['entities/sponsor.js:77:9'] }),
  );
  const log = JSON.stringify(logError.mock.calls);
  for (const secret of ['secret-receipt', 'buyer@example.test', 'dynamicSecret', 'provider.test']) expect(log).not.toContain(secret);
});

it('does not record a failed verification or invalid tier', async () => {
  apple.mockRejectedValueOnce(new VerificationException(VerificationStatus.INVALID_CERTIFICATE));
  expect((await submit()).code).toBe(403);
  expect((await submit({ tier: 'acode_pro_new' })).code).toBe(400);
  expect(sponsor.get).not.toHaveBeenCalled();
  expect(sponsor.insertPurchase).not.toHaveBeenCalled();
});

it('keeps a registered purchase successful when email fails', async () => {
  email.mockRejectedValueOnce(Object.assign(new Error('SMTP failed'), { code: 'ECONNECTION' }));
  image.mockResolvedValueOnce('saved.png');
  expect((await submit({ email: 'test@example.test', image: 'upload' })).code).toBe(201);
  expect(logError).toHaveBeenCalledWith('Sponsor operation failed:', expect.objectContaining({ phase: 'email', code: 'ECONNECTION' }));
  expect(removeImage).not.toHaveBeenCalled();
});

it('reports retryable Apple failures without logging receipt data', async () => {
  const failure = new VerificationException(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE, new Error('secret-receipt'));
  apple.mockRejectedValueOnce(failure);
  expect((await submit()).code).toBe(503);
  expect(logError).toHaveBeenCalledWith(
    'Sponsor operation failed:',
    expect.objectContaining({ phase: 'verification', verificationStatus: 'RETRYABLE_VERIFICATION_FAILURE' }),
  );
  expect(JSON.stringify(logError.mock.calls)).not.toContain('secret-receipt');
  expect(sponsor.insertPurchase).not.toHaveBeenCalled();
});

it('rejects ineligible Apple purchases but treats unexpected verifier failures as retryable', async () => {
  apple.mockRejectedValueOnce(Object.assign(new Error('Invalid sponsor purchase'), { code: 'INVALID_SPONSOR_PURCHASE' }));
  expect((await submit()).code).toBe(403);
  apple.mockRejectedValueOnce(new Error('unexpected failure'));
  expect((await submit()).code).toBe(503);
});

it.each([
  [400, 403],
  [404, 403],
  [410, 403],
  [401, 503],
  [403, 503],
  [429, 503],
  [500, 503],
  ['ETIMEDOUT', 503],
])('maps Google error %s to %s', async (code, expected) => {
  google.mockRejectedValueOnce(Object.assign(new Error('secret-receipt'), { code }));
  expect((await submit({ packageName: 'com.foxdebug.acode' })).code).toBe(expected);
  expect(sponsor.insertPurchase).not.toHaveBeenCalled();
  expect(JSON.stringify(logError.mock.calls)).not.toContain('secret-receipt');
});

it.each(['get', 'insertPurchase'])('reports a %s failure as a registration error', async (method) => {
  sponsor[method].mockRejectedValueOnce(Object.assign(new Error('db failed'), { code: 'SQLITE_BUSY' }));
  image.mockResolvedValueOnce('unused.png');
  expect((await submit({ image: 'upload' })).code).toBe(503);
  expect(logError).toHaveBeenCalledWith('Sponsor operation failed:', expect.objectContaining({ phase: 'registration', code: 'SQLITE_BUSY' }));
  if (method === 'insertPurchase') expect(removeImage).toHaveBeenCalledWith('unused.png');
  else expect(removeImage).not.toHaveBeenCalled();
  expect(email).not.toHaveBeenCalled();
});

it('removes only the new unused logo after a concurrent duplicate', async () => {
  image.mockResolvedValueOnce('unused.png');
  sponsor.insertPurchase.mockResolvedValueOnce([]);
  expect((await submit({ image: 'upload' })).code).toBe(200);
  expect(removeImage).toHaveBeenCalledExactlyOnceWith('unused.png');
  expect(email).not.toHaveBeenCalled();
});

it('does not turn a successful duplicate acknowledgement into an error when cleanup fails', async () => {
  image.mockResolvedValueOnce('unused.png');
  sponsor.insertPurchase.mockResolvedValueOnce([]);
  removeImage.mockRejectedValueOnce(Object.assign(new Error('cleanup failed'), { code: 'EACCES' }));
  expect((await submit({ image: 'upload' })).code).toBe(200);
  expect(logError).toHaveBeenCalledWith('Sponsor operation failed:', expect.objectContaining({ phase: 'image cleanup', code: 'EACCES' }));
});

it.each([
  ['production', true, 0],
  ['development', true, 1],
  ['development', false, 0],
  ['', true, 0],
])('applies sandbox visibility on %s when public is %s', async (environment, show, expected) => {
  vi.stubEnv('NODE_ENV', environment);
  apple.mockResolvedValueOnce({ orderId: 'appstore:Sandbox:42', purchaseState: 0, purchaseDate, sandbox: true });
  await submit({ email: 'test@example.test', public: show });
  expect(Object.fromEntries(sponsor.insertPurchase.mock.calls[0]).public).toBe(expected);
  expect(email).not.toHaveBeenCalled();
});

async function submit(overrides = {}, ...bodyOverride) {
  const response = {
    code: 200,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  const body = bodyOverride.length
    ? bodyOverride[0]
    : { name: 'Sponsor', tier: 'crystal', public: true, purchaseToken: 'signed', packageName: 'app.acode', ...overrides };
  await post({ body }, response);
  return response;
}
