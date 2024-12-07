const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const moment = require('moment');
const { Router } = require('express');
const { google } = require('googleapis');
const Plugin = require('../entities/plugin');
const User = require('../entities/user');
const Order = require('../entities/purchaseOrder');
const Download = require('../entities/download');
const badWords = require('../badWords.json');

const androidpublisher = google.androidpublisher('v3');
const {
  getLoggedInUser,
  sendNotification,
  getPluginSKU,
} = require('../helpers');

const router = Router();
const jsZip = new JSZip();
const MIN_PRICE = 10;
const MAX_PRICE = 10000;
const VERSION_REGEX = /^\d+\.\d+\.\d+$/;

router.get('/owned/:sku', async (req, res) => {
  try {
    const { sku } = req.params;
    const [row] = await Plugin.get(Plugin.minColumns, [Plugin.SKU, sku]);
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

    if (row.price) {
      if (!token || !packageName) {
        res.status(403).send({ error: 'Forbidden' });
        return;
      }

      const [order] = await Order.get([Order.TOKEN, token]);

      if (order && order.state && parseInt(order.state, 10) !== Order.STATE_PURCHASED) {
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
    try {
      if (device && clientIp && packageName) {
        const columns = [
          [Download.PLUGIN_ID, id],
          [Download.DEVICE_ID, device],
          [Download.CLIENT_IP, clientIp],
          [Download.PACKAGE_NAME, packageName],
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
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
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

    const yearMonth = { month: parseInt(month, 10), year: parseInt(year, 10) };
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

router.get('/count/:type?', async (req, res) => {
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

router.get('/:pluginId?', async (req, res) => {
  try {
    const { pluginId } = req.params;
    const {
      user: email,
      name,
      status,
      page,
      limit,
      orderBy,
    } = req.query;
    const loggedInUser = await getLoggedInUser(req);
    const columns = Plugin.minColumns;
    const where = [];
    let userId;

    if (email) {
      const [row] = await User.get([User.EMAIL, email]);
      if (!row) {
        res.status(404).send({ error: 'Not found' });
        return;
      }
      userId = row.id;
    }

    if (pluginId) {
      columns.push(Plugin.DESCRIPTION);
      columns.push(Plugin.AUTHOR);
      columns.push(Plugin.PRICE);
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

router.post('/refund', async (req, res) => {
  res.send({ refer: 'https://pay.google.com' });
});

router.post('/order', async (req, res) => {
  try {
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

      await Order.insert(
        [Order.PLUGIN_ID, id],
        [Order.TOKEN, token],
        [Order.PACKAGE, packageName],
        [Order.AMOUNT, price],
        [Order.STATE, purchase.data.purchaseState],
      );
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
    // Id should start with an alphabet,
    // should be of length 4-20 and should contain only alphanumeric characters,
    // dot and underscore
    const ID_REGEX = /^[a-zA-Z][a-zA-Z0-9._]{3,49}$/;
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

    const { pluginJson, icon, readme } = await exploreZip(pluginZip.data);
    const errorMessage = validatePlugin(pluginJson, icon, readme);

    if (errorMessage) {
      res.status(400).send({ error: errorMessage });
      return;
    }

    const {
      name,
      version,
      price,
      minVersionCode,
    } = pluginJson;

    if (!VERSION_REGEX.test(version)) {
      res.status(400).send({ error: 'Invalid version number, version should be in the format x.x.x' });
      return;
    }

    if (typeof minVersionCode !== 'number') {
      res.status(400).send({ error: 'minVersionCode should be a number' });
      return;
    }

    let { id } = pluginJson;

    if (!ID_REGEX.test(id) || badWords.includes(id)) {
      res.status(400).send({ error: 'Invalid plugin ID! Valid ID should start with an alphabet, should be of length 4-50 and should contain only alphanumeric characters, dot and underscore.' });
      return;
    }

    id = id.toLowerCase();

    const [row] = await Plugin.get([Plugin.ID, id]);
    if (row) {
      res.status(400).send({ error: 'Plugin already exists.' });
      return;
    }

    if (price) {
      if (price < MIN_PRICE || price > MAX_PRICE) {
        res.status(400).send({ error: `Price should be between INR ${MIN_PRICE} and INR ${MAX_PRICE}` });
        return;
      }

      await registerSKU(name, id, price);
    }

    await Plugin.insert(
      [Plugin.ID, id],
      [Plugin.SKU, getPluginSKU(id)],
      [Plugin.NAME, name],
      [Plugin.PRICE, price],
      [Plugin.VERSION, version],
      [Plugin.USER_ID, user.id],
      [Plugin.DESCRIPTION, readme],
      [Plugin.MIN_VERSION_CODE, minVersionCode],
    );

    savePlugin(id, pluginZip, icon);
    sendNotification('dellevenjack@gmail.com', 'Ajit Kumar', 'New plugin waiting for approval', `A new plugin <a href='https://acode.app/plugin/${id}'><strong>${name}</strong></a> is waiting for approval.`);
    res.send({ message: 'Plugin uploaded successfully' });
  } catch (error) {
    res.status(500).send({ error: error.message });
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

    const { pluginJson, icon, readme } = await exploreZip(pluginZip.data);

    const errorMessage = validatePlugin(pluginJson, icon, readme);
    if (errorMessage) {
      res.status(400).send({ error: errorMessage });
      return;
    }

    const {
      name, version, id: pluginId, price,
    } = pluginJson;

    if (!VERSION_REGEX.test(version)) {
      res.status(400).send({ error: 'Invalid version number, version should be in the format x.x.x' });
      return;
    }

    const [row] = await Plugin.get([
      Plugin.ID,
      Plugin.USER_ID,
      Plugin.VERSION,
      Plugin.NAME,
      Plugin.PRICE,
    ], [Plugin.ID, pluginId]);
    if (!row || row.user_id !== user.id) {
      res.status(404).send({ error: 'Plugin not found' });
      return;
    }

    const updates = [
      [Plugin.DESCRIPTION, readme],
    ];

    if (version !== row.version) {
      if (!isVersionGreater(version, row.version)) {
        res.status(400).send({ error: 'Version should be greater than the current version' });
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
    res.status(500).send({ error: error.message });
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
      const [{
        user_id: userId,
        name: pluginName,
        id: pluginID,
      }] = await Plugin.get([Plugin.USER_ID, Plugin.ID, Plugin.NAME], [Plugin.ID, id]);
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

      sendNotification(email, name, subject, message);
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
  const zip = await jsZip.loadAsync(file);
  const pluginJson = JSON.parse(await zip.file('plugin.json')?.async('string'));
  const icon = await zip.file('icon.png')?.async('base64');
  const readme = await zip.file('readme.md')?.async('string');

  return { pluginJson, icon, readme };
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
    return 'Invalid plugin file.';
  }

  if (!readmeFile) {
    return 'Missing readme file.';
  }

  const {
    name, version, id, main,
  } = json;

  const missingFields = [name, version, id, main].filter((field) => !field);
  if (missingFields.length) {
    return `Missing required fields: ${missingFields.join(', ')}`;
  }

  const sizeInBytes = 4 * Math.ceil((icon.length / 3)) * 0.5624896334383812;
  const sizeInKb = sizeInBytes / 1000;
  if (icon && sizeInKb >= 50) {
    return 'Icon size should be less than 50kb';
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
      } catch (error) {
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
      const message = error.errors?.map(({ message: msg }) => msg).join('\n');
      throw new Error(`Failed to register SKU, ${message}`);
    }
  }
}

function isValidPrice(price) {
  return price && !Number.isNaN(price) && price >= MIN_PRICE && price <= MAX_PRICE;
}

function isVersionGreater(v1, v2) {
  const v1Arr = v1.split('.');
  const v2Arr = v2.split('.');

  for (let i = 0; i < 3; i++) {
    if (v1Arr[i] > v2Arr[i]) {
      return true;
    }
  }

  return false;
}

module.exports = router;
