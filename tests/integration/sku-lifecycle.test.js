const path = require('node:path');
const sqlite3 = require('better-sqlite3');
const { google } = require('googleapis');
const { registerSKU } = require('../../server/apis/plugin');
const { getPluginSKU } = require('../../server/lib/helpers');

const DB_FILE = path.join(process.cwd(), 'data/db.sqlite3');
const db = sqlite3(DB_FILE);

const androidpublisher = google.androidpublisher('v3');
const PACKAGES = ['com.foxdebug.acode', 'com.foxdebug.acodefree'];

let plugin;

beforeAll(async () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), 'data/key.json'),
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const client = await auth.getClient();
  google.options({ auth: client });

  plugin = db.prepare('SELECT id, name, price FROM plugin WHERE price > 0 LIMIT 1').get();
  if (!plugin) throw new Error('No paid plugin found in DB for testing');
}, 15000);

describe('registerSKU on both packages', () => {
  it('updates an existing plugin listing on both acode and acodefree', async () => {
    const originalName = plugin.name;
    const testName = `${originalName} [TEST ${Date.now()}]`;

    const errors = await registerSKU(testName, plugin.id, 50);
    if (errors.length > 0) {
      console.error('registerSKU errors:', JSON.stringify(errors, null, 2));
    }
    expect(errors).toHaveLength(0);

    const sku = getPluginSKU(plugin.id);
    for (const pkg of PACKAGES) {
      const res = await androidpublisher.monetization.onetimeproducts.get({
        packageName: pkg,
        productId: sku,
      });
      expect(res.data.productId).toBe(sku);
      expect(res.data.listings[0].title).toBe(testName);
    }

    const restoreErrors = await registerSKU(originalName, plugin.id, 50);
    expect(restoreErrors).toHaveLength(0);

    for (const pkg of PACKAGES) {
      const res = await androidpublisher.monetization.onetimeproducts.get({
        packageName: pkg,
        productId: sku,
      });
      expect(res.data.listings[0].title).toBe(originalName);
    }
  }, 30000);

  it('sets worldwide regional pricing, not just India', async () => {
    const errors = await registerSKU(plugin.name, plugin.id, 50);
    expect(errors).toHaveLength(0);

    const sku = getPluginSKU(plugin.id);
    for (const pkg of PACKAGES) {
      const res = await androidpublisher.monetization.onetimeproducts.get({
        packageName: pkg,
        productId: sku,
      });
      const purchaseOptions = res.data.purchaseOptions || [];
      expect(purchaseOptions.length).toBeGreaterThan(0);

      for (const po of purchaseOptions) {
        const configs = po.regionalPricingAndAvailabilityConfigs || [];
        expect(configs.length).toBeGreaterThan(1);
        const codes = configs.map((c) => c.regionCode);
        expect(codes).toContain('IN');
        expect(codes).toContain('US');
        for (const c of configs) {
          expect(c.availability).toBe('AVAILABLE');
          expect(c.price).toBeDefined();
          expect(c.price.currencyCode).toBeTruthy();
        }
      }
    }
  }, 30000);

  it('preserves existing regions when updating price', async () => {
    const sku = getPluginSKU(plugin.id);

    for (const pkg of PACKAGES) {
      const before = await androidpublisher.monetization.onetimeproducts.get({
        packageName: pkg,
        productId: sku,
      });
      const beforeCodes = new Set();
      for (const po of before.data.purchaseOptions || []) {
        for (const c of po.regionalPricingAndAvailabilityConfigs || []) {
          beforeCodes.add(c.regionCode);
        }
      }

      const errors = await registerSKU(plugin.name, plugin.id, 50);
      expect(errors).toHaveLength(0);

      const after = await androidpublisher.monetization.onetimeproducts.get({
        packageName: pkg,
        productId: sku,
      });
      const afterCodes = new Set();
      for (const po of after.data.purchaseOptions || []) {
        for (const c of po.regionalPricingAndAvailabilityConfigs || []) {
          afterCodes.add(c.regionCode);
        }
      }

      for (const code of beforeCodes) {
        expect(afterCodes.has(code)).toBe(true);
      }
    }
  }, 30000);

  it('activates purchase options after creating product', async () => {
    const errors = await registerSKU(plugin.name, plugin.id, 50);
    expect(errors).toHaveLength(0);

    const sku = getPluginSKU(plugin.id);
    for (const pkg of PACKAGES) {
      const res = await androidpublisher.monetization.onetimeproducts.get({
        packageName: pkg,
        productId: sku,
      });
      const purchaseOptions = res.data.purchaseOptions || [];
      expect(purchaseOptions.length).toBeGreaterThan(0);

      for (const po of purchaseOptions) {
        expect(po.purchaseOptionId).toBeTruthy();
        expect(po.regionalPricingAndAvailabilityConfigs).toBeDefined();
        expect(po.regionalPricingAndAvailabilityConfigs.length).toBeGreaterThan(0);

        for (const c of po.regionalPricingAndAvailabilityConfigs) {
          expect(c.availability).toBe('AVAILABLE');
        }
      }
    }
  }, 30000);

  it('sets minimum price of 1 unit for zero-conversion regions', async () => {
    const errors = await registerSKU(plugin.name, plugin.id, 15);
    expect(errors).toHaveLength(0);

    const sku = getPluginSKU(plugin.id);
    for (const pkg of PACKAGES) {
      const res = await androidpublisher.monetization.onetimeproducts.get({
        packageName: pkg,
        productId: sku,
      });
      const purchaseOptions = res.data.purchaseOptions || [];

      for (const po of purchaseOptions) {
        for (const c of po.regionalPricingAndAvailabilityConfigs || []) {
          const zeroPrice = parseInt(c.price.units, 10) === 0 && c.price.nanos === 0;
          expect(zeroPrice).toBe(false);
        }
      }
    }
  }, 30000);

  it('throws for invalid price below MIN_PRICE', async () => {
    await expect(registerSKU('Test', 'test.id', 5)).rejects.toThrow('Invalid price');
  });

  it('rejects NaN and zero prices', async () => {
    await expect(registerSKU('Test', 'test.id', 0)).rejects.toThrow('Invalid price');
    await expect(registerSKU('Test', 'test.id', NaN)).rejects.toThrow('Invalid price');
  });
});
