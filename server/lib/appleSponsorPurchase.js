const fs = require('node:fs');
const path = require('node:path');
const { Environment, SignedDataVerifier, Type, AppStoreServerAPIClient } = require('@apple/app-store-server-library');
const { TIER_ORDER } = require('../../shared/sponsorTiers');
const { bundleId, purchaseExpiry, invalidPurchase } = require('./sponsorPurchase');

const roots = [fs.readFileSync(path.join(__dirname, '../certificates/AppleRootCA-G3.cer'))];
const verifiers = new Map();

module.exports = { verifyAppleSponsorPurchase, refreshAppleSponsorPurchase };

async function verifyAppleSponsorPurchase(token, tier) {
  const purchase = await verifyTransaction(token, tier);
  if (purchase.revocationDate != null) throw invalidPurchase();
  return {
    orderId: `appstore:${purchase.environment}:${purchase.transactionId}`,
    purchaseState: 0,
    purchaseDate: purchase.purchaseDate,
    sandbox: purchase.environment === Environment.SANDBOX,
  };
}

async function refreshAppleSponsorPurchase(orderId, tier) {
  const match = typeof orderId === 'string' && /^appstore:(Production|Sandbox):([0-9]+)$/.exec(orderId);
  if (!match) throw invalidPurchase();
  const [, environment, transactionId] = match;
  const { APPLE_STORE_PRIVATE_KEY, APPLE_STORE_KEY_ID, APPLE_STORE_ISSUER_ID } = process.env;
  if (!APPLE_STORE_PRIVATE_KEY || !APPLE_STORE_KEY_ID || !APPLE_STORE_ISSUER_ID) {
    throw Object.assign(new Error('App Store Server API is not configured'), { code: 'APPLE_STORE_CONFIG_MISSING' });
  }
  const client = new AppStoreServerAPIClient(APPLE_STORE_PRIVATE_KEY, APPLE_STORE_KEY_ID, APPLE_STORE_ISSUER_ID, bundleId, environment);
  const baseUrl = environment === Environment.SANDBOX ? 'https://api.storekit-sandbox.apple.com' : 'https://api.storekit.apple.com';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('Apple transaction lookup timed out'), { code: 'ETIMEDOUT' })), 30000);
  // Use the SDK's transport hook so abort also interrupts reading the response body.
  client.makeFetchRequest = (pathname, query, method, body, headers) =>
    fetch(`${baseUrl}${pathname}?${query}`, { method, body, headers, signal: controller.signal });
  let signedTransactionInfo;
  try {
    ({ signedTransactionInfo } = await client.getTransactionInfo(transactionId));
  } finally {
    clearTimeout(timer);
  }
  const purchase = await verifyTransaction(signedTransactionInfo, tier, environment);
  if (purchase.transactionId !== transactionId) throw invalidPurchase();
  return {
    orderId,
    purchaseState: purchase.revocationDate == null ? 0 : 1,
    reason: purchase.revocationDate == null ? null : 'APPLE_REFUND_OR_REVOCATION',
    purchaseTimeMillis: String(purchase.purchaseDate),
  };
}

async function verifyTransaction(token, tier, environment) {
  if (typeof token !== 'string' || token.length > 32768 || !TIER_ORDER.includes(tier)) throw invalidPurchase();
  const purchase = await verifier(environment ?? tokenEnvironment(token)).verifyAndDecodeTransaction(token);
  if (
    purchase.productId !== tier ||
    purchase.type !== Type.CONSUMABLE ||
    typeof purchase.transactionId !== 'string' ||
    !purchase.transactionId ||
    (purchase.quantity ?? 1) !== 1
  )
    throw invalidPurchase();
  purchaseExpiry(purchase.purchaseDate);
  return purchase;
}

function tokenEnvironment(token) {
  // This untrusted hint only selects a verifier; that verifier checks the signed
  // environment, bundle, certificate chain and signature before we use any data.
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (payload.environment === Environment.SANDBOX) return Environment.SANDBOX;
  } catch {
    // Malformed JWS is rejected by the production verifier below.
  }
  return Environment.PRODUCTION;
}

function verifier(environment) {
  if (!verifiers.has(environment)) {
    verifiers.set(environment, new SignedDataVerifier(roots, true, environment, bundleId, 6815644799));
  }
  return verifiers.get(environment);
}
