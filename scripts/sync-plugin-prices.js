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

async function getRegionsVersion() {
  try {
    const res = await androidpublisher.monetization.convertRegionPrices({
      packageName: 'com.foxdebug.acode',
      requestBody: {
        price: { currencyCode: 'INR', units: '100', nanos: 0 },
      },
    });
    return res.data.regionVersion.version;
  } catch (_) {
    return '2025/05';
  }
}

async function upsertOneTimeProduct(plugin, sku, packageName, regionsVersion) {
  return androidpublisher.monetization.onetimeproducts.patch({
    packageName,
    productId: sku,
    allowMissing: true,
    updateMask: 'listings',
    'regionsVersion.version': regionsVersion,
    requestBody: {
      packageName,
      productId: sku,
      listings: [
        {
          languageCode: 'en-US',
          title: plugin.name,
          description: `Purchase ${plugin.name} (${plugin.id}) plugin for Acode editor`,
        },
      ],
    },
  });
}

async function syncPluginPrice(plugin, regionsVersion) {
  const sku = getPluginSKU(plugin.id);
  const result = { id: plugin.id, name: plugin.name, price: plugin.price, packages: {} };

  for (const packageName of PACKAGE_NAMES) {
    try {
      await upsertOneTimeProduct(plugin, sku, packageName, regionsVersion);
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

  const regionsVersion = await getRegionsVersion();
  console.log(`Regions version: ${regionsVersion}\n`);

  const plugins = getPaidPlugins();
  console.log(`Found ${plugins.length} paid plugin(s)\n`);

  if (plugins.length === 0) {
    console.log('No paid plugins to sync.');
    return;
  }

  const results = [];
  for (const plugin of plugins) {
    console.log(`Syncing "${plugin.name}" (${plugin.id}): INR ${plugin.price}`);
    const result = await syncPluginPrice(plugin, regionsVersion);
    results.push(result);
    const statuses = Object.values(result.packages);
    const allOk = statuses.every((s) => s.startsWith('OK'));
    console.log(`  ${allOk ? 'OK' : 'HAD ERRORS'}\n`);
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
