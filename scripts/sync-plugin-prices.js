const path = require('node:path');
const sqlite3 = require('better-sqlite3');
const { google } = require('googleapis');
const { getPluginSKU } = require('../server/lib/helpers');

const DB_FILE = path.resolve(__dirname, '../data/db.sqlite3');
const db = sqlite3(DB_FILE);

const androidpublisher = google.androidpublisher('v3');

const PACKAGE_NAMES = ['com.foxdebug.acode', 'com.foxdebug.acodefree'];

async function authenticate() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.resolve(__dirname, '../data/key.json'),
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const client = await auth.getClient();
  google.options({ auth: client });
}

function getPaidPlugins() {
  return db.prepare('SELECT id, name, price, sku FROM plugin WHERE price > 0').all();
}

function flattenErrors(err) {
  const all = [];
  for (const source of [err.errors, err.cause?.errors, [err.status || (err.code && { message: err.message })]]) {
    if (Array.isArray(source)) {
      for (const e of source) {
        if (e?.message) all.push(e.message);
      }
    }
  }
  if (!all.length && err.message) all.push(err.message);
  return all;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getRegionPricing(price) {
  try {
    const res = await androidpublisher.monetization.convertRegionPrices({
      packageName: 'com.foxdebug.acode',
      requestBody: {
        price: {
          currencyCode: 'INR',
          units: String(Math.floor(price)),
          nanos: Math.round((price % 1) * 1000000000),
        },
      },
    });
    return {
      version: res.data.regionVersion.version,
      regionPrices: res.data.convertedRegionPrices || {},
    };
  } catch (_) {
    console.warn(`  convertRegionPrices failed for INR ${price}, falling back to India-only pricing`);
    return { version: '2025/05', regionPrices: {} };
  }
}

async function deleteLegacyProduct(packageName, sku) {
  try {
    await androidpublisher.inappproducts.get({ packageName, sku });
    await androidpublisher.inappproducts.delete({ packageName, sku });
    return true;
  } catch (err) {
    if (err.code === 404) return false;
    console.warn(`  Legacy product check/delete failed (${packageName}/${sku}): ${err.message}`);
    return false;
  }
}

async function upsertOneTimeProduct(plugin, sku, packageName, regionPricing) {
  let existingOptions = [];
  let isNew = false;
  try {
    const { data } = await androidpublisher.monetization.onetimeproducts.get({
      packageName,
      productId: sku,
    });
    existingOptions = data.purchaseOptions || [];
  } catch (err) {
    if (err.code !== 404) throw err;
    isNew = true;
  }

  if (isNew) {
    await deleteLegacyProduct(packageName, sku);
  }

  const newConfigs = Object.entries(regionPricing.regionPrices).map(([regionCode, region]) => {
    const units = region.price.units || 0;
    const nanos = region.price.nanos || 0;
    return {
      regionCode,
      availability: 'AVAILABLE',
      price: {
        currencyCode: region.price.currencyCode,
        units: String(units === 0 && nanos === 0 ? 1 : units),
        nanos: units === 0 && nanos === 0 ? 0 : nanos,
      },
    };
  });

  if (!newConfigs.length) {
    newConfigs.push({
      regionCode: 'IN',
      availability: 'AVAILABLE',
      price: {
        currencyCode: 'INR',
        units: String(Math.floor(plugin.price)),
        nanos: Math.round((plugin.price % 1) * 1000000000),
      },
    });
  }

  let purchaseOptions;
  if (existingOptions.length > 0) {
    const newConfigMap = new Map(newConfigs.map((c) => [c.regionCode, c]));
    purchaseOptions = existingOptions.map((po) => {
      const oldConfigs = po.regionalPricingAndAvailabilityConfigs || [];
      const mergedMap = new Map(oldConfigs.map((c) => [c.regionCode, c]));
      for (const [code, config] of newConfigMap) {
        mergedMap.set(code, config);
      }
      return {
        ...po,
        regionalPricingAndAvailabilityConfigs: Array.from(mergedMap.values()),
      };
    });
  } else {
    purchaseOptions = [
      {
        purchaseOptionId: 'default',
        buyOption: {},
        regionalPricingAndAvailabilityConfigs: newConfigs,
      },
    ];
  }

  await androidpublisher.monetization.onetimeproducts.patch({
    packageName,
    productId: sku,
    allowMissing: true,
    updateMask: 'listings,purchaseOptions',
    'regionsVersion.version': regionPricing.version,
    requestBody: {
      packageName,
      productId: sku,
      purchaseOptions,
      listings: [
        {
          languageCode: 'en-US',
          title: plugin.name,
          description: `Purchase ${plugin.name} (${plugin.id}) plugin for Acode editor`,
        },
      ],
    },
  });

  try {
    await androidpublisher.monetization.onetimeproducts.purchaseOptions.batchUpdateStates({
      packageName,
      productId: sku,
      requestBody: {
        requests: purchaseOptions.map((po) => ({
          activatePurchaseOptionRequest: {
            packageName,
            productId: sku,
            purchaseOptionId: po.purchaseOptionId,
          },
        })),
      },
    });
  } catch (err) {
    console.warn(`  Activate purchase options failed for ${packageName}/${sku}: ${err.message}`);
  }
}

async function syncPluginPrice(plugin) {
  const sku = getPluginSKU(plugin.id);
  const regionPricing = await getRegionPricing(plugin.price);
  const result = { id: plugin.id, name: plugin.name, price: plugin.price, packages: {} };

  for (const packageName of PACKAGE_NAMES) {
    try {
      await upsertOneTimeProduct(plugin, sku, packageName, regionPricing);
      result.packages[packageName] = 'OK';
    } catch (error) {
      result.packages[packageName] = `FAILED: ${flattenErrors(error).join('; ') || error.message}`;
      console.error(`  SKU sync failed for ${packageName}:`, result.packages[packageName]);
    }
  }

  return result;
}

async function main() {
  console.log('Syncing plugin prices to Google Play (OneTimeProducts API)...\n');

  await authenticate();
  console.log('Authenticated with Google Play API\n');

  const plugins = getPaidPlugins();
  const targetSku = process.argv.includes('--sku') ? process.argv[process.argv.indexOf('--sku') + 1] : null;

  if (targetSku) {
    const filtered = plugins.filter((p) => getPluginSKU(p.id) === targetSku);
    if (filtered.length === 0) {
      console.log(`No paid plugin found with SKU "${targetSku}".`);
      return;
    }
    console.log(`Filtered to SKU "${targetSku}": ${filtered.length} plugin(s)`);
    plugins.length = 0;
    plugins.push(...filtered);
  }

  console.log(`Syncing ${plugins.length} paid plugin(s)\n`);

  if (plugins.length === 0) {
    console.log('No paid plugins to sync.');
    return;
  }

  const results = [];
  for (const plugin of plugins) {
    console.log(`Syncing "${plugin.name}" (${plugin.id}): INR ${plugin.price}`);
    const result = await syncPluginPrice(plugin);
    results.push(result);
    const statuses = Object.values(result.packages);
    const allOk = statuses.every((s) => s.startsWith('OK'));
    console.log(`  ${allOk ? 'OK' : 'HAD ERRORS'}\n`);

    if (plugins.length > 1) {
      await sleep(500);
    }
  }

  console.log('---');
  console.log('Summary:');
  let ok = 0;
  let failed = 0;
  for (const r of results) {
    const statuses = Object.entries(r.packages);
    for (const [_pkg, status] of statuses) {
      if (status.startsWith('OK')) ok++;
      else failed++;
    }
  }
  console.log(`  OK: ${ok}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results) {
      for (const [pkg, status] of Object.entries(r.packages)) {
        if (!status.startsWith('OK')) {
          console.log(`  ${r.id} (${pkg}): ${status}`);
        }
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
