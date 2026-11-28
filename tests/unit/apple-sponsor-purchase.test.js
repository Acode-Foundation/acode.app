import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { SignedDataVerifier, VerificationException, VerificationStatus, AppStoreServerAPIClient } = require('@apple/app-store-server-library');
const { verifyAppleSponsorPurchase, refreshAppleSponsorPurchase } = require('../../server/lib/appleSponsorPurchase');
const transaction = {
  productId: 'crystal',
  type: 'Consumable',
  transactionId: '42',
  purchaseDate: Date.now(),
  environment: 'Production',
  quantity: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('rejects forged receipts using the real Apple verifier', async () => {
  await expect(verifyAppleSponsorPurchase('forged', 'crystal')).rejects.toThrow();
});

it('keys verified purchases by environment and transaction ID, independent of JWS re-signing', async () => {
  const verify = vi.spyOn(SignedDataVerifier.prototype, 'verifyAndDecodeTransaction').mockResolvedValue(transaction);
  expect(await verifyAppleSponsorPurchase('signed', 'crystal')).toEqual({
    orderId: 'appstore:Production:42',
    purchaseState: 0,
    purchaseDate: transaction.purchaseDate,
    sandbox: false,
  });
  expect(verify).toHaveBeenCalledWith('signed');
  verify.mockResolvedValueOnce({ ...transaction, environment: 'Sandbox' });
  expect((await verifyAppleSponsorPurchase(signedToken({ environment: 'Sandbox' }), 'crystal')).orderId).toBe('appstore:Sandbox:42');
});

it('treats an omitted quantity as one, matching Android sponsorships', async () => {
  const { quantity, ...purchase } = transaction;
  vi.spyOn(SignedDataVerifier.prototype, 'verifyJWT').mockResolvedValue({ ...purchase, bundleId: 'app.acode' });
  expect((await verifyAppleSponsorPurchase(signedToken(purchase), 'crystal')).purchaseState).toBe(0);
});

it.each([
  { productId: 'gold' },
  { type: 'Non-Consumable' },
  { revocationDate: Date.now() },
  { transactionId: undefined },
  { purchaseDate: undefined },
  { purchaseDate: 0 },
  { quantity: 0 },
  { quantity: -1 },
  { quantity: 1.5 },
  { quantity: '1' },
  { quantity: 2 },
  { purchaseDate: Date.now() + 3600000 },
])('rejects an ineligible verified purchase: %j', async (override) => {
  vi.spyOn(SignedDataVerifier.prototype, 'verifyAndDecodeTransaction').mockResolvedValue({ ...transaction, ...override });
  await expect(verifyAppleSponsorPurchase('signed', 'crystal')).rejects.toMatchObject({
    message: 'Invalid sponsor purchase',
    code: 'INVALID_SPONSOR_PURCHASE',
  });
});

it('verifies only once for signature failures or accepts arbitrary products', async () => {
  const verify = vi
    .spyOn(SignedDataVerifier.prototype, 'verifyAndDecodeTransaction')
    .mockRejectedValue(new VerificationException(VerificationStatus.INVALID_CERTIFICATE));
  await expect(verifyAppleSponsorPurchase('signed', 'crystal')).rejects.toThrow();
  expect(verify).toHaveBeenCalledOnce();
  await expect(verifyAppleSponsorPurchase('signed', 'acode_pro_new')).rejects.toThrow('Invalid sponsor purchase');
});

function signedToken(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

it('selects sandbox once, while the real SDK still rejects environment and bundle mismatches', async () => {
  const decode = vi
    .spyOn(SignedDataVerifier.prototype, 'verifyJWT')
    .mockResolvedValue({ ...transaction, bundleId: 'app.acode', environment: 'Sandbox' });
  expect((await verifyAppleSponsorPurchase(signedToken({ environment: 'Sandbox' }), 'crystal')).sandbox).toBe(true);
  expect(decode).toHaveBeenCalledOnce();
  decode.mockResolvedValueOnce({ ...transaction, bundleId: 'other.app', environment: 'Sandbox' });
  await expect(verifyAppleSponsorPurchase(signedToken({ environment: 'Sandbox' }), 'crystal')).rejects.toMatchObject({
    status: VerificationStatus.INVALID_APP_IDENTIFIER,
  });
  await expect(verifyAppleSponsorPurchase(signedToken({ environment: 'Production' }), 'crystal')).rejects.toMatchObject({
    status: VerificationStatus.INVALID_ENVIRONMENT,
  });
});

describe('daily Apple transaction refresh', () => {
  beforeEach(() => {
    vi.stubEnv('APPLE_STORE_PRIVATE_KEY', 'test-key');
    vi.stubEnv('APPLE_STORE_KEY_ID', 'test-key-id');
    vi.stubEnv('APPLE_STORE_ISSUER_ID', 'test-issuer');
  });

  it.each(['Production', 'Sandbox'])('looks up finished purchases in %s and verifies the returned JWS', async (environment) => {
    const lookup = vi.spyOn(AppStoreServerAPIClient.prototype, 'getTransactionInfo').mockResolvedValue({ signedTransactionInfo: 'fresh' });
    const decode = vi.spyOn(SignedDataVerifier.prototype, 'verifyAndDecodeTransaction').mockResolvedValue({ ...transaction, environment });
    expect(await refreshAppleSponsorPurchase(`appstore:${environment}:42`, 'crystal')).toEqual({
      orderId: `appstore:${environment}:42`,
      purchaseState: 0,
      reason: null,
      purchaseTimeMillis: String(transaction.purchaseDate),
    });
    expect(lookup).toHaveBeenCalledWith('42');
    expect(decode).toHaveBeenCalledWith('fresh');
    expect(decode.mock.instances[0].environment).toBe(environment);
    expect(lookup.mock.instances[0].urlBase).toContain(environment === 'Sandbox' ? 'storekit-sandbox' : 'storekit.apple.com');
  });

  it('returns the current refund state and clears it when Apple reverses the refund', async () => {
    vi.spyOn(AppStoreServerAPIClient.prototype, 'getTransactionInfo').mockResolvedValue({ signedTransactionInfo: 'fresh' });
    const decode = vi
      .spyOn(SignedDataVerifier.prototype, 'verifyAndDecodeTransaction')
      .mockResolvedValue({ ...transaction, revocationDate: Date.now() });
    expect(await refreshAppleSponsorPurchase('appstore:Production:42', 'crystal')).toMatchObject({
      purchaseState: 1,
      reason: 'APPLE_REFUND_OR_REVOCATION',
    });
    decode.mockResolvedValueOnce(transaction);
    expect(await refreshAppleSponsorPurchase('appstore:Production:42', 'crystal')).toMatchObject({ purchaseState: 0, reason: null });
  });

  it('fails without a store API key instead of treating the order as refunded', async () => {
    vi.stubEnv('APPLE_STORE_ISSUER_ID', '');
    const lookup = vi.spyOn(AppStoreServerAPIClient.prototype, 'getTransactionInfo');
    await expect(refreshAppleSponsorPurchase('appstore:Production:42', 'crystal')).rejects.toMatchObject({ code: 'APPLE_STORE_CONFIG_MISSING' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects mismatched transactions and forged responses', async () => {
    const lookup = vi.spyOn(AppStoreServerAPIClient.prototype, 'getTransactionInfo').mockResolvedValue({ signedTransactionInfo: 'forged' });
    await expect(refreshAppleSponsorPurchase('appstore:Production:42', 'crystal')).rejects.toThrow();
    vi.spyOn(SignedDataVerifier.prototype, 'verifyAndDecodeTransaction').mockResolvedValue({ ...transaction, transactionId: '43' });
    await expect(refreshAppleSponsorPurchase('appstore:Production:42', 'crystal')).rejects.toMatchObject({ code: 'INVALID_SPONSOR_PURCHASE' });
    await expect(refreshAppleSponsorPurchase('appstore:LocalTesting:42', 'crystal')).rejects.toMatchObject({ code: 'INVALID_SPONSOR_PURCHASE' });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it.each(['Production', 'Sandbox'])('uses the bounded transport for %s and clears its timer after success', async (environment) => {
    vi.useFakeTimers();
    vi.spyOn(AppStoreServerAPIClient.prototype, 'createBearerToken').mockReturnValue('test-authorization');
    vi.spyOn(SignedDataVerifier.prototype, 'verifyAndDecodeTransaction').mockResolvedValue({ ...transaction, environment });
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ signedTransactionInfo: 'fresh' }) }));
    vi.stubGlobal('fetch', fetch);
    expect((await refreshAppleSponsorPurchase(`appstore:${environment}:42`, 'crystal')).purchaseState).toBe(0);
    const [url, options] = fetch.mock.calls[0];
    const host = environment === 'Sandbox' ? 'api.storekit-sandbox.apple.com' : 'api.storekit.apple.com';
    expect(url).toBe(`https://${host}/inApps/v1/transactions/42?`);
    expect(options).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer test-authorization' } });
    expect(options.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['headers', 'body'])('aborts stalled response %s and lets the cron refresh the next sponsor', async (phase) => {
    vi.useFakeTimers();
    vi.spyOn(AppStoreServerAPIClient.prototype, 'createBearerToken').mockReturnValue('test-authorization');
    let signal;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        signal = options.signal;
        const stalled = () =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        return phase === 'headers' ? stalled() : { ok: true, json: stalled };
      }),
    );
    const sponsor = {
      for() {
        return this;
      },
      get: async () => [
        { id: 1, package_name: 'app.acode', order_id: 'appstore:Production:42', tier: 'crystal' },
        { id: 2, package_name: 'com.foxdebug.acode', token: 'google-token', tier: 'crystal' },
      ],
      refreshPurchase: vi.fn(),
    };
    const purchase = { purchaseState: 0, orderId: 'GPA.42', purchaseTimeMillis: String(transaction.purchaseDate) };
    const googleGet = vi.fn(async () => ({ data: purchase }));
    const log = vi.fn();
    const dependencies = {
      '../entities/sponsor': sponsor,
      '../lib/sponsorPurchase': { bundleId: 'app.acode' },
      '../lib/appleSponsorPurchase': { refreshAppleSponsorPurchase },
      '../lib/sponsorError': { logSponsorError: log },
      googleapis: { google: { androidpublisher: () => ({ purchases: { products: { get: googleGet } } }) } },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(new URL('../../server/crons/updateSponsors.js', import.meta.url), 'utf8'), {
      module,
      require(name) {
        if (!(name in dependencies)) throw Error(name);
        return dependencies[name];
      },
    });
    const refresh = module.exports();
    await vi.advanceTimersByTimeAsync(29999);
    expect(signal.aborted).toBe(false);
    expect(googleGet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await refresh;
    expect(signal.aborted).toBe(true);
    expect(log).toHaveBeenCalledWith('refresh', expect.objectContaining({ code: 'ETIMEDOUT' }));
    expect(sponsor.refreshPurchase).toHaveBeenCalledExactlyOnceWith(2, purchase);
    expect(vi.getTimerCount()).toBe(0);
  });
});
