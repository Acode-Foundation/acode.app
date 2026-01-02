const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const moment = require('moment');
const { Router } = require('express');
const { google } = require('googleapis');
const Plugin = require('../entities/plugin');
const User = require('../entities/user');
const Order = require('../entities/purchaseOrder');
const Download = require('../entities/download');
const badWords = require('../badWords.json');
const { getLoggedInUser, getPluginSKU } = require('../lib/helpers');
const sendEmail = require('../lib/sendEmail');

const androidpublisher = google.androidpublisher('v3');

const router = Router();
const MIN_PRICE = 10;
const MAX_PRICE = 10000;
const VERSION_REGEX = /^\d+\.\d+\.\d+$/;
const ID_REGEX = /^[a-z][a-z0-9._]{3,49}$/i;
const validLicenses = [
  'MIT',
  'GPL-3.0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'LGPL-3.0',
  'MPL-2.0',
  'CDDL-1.0',
  'EPL-2.0',
  'AGPL-3.0',
  'Proprietary',
];

router.get('/owned/:sku', async (req, res) => {
  try {
    const { sku } = req.params;
    const [row] = await Plugin.get(Plugin.allColumns, [Plugin.SKU, sku]);
    if (!row) {
      res.status(404).send({ error: 'Not found' });
      return;
    }

    res.send(row);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { device, token, package: packageName } = req.query;
    const [row] = await Plugin.get([Plugin.ID, id]);
    if (!row) {
      res.status(404).send({ error: 'Not found' });
      return;
    }

    const clientIp = req.headers['x-forwarded-for'] || req.ip;

    /**
     * Helper function to record plugin download
     * @param {string} pkgName - Package name (or 'web' for web downloads)
     */
    async function recordDownload(pkgName) {
      try {
        if (!device || !clientIp || !pkgName) return;
        const columns = [
          [Download.PLUGIN_ID, id],
          [Download.DEVICE_ID, device],
          [Download.CLIENT_IP, clientIp],
          [Download.PACKAGE_NAME, pkgName],
        ];
        const deviceCountOnIp = await Download.count([
          [Download.CLIENT_IP, clientIp],
          [Download.PLUGIN_ID, id],
        ]);
        if (deviceCountOnIp < 5) {
          const [download] = await Download.get([
            [Download.PLUGIN_ID, id],
            [Download.DEVICE_ID, device],
          ]);
          if (!download) {
            await Download.insert(...columns);
            await Plugin.increment(Plugin.DOWNLOADS, 1, [Plugin.ID, id]);
          }
        }
      } catch (error) {
        console.error('Failed to record download:', error);
      }
    }

    if (row.price) {
      const loggedInUser = await getLoggedInUser(req);

      // Check for user-linked purchase (Razorpay or any provider)
      if (loggedInUser) {
        const [userOrder] = await Order.get([
          [Order.USER_ID, loggedInUser.id],
          [Order.PLUGIN_ID, row.id],
          [Order.STATE, Order.STATE_PURCHASED],
        ]);
        if (userOrder) {
          // User has valid purchase, allow download
          res.sendFile(path.resolve(__dirname, '../../data/plugins', `${id}.zip`));
          await recordDownload(packageName || 'web');
          return;
        }
      }

      // Fall back to token-based validation (Google Play)
      if (!token || !packageName) {
        res.status(403).send({ error: 'Forbidden' });
        return;
      }

      const [order] = await Order.get([Order.TOKEN, token]);

      if (order?.state && Number.parseInt(order.state, 10) !== Order.STATE_PURCHASED) {
        res.status(403).send({ error: 'Purchase not active.' });
        return;
      }

      try {
        const purchase = await androidpublisher.purchases.products.get({
          packageName,
          productId: row.sku,
          token,
        });
        const { purchaseState } = purchase.data;

        if (!order) {
          Order.insert(
            [Order.TOKEN, token],
            [Order.PACKAGE, packageName],
            [Order.AMOUNT, row.price],
            [Order.PLUGIN_ID, row.id],
            [Order.STATE, purchaseState],
          );
        }

        if (purchaseState !== 0) {
          throw new Error('Purchase is not active');
        }
      } catch (error) {
        const message = `Error while validating purchase: ${error.errors?.map((e) => e.message).join(', ') || error.message}`;
        res.status(403).send({ error: message });
        return;
      }
    }

    res.sendFile(path.resolve(__dirname, '../../data/plugins', `${id}.zip`));
    await recordDownload(packageName);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('/orders/:pluginId/:year/:month', async (req, res) => {
  try {
    const { pluginId, year, month } = req.params;
    const loggedInUser = await getLoggedInUser(req);
    if (!loggedInUser) {
      res.status(403).send({ error: 'Forbidden' });
      return;
    }

    const [plugin] = await Plugin.get([Plugin.ID, pluginId]);
    if (!plugin) {
      res.status(404).send({ error: 'Not found' });
      return;
    }

    if (plugin.user_id !== loggedInUser.id && !loggedInUser.isAdmin) {
      res.status(403).send({ error: 'Forbidden' });
      return;
    }

    const yearMonth = {
      month: Number.parseInt(month, 10),
      year: Number.parseInt(year, 10),
    };
    const monthStart = moment(yearMonth).startOf('month').format('YYYY-MM-DD');
    const monthEnd = moment(yearMonth).endOf('month').format('YYYY-MM-DD');
    const orders = await Order.get(Order.minColumns, [
      [Order.PLUGIN_ID, pluginId],
      [Order.CREATED_AT, [monthStart, monthEnd], 'BETWEEN'],
    ]);
    res.send(orders);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('/check-update/:id/:version', async (req, res) => {
  try {
    const { id, version } = req.params;
    const [row] = await Plugin.get([Plugin.ID, id]);
    if (!row) {
      res.status(404).send({ error: 'Not found' });
      return;
    }

    res.send({ update: row.version !== version });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('/count{/:type}', async (req, res) => {
  try {
    const { type } = req.params;
    const where = [];
    if (type === 'free') {
      where.push([Plugin.PRICE, 0], [Plugin.PRICE, null, 'IS']);
    } else if (type === 'paid') {
      where.push([Plugin.PRICE, 0, '>']);
    }

    const count = await Plugin.count(where, 'OR');
    res.send({ count });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('/description/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await Plugin.get([Plugin.DESCRIPTION], [Plugin.ID, id]);
    if (!row) {
      res.status(404).send({ error: 'Not found' });
      return;
    }

    res.send({ description: row.description });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('{/:pluginId}', async (req, res) => {
  try {
    const { pluginId } = req.params;
    const { user, name, status, page, limit, orderBy } = req.query;
    const loggedInUser = await getLoggedInUser(req);
    const columns = Plugin.minColumns;
    const where = [];
    let userId;

    if (user) {
      const [row] = await User.get([User.ID, user]);
      if (!row) {
        res.status(404).send({ error: 'Not found' });
        return;
      }
      userId = row.id;
    }

    if (pluginId) {
      columns.push(Plugin.CHANGELOGS);
      columns.push(Plugin.CONTRIBUTORS);
      columns.push(Plugin.DESCRIPTION);
      columns.push(Plugin.AUTHOR_EMAIL);
      columns.push(Plugin.AUTHOR_GITHUB);
      columns.push(Plugin.AUTHOR_GITHUB);
    }

    if (loggedInUser && (loggedInUser.isAdmin || loggedInUser.id === userId)) {
      columns.push(Plugin.STATUS);
    }

    if (!loggedInUser) {
      where.push([Plugin.STATUS, Plugin.STATUS_APPROVED]);
    } else if (loggedInUser.id === userId && !loggedInUser.isAdmin) {
      where.push([Plugin.STATUS, Plugin.STATUS_INACTIVE, '<>']);
    }

    if (pluginId) {
      where.push([Plugin.ID, pluginId]);
    } else if (userId) {
      where.push([Plugin.USER_ID, userId]);
    } else if (name) {
      where.push([Plugin.NAME, name, 'LIKE']);
    } else if (status && loggedInUser?.isAdmin) {
      where.push([Plugin.STATUS, status]);
    }

    const options = { page, limit };

    if (orderBy) {
      switch (orderBy) {
        case 'downloads':
          options.orderBy = 'downloads DESC';
          break;
        case 'newest':
          options.orderBy = 'created_at DESC';
          break;
        default:
          break;
      }
    } else {
      options.orderBy = ['votes_up DESC', 'downloads DESC', 'comment_count DESC', 'updated_at DESC', 'votes_down ASC'];
    }

    const rows = await Plugin.get(columns, where, options);

    if (pluginId) {
      const row = rows[0];
      if (!row) {
        res.status(404).send({ error: 'Not found' });
        return;
      }

      res.send(row);
      return;
    }

    res.send(rows);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.post('/refund', async (_req, res) => {
  res.send({ refer: 'https://pay.google.com' });
});

router.post('/order', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);
    const { id, token, package: packageName } = req.body;
    const [plugin] = await Plugin.get([Plugin.ID, id]);
    if (!plugin) {
      res.status(404).send({ error: 'Not found' });
      return;
    }

    if (!token || !packageName) {
      res.status(400).send({ error: 'Token and package name missing.' });
      return;
    }

    const order = await Order.get([Order.TOKEN, token]);
    if (order.length) {
      res.status(400).send({ error: 'Order already exists.' });
      return;
    }

    try {
      const purchase = await androidpublisher.purchases.products.get({
        packageName,
        productId: plugin.sku,
        token,
      });

      const [{ price }] = await Plugin.get([Plugin.PRICE], [Plugin.ID, id]);

      const orderInsert = [
        [Order.PLUGIN_ID, id],
        [Order.TOKEN, token],
        [Order.PACKAGE, packageName],
        [Order.AMOUNT, price],
        [Order.STATE, purchase.data.purchaseState],
        [Order.PROVIDER, Order.PROVIDER_GOOGLE_PLAY],
      ];
      // Link to user account if logged in (enables cross-platform sync)
      if (loggedInUser) {
        orderInsert.push([Order.USER_ID, loggedInUser.id]);
      }
      await Order.insert(...orderInsert);
      res.send({ success: 'Order saved.' });
    } catch (error) {
      const message = `Error while validating purchase: ${error.errors?.map((e) => e.message).join(', ') || error.message}`;
      res.status(403).send({ error: message });
    }
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { plugin: pluginZip } = req.files || {};

    if (!pluginZip) {
      res.status(400).send({ error: 'Plugin file is required' });
      return;
    }

    const { pluginJson, icon, readme, changelogs } = await exploreZip(pluginZip.data);

    try {
      validatePlugin(pluginJson, icon, readme);
    } catch (error) {
      res.status(400).send({ error: error.message });
      return;
    }

    const pluginId = pluginJson.id.toLowerCase();
    const [row] = await Plugin.get([Plugin.ID, pluginId]);

    if (row) {
      res.status(400).send({ error: `Plugin "${pluginId}" already exists.` });
      return;
    }

    const { name, price, version, minVersionCode } = pluginJson;

    if (!VERSION_REGEX.test(version)) {
      res.status(400).send({
        error: 'Invalid version number, version should be in the format x.x.x',
      });
      return;
    }

    if (typeof minVersionCode !== 'number') {
      res.status(400).send({ error: 'minVersionCode should be a number' });
      return;
    }

    if (price) {
      if (price < MIN_PRICE || price > MAX_PRICE) {
        res.status(400).send({
          error: `Price should be between INR ${MIN_PRICE} and INR ${MAX_PRICE}`,
        });
        return;
      }

      await registerSKU(name, pluginId, price);
    }

    const insert = [
      [Plugin.ID, pluginId],
      [Plugin.NAME, name],
      [Plugin.PRICE, price],
      [Plugin.VERSION, version],
      [Plugin.USER_ID, user.id],
      [Plugin.DESCRIPTION, readme],
      [Plugin.SKU, getPluginSKU(pluginId)],
      [Plugin.MIN_VERSION_CODE, minVersionCode],
    ];

    if (changelogs) {
      insert.push([Plugin.CHANGELOGS, changelogs]);
    }

    if (req.body?.changelogs) {
      insert.push([Plugin.CHANGELOGS, req.body.changelogs]);
    }

    if (pluginJson.license) {
      insert.push([Plugin.LICENSE, pluginJson.license]);
    }

    if (pluginJson.contributors) {
      insert.push([Plugin.CONTRIBUTORS, JSON.stringify(pluginJson.contributors)]);
    }

    if (pluginJson.keywords) {
      insert.push([Plugin.KEYWORDS, JSON.stringify(pluginJson.keywords)]);
    }

    if (pluginJson.repository) {
      insert.push([Plugin.REPOSITORY, pluginJson.repository]);
    }

    await Plugin.insert(...insert);

    savePlugin(pluginId, pluginZip, icon);
    res.send({ message: 'Plugin uploaded successfully' });

    User.get([User.EMAIL, User.NAME], [User.ROLE, 'admin']).then((rows) => {
      for (const row of rows) {
        sendEmail(
          row.email,
          row.name,
          'New plugin waiting for approval',
          `A new plugin <a href='https://acode.app/plugin/${pluginId}'><strong>${name}</strong></a> is waiting for approval.`,
        );
      }
    });
  } catch (error) {
    console.error('Error uploading plugin:', error);
    res.status(500).send({ error: 'Unable to upload plugin, please try again later, if issue persists contact support.' });
  }
});

router.put('/', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    let savePluginZip = false;

    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { plugin: pluginZip } = req.files;

    if (!pluginZip) {
      res.status(400).send({ error: 'Plugin file is required' });
      return;
    }

    const { pluginJson, icon, readme, changelogs } = await exploreZip(pluginZip.data);

    try {
      validatePlugin(pluginJson, icon, readme);
    } catch (error) {
      res.status(400).send({ error: error.message });
      return;
    }

    const { name, price, version } = pluginJson;
    const pluginId = pluginJson.id.toLowerCase();

    if (!VERSION_REGEX.test(version)) {
      res.status(400).send({
        error: 'Invalid version number, version should be in the format x.x.x',
      });
      return;
    }

    const [row] = await Plugin.get([Plugin.ID, Plugin.USER_ID, Plugin.VERSION, Plugin.NAME, Plugin.PRICE], [Plugin.ID, pluginId]);
    if (!row || row.user_id !== user.id) {
      res.status(404).send({ error: 'Plugin not found' });
      return;
    }

    const updates = [[Plugin.DESCRIPTION, readme]];

    if (pluginJson.license) {
      updates.push([Plugin.LICENSE, pluginJson.license]);
    }

    if (pluginJson.contributors) {
      updates.push([Plugin.CONTRIBUTORS, JSON.stringify(pluginJson.contributors)]);
    }

    if (pluginJson.keywords) {
      updates.push([Plugin.KEYWORDS, JSON.stringify(pluginJson.keywords)]);
    }

    if (pluginJson.repository) {
      updates.push([Plugin.REPOSITORY, pluginJson.repository]);
    }

    if (pluginJson.changelogs) {
      updates.push([Plugin.CHANGELOGS, pluginJson.changelogs]);
    }

    if (changelogs) {
      updates.push([Plugin.CHANGELOGS, changelogs]);
    }

    if (req.body?.changelogs) {
      updates.push([Plugin.CHANGELOGS, req.body.changelogs]);
    }

    if (version !== row.version) {
      if (!isVersionGreater(version, row.version)) {
        res.status(400).send({
          error: 'Version should be greater than the current version',
        });
        return;
      }
      updates.push([Plugin.VERSION, version]);
      savePluginZip = true;
    }

    if (name !== row.name) {
      updates.push([Plugin.NAME, name]);
    }

    if (row.price !== price) {
      if (price) {
        await registerSKU(name, pluginId, price);
      }
      updates.push([Plugin.PRICE, price]);
    }

    await Plugin.update(updates, [Plugin.ID, pluginId]);

    if (savePluginZip) {
      savePlugin(pluginId, pluginZip, icon);
    }
    res.send({ message: 'Plugin updated successfully' });
  } catch (error) {
    console.error('Error updating plugin:', error);
    res.status(500).send({ error: 'Unable to update plugin, please try again later, if issue persists contact support.' });
  }
});

router.patch('/', async (req, res) => {
  try {
    const { id, status, reason } = req.body;
    const user = await getLoggedInUser(req);

    if (!user.isAdmin) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    if (!id || !status) {
      res.status(400).send({ error: 'Missing required fields' });
      return;
    }

    const statusCode = status === 'approve' ? Plugin.STATUS_APPROVED : Plugin.STATUS_REJECTED;
    await Plugin.update([Plugin.STATUS, statusCode], [Plugin.ID, id]);
    res.send({ message: 'Plugin updated successfully' });

    try {
      const [{ user_id: userId, name: pluginName, id: pluginID }] = await Plugin.get([Plugin.USER_ID, Plugin.ID, Plugin.NAME], [Plugin.ID, id]);
      const [{ email, name }] = await User.get([User.EMAIL, User.NAME], [User.ID, userId]);
      const subject = status === 'approve' ? 'Plugin Approved' : 'Plugin Rejected';
      let message = `Your <a href='https://acode.app/plugin/${pluginID}'><strong>${pluginName}</strong></a> plugin for Acode editor`;

      if (status === 'approve') {
        message += ' has been approved, and is now available on the plugin store.';
      } else {
        message += ' has been rejected.';
        if (reason) {
          message += `<br><em><strong>Reason</strong> ${reason}</em>`;
        }
      }

      sendEmail(email, name, subject, message);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(error);
    }
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await getLoggedInUser(req);
    const { mode } = req.query;

    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    if (mode === 'hard' && user.isAdmin) {
      await Plugin.deletePermanently([Plugin.ID, id]);
      try {
        fs.unlinkSync(path.join(__dirname, `../../data/plugins/${id}.zip`));
        fs.unlinkSync(path.join(__dirname, `../../data/icons/${id}.png`));
      } catch (error) {
        // eslint-disable-next-line no-console
        console.log(error);
      }
      res.send({ message: 'Plugin deleted successfully' });
      return;
    }

    const [row] = await Plugin.get([Plugin.allColumns], [Plugin.ID, id]);
    if (!row || row.user_id !== user.id) {
      res.status(404).send({ error: 'Plugin not found' });
      return;
    }

    await Plugin.delete([Plugin.ID, id]);
    res.send({ message: 'Plugin deleted successfully' });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

async function exploreZip(file) {
  // Create a new JSZip instance for each request to avoid caching issues
  const zip = new JSZip();
  await zip.loadAsync(file);

  const pluginJsonFile = zip.file('plugin.json');
  if (!pluginJsonFile) {
    throw new Error('Missing plugin.json file in the zip.');
  }
  const pluginJson = JSON.parse(await pluginJsonFile.async('string'));

  const iconPath = pluginJson.icon || 'icon.png';
  const iconFile = zip.file(iconPath);
  let icon = null;
  if (iconFile) {
    icon = await iconFile?.async('base64');
  } else if (iconPath !== 'icon.png') {
    // If custom path failed, try the default path
    const defaultIconFile = zip.file('icon.png');
    if (defaultIconFile) {
      icon = await defaultIconFile.async('base64');
    }
  }

  const readmePath = pluginJson.readme || 'readme.md';
  let readmeFile = zip.file(readmePath);
  if (!readmeFile && readmePath !== 'readme.md') {
    // If custom path failed, try the default path
    readmeFile = zip.file('readme.md');
  }

  let readme = null;
  if (readmeFile) {
    const readmeContent = await readmeFile.async('string');
    readme = readmeContent?.trim?.();
  }

  const changelogsPath = pluginJson.changelogs || 'changelogs.md';
  let changelogsFile = zip.file(changelogsPath);
  if (!changelogsFile && changelogsPath !== 'changelogs.md') {
    // If custom path failed, try the default path
    changelogsFile = zip.file('changelogs.md');
  }

  let changelogs = null;
  if (changelogsFile) {
    const changelogsContent = await changelogsFile.async('string');
    changelogs = changelogsContent?.trim?.();
  }

  return { pluginJson, icon, readme, changelogs };
}

function savePlugin(id, file, icon) {
  file.mv(path.resolve(__dirname, '../../data/plugins', `${id}.zip`));
  fs.writeFile(path.resolve(__dirname, '../../data/icons', `${id}.png`), icon, 'base64', (err) => {
    // eslint-disable-next-line no-console
    if (err) console.log(err);
  });
}

function validatePlugin(json, icon, readmeFile) {
  if (!json) {
    throw new Error('Missing plugin.json file.');
  }

  if (!readmeFile) {
    throw new Error('Missing readme.md file.');
  }

  if (!icon) {
    throw new Error('Unable to load plugin icon: no icon was provided or the default icon (icon.png) is missing.');
  }

  const { name, version, main, license, contributors, keywords } = json;
  const id = json.id.toLowerCase();

  if (!ID_REGEX.test(id) || badWords.includes(id)) {
    throw new Error(
      'Invalid plugin ID! Valid ID should start with an alphabet, should be of length 4-50 and should contain only alphanumeric characters, dot and underscore.',
    );
  }

  if (!VERSION_REGEX.test(version)) {
    throw new Error('Invalid version number, version should be in the format <major>.<minor>.<patch> (e.g. 0.0.1)');
  }

  const requiredFields = { name, version, id, main };
  const missingFields = Object.entries(requiredFields)
    .filter(([_, value]) => !value)
    .map(([key]) => key);
  if (missingFields.length) {
    throw new Error(`Missing fields in plugin.json: ${missingFields.join(', ')}`);
  }

  const sizeInBytes = 4 * Math.ceil(icon.length / 3) * 0.5624896334383812;
  const sizeInKb = sizeInBytes / 1000;
  if (icon && sizeInKb >= 50) {
    throw new Error('Icon size should be less than 50kb');
  }

  if (license && !validLicenses.includes(license)) {
    throw new Error('Invalid license');
  }

  if (contributors) {
    const error = new Error('Contributors should be an array of {name, role, github}');
    if (!Array.isArray(contributors)) {
      throw error;
    }

    const invalidContributors = contributors.filter((contributor) => {
      for (const key in contributor) {
        if (!['role', 'github', 'name'].includes(key)) {
          return true;
        }
      }
      return false;
    });

    if (invalidContributors.length) {
      throw error;
    }
  }

  if (keywords) {
    const error = new Error('Keywords should be an array of string');
    if (!Array.isArray(keywords)) {
      throw error;
    }

    const invalidKeywords = keywords.filter((keyword) => typeof keyword !== 'string');
    if (invalidKeywords.length) {
      throw error;
    }
  }

  return null;
}

/**
 * Create a in-app product
 * @param {string} package
 * @param {string} name
 * @param {string} id
 * @param {number} price
 */
async function registerSKU(name, id, price) {
  const sku = getPluginSKU(id);
  if (!isValidPrice(price)) {
    throw new Error('Invalid price');
  }

  await register('com.foxdebug.acode');
  await register('com.foxdebug.acodefree');
  async function register(packageName) {
    try {
      const requestBody = {
        sku,
        packageName,
        status: 'active',
        defaultPrice: {
          currency: 'INR',
          priceMicros: price * 1000000,
        },
        defaultLanguage: 'en-US',
        purchaseType: 'managedUser',
        listings: {
          'en-US': {
            title: name,
            description: `Purchase ${name} (${id}) plugin for Acode editor`,
          },
        },
      };

      let skuAlreadyExists = false;

      try {
        await androidpublisher.inappproducts.get({
          sku,
          packageName,
        });
        skuAlreadyExists = true;
      } catch (_error) {
        // SKU does not exist
      }

      if (skuAlreadyExists) {
        await androidpublisher.inappproducts.update({
          sku,
          packageName,
          requestBody,
          autoConvertMissingPrices: true,
        });
        return;
      }

      await androidpublisher.inappproducts.insert({
        packageName,
        requestBody,
        autoConvertMissingPrices: true,
      });
    } catch (error) {
      const message = error.errors?.map(({ message: msg }) => msg).join('\n') || error.message;
      console.warn(`Failed to register SKU for ${packageName}, ${message}`);
      // Proceed without throwing, to allow Razorpay-only or local testing
    }
  }
}

function isValidPrice(price) {
  return price && !Number.isNaN(price) && price >= MIN_PRICE && price <= MAX_PRICE;
}

function isVersionGreater(newV, oldV) {
  const [newMajor, newMinor, newPatch] = newV.split('.').map(Number);
  const [oldMajor, oldMinor, oldPatch] = oldV.split('.').map(Number);

  if (newMajor > oldMajor) {
    return true;
  }

  if (newMajor === oldMajor && newMinor > oldMinor) {
    return true;
  }

  if (newMajor === oldMajor && newMinor === oldMinor && newPatch > oldPatch) {
    return true;
  }

  return false;
}

module.exports = router;
