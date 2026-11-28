const bundleId = 'app.acode';
const googlePackages = ['com.foxdebug.acode', 'com.foxdebug.acodefree'];

module.exports = { bundleId, googlePackages, purchaseExpiry, invalidPurchase };

function purchaseExpiry(purchaseDate) {
  if (!Number.isSafeInteger(purchaseDate) || purchaseDate <= 0 || purchaseDate > Date.now() + 300000) throw invalidPurchase();
  return new Date(purchaseDate + 30 * 86400000).toISOString();
}

function invalidPurchase() {
  return Object.assign(new Error('Invalid sponsor purchase'), { code: 'INVALID_SPONSOR_PURCHASE' });
}
