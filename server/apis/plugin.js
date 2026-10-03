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
const PluginScan = require('../entities/pluginScan');
const badWords = require('../badWords.json');
const { getLoggedInUser, getWebLoggedInUser, getPluginSKU, detectUserCurrency, formatAmount } = require('../lib/helpers');
const getRazorpay = require('../lib/razorpay');
const sendEmail = require('../lib/sendEmail');
const { convertPrice } = require('../lib/exchangeRates');
const { isModeKeywordSafe, validateModeRegex } = require('../lib/modeRegex');
const { scanUpload, decideUpdate, scanRowFields, serializeChanges, parseChanges, presentScan } = require('../lib/pluginScanner');

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

function legacyModeScore(mode, keyword) {
  if (mode === keyword) return 100;
  if (mode.startsWith(keyword)) return 80 - keyword.length;
  if (mode.includes(keyword)) return 50 + keyword.length;
  return 0;
}

/**
 * Score a mode entry against a search keyword.
 * Returns 0 for no match, higher = better.
 * Supports the new regex field and keeps legacy mode strings working.
 */
function matchScore(entry, keyword) {
  const rawKeyword = String(keyword || '').trim();
  if (!rawKeyword || !isModeKeywordSafe(rawKeyword)) return 0;

  if (!entry.regex) return legacyModeScore(String(entry.mode || '').toLowerCase(), rawKeyword.toLowerCase());

  const regexValidation = validateModeRegex(entry.regex);
  if (!regexValidation.valid) return 0;

  try {
    const match = rawKeyword.match(new RegExp(entry.regex));
    if (!match) return 0;

    const matchedText = match[0];
    const exact = matchedText === rawKeyword ? 10000 : 0;
    const anchored = match.index === 0 ? 1000 : 0;
    return exact + anchored + matchedText.length * 100 - match.index;
  } catch {
    return 0;
  }
}

function getMatchingModeEntries(modes, keyword) {
  return modes
    .map((m, index) => ({ m, index, score: matchScore(m, keyword) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => s.m);
}

function getModePluginIds(modes, keyword) {
  const allIds = new Set();
  for (const entry of getMatchingModeEntries(modes, keyword)) {
    for (const id of entry.pluginIds || []) {
      allIds.add(id);
    }
  }
  return [...allIds];
}

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

    const loggedInUser = row.price ? await getLoggedInUser(req) : null;

    if (row.price && !loggedInUser?.isAdmin) {
      // Check for user-linked purchase (Razorpay or any provider)
      if (loggedInUser) {
        const [userOrder] = await Order.for('internal').get(
          [Order.ID, Order.TOKEN, Order.PROVIDER, Order.PACKAGE],
          [
            [Order.USER_ID, loggedInUser.id],
            [Order.PLUGIN_ID, row.id],
            [Order.STATE, Order.STATE_PURCHASED],
          ],
        );
        if (userOrder) {
          const purchaseValid = await verifyPurchase(userOrder, row);
          if (purchaseValid) {
            res.sendFile(path.resolve(__dirname, '../../data/plugins', `${id}.zip`));
            await recordDownload(id, device, clientIp, packageName || 'web');
            return;
          }
          // Purchase revoked (refunded outside our system) — cancel in DB
          await Order.update([[Order.STATE, Order.STATE_CANCELED]], [Order.ID, userOrder.id]);
          res.status(403).send({ error: 'Purchase is no longer active.' });
          return;
        }
      }

      // Fall back to token-based validation (Google Play)
      if (!token || !packageName) {
        res.status(403).send({ error: 'Forbidden' });
        return;
      }

      const [order] = await Order.for('internal').get([Order.TOKEN, token]);

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
          const orderInsert = [
            [Order.TOKEN, token],
            [Order.PACKAGE, packageName],
            [Order.AMOUNT, row.price],
            [Order.PLUGIN_ID, row.id],
            [Order.STATE, Number(purchaseState)],
            [Order.PROVIDER, Order.PROVIDER_GOOGLE_PLAY],
          ];
          if (loggedInUser) {
            orderInsert.push([Order.USER_ID, loggedInUser.id]);
          }
          await Order.insert(...orderInsert);
        }

        if (Number(purchaseState) !== 0) {
          throw new Error('Purchase is not active');
        }
      } catch (error) {
        const message = `Error while validating purchase: ${error.errors?.map((e) => e.message).join(', ') || error.message}`;
        res.status(403).send({ error: message });
        return;
      }
    }

    res.sendFile(path.resolve(__dirname, '../../data/plugins', `${id}.zip`));
    await recordDownload(id, device, clientIp, packageName);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('/orders/:pluginId/:year/:month', async (req, res) => {
  try {
    const { pluginId, year, month } = req.params;
    const loggedInUser = await getWebLoggedInUser(req);
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

    res.send({
      update: isVersionGreater(row.version, version),
      version: row.version,
    });
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
    const { user, name, status, page, limit, orderBy, supported_editor, owned } = req.query;
    const loggedInUser = await getLoggedInUser(req);
    const isAppAdmin = loggedInUser?.isAdmin === true && loggedInUser.authType === 'app';
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
      columns.push(Plugin.STATUS);
      columns.push(Plugin.STATUS_TEXT);
      where.push([Plugin.ID, pluginId]);
    } else {
      if (loggedInUser && (loggedInUser.isAdmin || loggedInUser.id === userId)) {
        columns.push(Plugin.STATUS);
        columns.push(Plugin.STATUS_TEXT);
      }

      if (!loggedInUser) {
        where.push([Plugin.STATUS, Plugin.STATUS_APPROVED]);
      } else if (loggedInUser.id === userId && !loggedInUser.isAdmin) {
        where.push([Plugin.STATUS, Plugin.STATUS_DELETED, '<>']);
      } else if (!loggedInUser.isAdmin) {
        where.push([Plugin.STATUS, Plugin.STATUS_APPROVED]);
      }

      if (userId) {
        where.push([Plugin.USER_ID, userId]);
      }

      if (name) {
        if (name.startsWith('mode:') && name.length > 5) {
          const modeKeyword = name.slice(5);
          const modeFile = path.resolve(__dirname, '../../data/mode-plugins.json');
          let modePluginIds = [];
          try {
            const raw = await fs.promises.readFile(modeFile, 'utf8');
            const data = JSON.parse(raw);
            const modes = data.modes || [];
            modePluginIds = getModePluginIds(modes, modeKeyword);
          } catch (err) {
            if (err.code !== 'ENOENT') {
              console.error('Failed to read mode-plugins.json:', err.message);
            }
          }
          if (modePluginIds.length) {
            where.push([Plugin.ID, modePluginIds, 'IN']);
          } else {
            where.push([1, 2]);
          }
        } else {
          where.push([Plugin.NAME, name, 'LIKE']);
        }
      }

      if (status && loggedInUser?.isAdmin) {
        where.push([Plugin.STATUS, status]);
      }

      if (owned === 'true') {
        if (!loggedInUser) {
          res.status(401).send({ error: 'Unauthorized' });
          return;
        }
        const ownedOrders = await Order.for('internal').get(
          [Order.PLUGIN_ID],
          [
            [Order.USER_ID, loggedInUser.id],
            [Order.STATE, Order.STATE_PURCHASED],
          ],
        );
        if (!ownedOrders.length) {
          res.send([]);
          return;
        }
        where.push([Plugin.ID, ownedOrders.map((o) => String(o.plugin_id)), 'IN']);
      }

      const origin = req.headers.origin || req.headers.referer;
      const allowAllEditors = Boolean(origin?.startsWith(process.env.HOST));

      if (supported_editor && ['ace', 'cm', 'all'].includes(supported_editor)) {
        where.push([Plugin.SUPPORTED_EDITOR, supported_editor]);

        if (supported_editor !== 'all') {
          where.push('OR', [Plugin.SUPPORTED_EDITOR, 'all']);
        }
      } else if (!supported_editor && !allowAllEditors) {
        where.push([Plugin.SUPPORTED_EDITOR, 'all'], 'OR', [Plugin.SUPPORTED_EDITOR, 'cm']);
      }
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
    const currency = detectUserCurrency(req);
    const paidPluginIds = rows.filter((r) => r.price).map((r) => r.id);
    let ownedIds = new Set();

    if (loggedInUser && !isAppAdmin) {
      if (paidPluginIds.length) {
        const ownedOrders = await Order.for('internal').get(
          [Order.PLUGIN_ID],
          [
            [Order.USER_ID, loggedInUser.id],
            [Order.PLUGIN_ID, paidPluginIds, 'IN'],
            [Order.STATE, Order.STATE_PURCHASED],
          ],
        );
        ownedIds = new Set(ownedOrders.map((o) => String(o.plugin_id)));
      }
    }

    for (const row of rows) {
      if (row.price) {
        const converted = await convertPrice(row.price, currency.code);
        row.price = formatAmount(converted.amount, converted.currency);
        row.currency = converted.currency;
        row.currencySymbol = converted.symbol;
      }

      row.owned = isAppAdmin || !row.price || ownedIds.has(String(row.id));
    }

    if (pluginId) {
      const row = rows[0];
      if (!row) {
        res.status(404).send({ error: 'Not found' });
        return;
      }

      const isOwner = loggedInUser && loggedInUser.id === row.user_id;

      if (row.status === Plugin.STATUS_DELETED && !loggedInUser?.isAdmin) {
        res.status(404).send({ error: 'Not found' });
        return;
      }

      if (row.status !== Plugin.STATUS_APPROVED && !loggedInUser?.isAdmin && !isOwner) {
        res.status(404).send({ error: 'Not found' });
        return;
      }

      if (!loggedInUser?.isAdmin && !isOwner) {
        row.status = undefined;
        row.status_text = undefined;
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
    const user = await getWebLoggedInUser(req);
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

    const { name, price, version, minVersionCode = -1 } = pluginJson;

    if (!VERSION_REGEX.test(version)) {
      res.status(400).send({
        error: 'Invalid version number, version should be in the format x.x.x',
      });
      return;
    }

    if (typeof minVersionCode !== 'number') {
      res.status(400).send({ error: `minVersionCode should be a number but got ${typeof minVersionCode}` });
      return;
    }

    let skuErrors = [];

    if (price) {
      if (price < MIN_PRICE || price > MAX_PRICE) {
        res.status(400).send({
          error: `Price should be between ₹${MIN_PRICE} and ₹${MAX_PRICE}`,
        });
        return;
      }

      skuErrors = await registerSKU(name, pluginId, price);
      if (skuErrors.length) {
        console.error('Google Play SKU registration had errors:', skuErrors);
      }
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

    if (req.body?.changelogs) {
      insert.push([Plugin.CHANGELOGS, req.body.changelogs]);
    }

    const supportedEditor = req.body?.supported_editor && ['cm', 'all'].includes(req.body.supported_editor) ? req.body.supported_editor : 'cm';
    insert.push([Plugin.SUPPORTED_EDITOR, supportedEditor]);

    await Plugin.insert(...insert);

    await savePlugin(pluginId, pluginZip.data, icon);

    const response = { message: 'Plugin uploaded successfully' };
    if (skuErrors.length) {
      response.warning = 'Plugin created but Google Play SKU registration had errors';
      response.skuErrors = skuErrors;
    }
    res.send(response);

    // New plugins already wait for admin approval; the scan gives the reviewer evidence.
    const decision = await recordScan({
      pluginId,
      userId: user.id,
      version,
      kind: PluginScan.KIND_PUBLISH,
      status: PluginScan.STATUS_RECORDED,
      uploadPath: livePath(pluginId),
      zipBuffer: pluginZip.data,
    });
    notifyAdmins(
      'New plugin waiting for approval',
      `A new plugin <a href='https://acode.app/plugin/${pluginId}'><strong>${escapeHtml(name)}</strong></a> is waiting for approval.${scanSummaryHtml(decision)}`,
    );
  } catch (error) {
    console.error('Error uploading plugin:', error);
    res.status(500).send({ error: 'Unable to upload plugin, please try again later, if issue persists contact support.' });
  }
});

router.put('/', async (req, res) => {
  try {
    const user = await getWebLoggedInUser(req);

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

    const { name, price, version } = pluginJson;
    const pluginId = pluginJson.id.toLowerCase();

    if (!VERSION_REGEX.test(version)) {
      res.status(400).send({
        error: 'Invalid version number, version should be in the format x.x.x',
      });
      return;
    }

    const [row] = await Plugin.get([Plugin.ID, Plugin.USER_ID, Plugin.VERSION, Plugin.NAME, Plugin.PRICE, Plugin.STATUS], [Plugin.ID, pluginId]);
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

    if (req.body?.supported_editor && ['ace', 'cm', 'all'].includes(req.body.supported_editor)) {
      updates.push([Plugin.SUPPORTED_EDITOR, req.body.supported_editor]);
    }

    const packageChanged = version !== row.version;
    if (packageChanged) {
      if (!isVersionGreater(version, row.version)) {
        res.status(400).send({
          error: 'Version should be greater than the current version',
        });
        return;
      }
      updates.push([Plugin.VERSION, version]);
    }

    if (name !== row.name) {
      updates.push([Plugin.NAME, name]);
    }

    if (row.price !== price) {
      updates.push([Plugin.PRICE, price]);
    }

    // Users install published plugins automatically, so new code for a published
    // plugin is scanned before it replaces the live zip. Unpublished plugins are
    // reviewed as a whole when an admin approves them.
    if (packageChanged && row.status === Plugin.STATUS_APPROVED) {
      const outcome = await scanPublishedUpdate({ row, user, version, updates, zipBuffer: pluginZip.data, icon });
      if (outcome.held) {
        res.send({
          message: `Version ${version} was submitted for review and will go live once an admin approves it.`,
          review: true,
          reasons: outcome.decision.reasons,
        });
        notifyHeldUpdate({ pluginId, name, version, user, decision: outcome.decision });
        return;
      }
    }

    const skuErrors = await applyPluginUpdate(pluginId, updates, name);

    if (packageChanged && row.status !== Plugin.STATUS_APPROVED) {
      await savePlugin(pluginId, pluginZip.data, icon);
    }

    const response = { message: 'Plugin updated successfully' };
    if (skuErrors.length) {
      response.warning = 'Price updated on website but Google Play SKU sync had errors';
      response.skuErrors = skuErrors;
      console.error('Google Play SKU registration had errors:', skuErrors);
    }
    res.send(response);

    if (packageChanged && row.status !== Plugin.STATUS_APPROVED) {
      await recordScan({
        pluginId,
        userId: user.id,
        version,
        previousVersion: row.version,
        kind: PluginScan.KIND_UPDATE,
        status: PluginScan.STATUS_APPLIED,
        uploadPath: livePath(pluginId),
        zipBuffer: pluginZip.data,
      });
    }
  } catch (error) {
    console.error('Error updating plugin:', error);
    if (!res.headersSent) {
      res.status(500).send({ error: 'Unable to update plugin, please try again later, if issue persists contact support.' });
    }
  }
});

router.get('/scans/pending', async (req, res) => {
  try {
    const user = await getWebLoggedInUser(req);
    if (!user?.isAdmin) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const rows = await PluginScan.get([PluginScan.STATUS, PluginScan.STATUS_PENDING], { orderBy: 'id ASC', limit: 200 });
    const ids = [...new Set(rows.map((row) => row.plugin_id))];
    const plugins = ids.length ? await Plugin.get([Plugin.ID, Plugin.NAME, Plugin.AUTHOR], [Plugin.ID, ids], { limit: ids.length }) : [];
    const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));

    res.send(
      rows.map((row) => ({
        ...presentScan(row, { isAdmin: true }),
        pluginName: byId.get(row.plugin_id)?.name || row.plugin_id,
        author: byId.get(row.plugin_id)?.author || '',
      })),
    );
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.get('/:id/scans', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await getWebLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const [plugin] = await Plugin.get([Plugin.ID, Plugin.USER_ID], [Plugin.ID, id]);
    if (!plugin || (!user.isAdmin && plugin.user_id !== user.id)) {
      res.status(404).send({ error: 'Not found' });
      return;
    }

    const columns = user.isAdmin ? ['*'] : PluginScan.summaryColumns;
    const rows = await PluginScan.get(columns, [PluginScan.PLUGIN_ID, id], { orderBy: 'id DESC', limit: 10 });
    const scans = rows.map((row) => presentScan(row, { isAdmin: user.isAdmin }));
    res.send({
      pending: scans.find((scan) => scan.status === PluginScan.STATUS_PENDING) || null,
      scans,
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.post('/scans/:scanId/review', async (req, res) => {
  try {
    const user = await getWebLoggedInUser(req);
    if (!user?.isAdmin) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { action } = req.body || {};
    const reason = String(req.body?.reason || '').trim();
    if (!['approve', 'reject'].includes(action)) {
      res.status(400).send({ error: 'Action must be approve or reject' });
      return;
    }

    const [scan] = await PluginScan.get([PluginScan.ID, Number(req.params.scanId)]);
    if (!scan || scan.status !== PluginScan.STATUS_PENDING) {
      res.status(404).send({ error: 'No pending update found for this scan' });
      return;
    }

    const pluginId = scan.plugin_id;
    const [plugin] = await Plugin.get([Plugin.ID, Plugin.NAME, Plugin.USER_ID, Plugin.VERSION], [Plugin.ID, pluginId]);
    if (!plugin) {
      res.status(404).send({ error: 'Plugin not found' });
      return;
    }

    const review = [
      [PluginScan.REVIEWED_BY, user.id],
      [PluginScan.REVIEWED_AT, moment().format('YYYY-MM-DD HH:mm:ss')],
      [PluginScan.REVIEW_MESSAGE, reason || null],
    ];

    let skuErrors = [];
    if (action === 'approve') {
      if (!fs.existsSync(stagedZipPath(pluginId))) {
        res.status(409).send({ error: 'The staged zip for this update is missing; ask the developer to upload it again.' });
        return;
      }
      if (!isVersionGreater(scan.version, plugin.version)) {
        await PluginScan.update([[PluginScan.STATUS, PluginScan.STATUS_SUPERSEDED], ...review], [PluginScan.ID, scan.id]);
        res.status(409).send({ error: `The live version (${plugin.version}) is already newer than ${scan.version}.` });
        return;
      }

      await promoteStaged(pluginId);
      const changes = parseChanges(scan.changes);
      const newName = changes.find(([column]) => column === Plugin.NAME)?.[1] || plugin.name;
      skuErrors = await applyPluginUpdate(pluginId, changes, newName);
      await PluginScan.update([[PluginScan.STATUS, PluginScan.STATUS_APPROVED], ...review], [PluginScan.ID, scan.id]);
    } else {
      await discardStaged(pluginId);
      await PluginScan.update([[PluginScan.STATUS, PluginScan.STATUS_REJECTED], ...review], [PluginScan.ID, scan.id]);
    }

    res.send({
      message: action === 'approve' ? `Version ${scan.version} is now live.` : `Version ${scan.version} was rejected.`,
      ...(skuErrors.length && { warning: 'Google Play SKU sync had errors', skuErrors }),
    });

    notifyDeveloper(plugin.user_id, {
      subject: action === 'approve' ? 'Plugin update approved' : 'Plugin update rejected',
      html:
        action === 'approve'
          ? `Version ${escapeHtml(scan.version)} of <a href='https://acode.app/plugin/${pluginId}'><strong>${escapeHtml(plugin.name)}</strong></a> was approved and is now available.`
          : `Version ${escapeHtml(scan.version)} of <a href='https://acode.app/plugin/${pluginId}'><strong>${escapeHtml(plugin.name)}</strong></a> was rejected after review.${
              reason ? `<br><em><strong>Reason</strong> ${escapeHtml(reason)}</em>` : ''
            }`,
    });
  } catch (error) {
    console.error('Error reviewing plugin update:', error);
    if (!res.headersSent) res.status(500).send({ error: error.message });
  }
});

router.patch('/', async (req, res) => {
  try {
    const { id, status, reason } = req.body;
    const user = await getWebLoggedInUser(req);

    if (!user?.isAdmin) {
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

router.patch('/:id/supported-editor', async (req, res) => {
  try {
    const { id } = req.params;
    const { supported_editor } = req.body;

    if (!['cm', 'all'].includes(supported_editor)) {
      res.status(400).send({ error: 'Invalid editor type. Must be cm or all' });
      return;
    }
    const user = await getWebLoggedInUser(req);

    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    if (!id || !supported_editor) {
      res.status(400).send({ error: 'Missing required fields' });
      return;
    }

    const [plugin] = await Plugin.get([Plugin.ID, Plugin.USER_ID], [Plugin.ID, id]);
    if (!plugin || plugin.user_id !== user.id) {
      res.status(404).send({ error: 'Plugin not found' });
      return;
    }

    await Plugin.update([Plugin.SUPPORTED_EDITOR, supported_editor], [Plugin.ID, id]);
    res.send({ message: 'Plugin updated successfully' });
  } catch (error) {
    console.error('Error updating plugin supported editor:', error);
    res.status(500).send({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await getWebLoggedInUser(req);
    const { mode } = req.query;

    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    if (mode === 'hard' && user.isAdmin) {
      await Plugin.deletePermanently([Plugin.ID, id]);
      await PluginScan.delete([PluginScan.PLUGIN_ID, id]);
      await discardStaged(id);
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

const PLUGINS_DIR = path.resolve(__dirname, '../../data/plugins');
const ICONS_DIR = path.resolve(__dirname, '../../data/icons');
// Held updates wait here until an admin reviews them.
const STAGING_DIR = path.join(PLUGINS_DIR, 'pending');

const livePath = (id) => path.join(PLUGINS_DIR, `${id}.zip`);
const stagedZipPath = (id) => path.join(STAGING_DIR, `${id}.zip`);
const stagedIconPath = (id) => path.join(STAGING_DIR, `${id}.png`);

async function savePlugin(id, zipBuffer, icon) {
  await fs.promises.writeFile(livePath(id), zipBuffer);
  await fs.promises.writeFile(path.join(ICONS_DIR, `${id}.png`), icon, 'base64');
}

/**
 * Scan a new version of a published plugin against the live zip. A passing
 * update replaces the live zip immediately; anything else (including a scanner
 * failure) is staged and recorded as a pending update for admin review.
 * @returns {Promise<{ held: boolean, decision: ReturnType<typeof decideUpdate> }>}
 */
async function scanPublishedUpdate({ row, user, version, updates, zipBuffer, icon }) {
  const pluginId = row.id;
  await fs.promises.mkdir(STAGING_DIR, { recursive: true });
  // Unique name so a crash mid-request can't swap the zip behind an older pending row.
  const uploadPath = path.join(STAGING_DIR, `${pluginId}.${process.pid}.${Date.now()}.upload.zip`);
  await fs.promises.writeFile(uploadPath, zipBuffer);

  try {
    const scan = await scanUpload({ uploadPath, livePath: fs.existsSync(livePath(pluginId)) ? livePath(pluginId) : null });
    const decision = decideUpdate(scan);
    const base = {
      pluginId,
      userId: user.id,
      version,
      previousVersion: row.version,
      kind: PluginScan.KIND_UPDATE,
      scan,
      zipBuffer,
      decision,
    };

    // Whatever happens, an older pending update is replaced by this upload.
    await PluginScan.update(
      [PluginScan.STATUS, PluginScan.STATUS_SUPERSEDED],
      [
        [PluginScan.PLUGIN_ID, pluginId],
        [PluginScan.STATUS, PluginScan.STATUS_PENDING],
      ],
    );

    if (decision.hold) {
      await fs.promises.rename(uploadPath, stagedZipPath(pluginId));
      await fs.promises.writeFile(stagedIconPath(pluginId), icon, 'base64');
      await insertScan({ ...base, status: PluginScan.STATUS_PENDING, changes: serializeChanges(updates) });
      return { held: true, decision };
    }

    await fs.promises.rename(uploadPath, livePath(pluginId));
    await fs.promises.writeFile(path.join(ICONS_DIR, `${pluginId}.png`), icon, 'base64');
    await discardStaged(pluginId);
    await insertScan({ ...base, status: PluginScan.STATUS_APPLIED });
    return { held: false, decision };
  } finally {
    await fs.promises.rm(uploadPath, { force: true });
  }
}

/** Move a held update's zip and icon into place. */
async function promoteStaged(pluginId) {
  await fs.promises.rename(stagedZipPath(pluginId), livePath(pluginId));
  if (fs.existsSync(stagedIconPath(pluginId))) {
    await fs.promises.rename(stagedIconPath(pluginId), path.join(ICONS_DIR, `${pluginId}.png`));
  }
}

async function discardStaged(pluginId) {
  await fs.promises.rm(stagedZipPath(pluginId), { force: true });
  await fs.promises.rm(stagedIconPath(pluginId), { force: true });
}

/**
 * Apply plugin column changes, registering the Play SKU when the price changed.
 * @param {string} pluginId
 * @param {Array<[string, any]>} updates
 * @param {string} name plugin name to register the SKU under
 */
async function applyPluginUpdate(pluginId, updates, name) {
  let skuErrors = [];
  const priceChange = updates.find(([column]) => column === Plugin.PRICE);
  if (priceChange?.[1]) {
    skuErrors = await registerSKU(name, pluginId, priceChange[1]);
  }
  await Plugin.update(updates, [Plugin.ID, pluginId]);
  return skuErrors;
}

async function insertScan({ pluginId, userId, version, previousVersion = null, kind, status, scan, zipBuffer, decision, changes = null }) {
  const fields = scanRowFields(scan, zipBuffer, decision);
  await PluginScan.insert(
    [PluginScan.PLUGIN_ID, pluginId],
    [PluginScan.USER_ID, userId],
    [PluginScan.VERSION, version],
    [PluginScan.PREVIOUS_VERSION, previousVersion],
    [PluginScan.KIND, kind],
    [PluginScan.STATUS, status],
    [PluginScan.RECOMMENDATION, fields.recommendation],
    [PluginScan.RISK, fields.risk],
    [PluginScan.REASONS, fields.reasons],
    [PluginScan.ZIP_SHA256, fields.zip_sha256],
    [PluginScan.SCANNER_VERSION, fields.scanner_version],
    [PluginScan.RULES_VERSION, fields.rules_version],
    [PluginScan.REPORT, fields.report],
    [PluginScan.DIFF, fields.diff],
    [PluginScan.CHANGES, changes],
  );
}

/**
 * Scan a zip that is already in place and record the result. Used after the
 * response is sent, so it never throws.
 */
async function recordScan({ uploadPath, ...row }) {
  try {
    const scan = await scanUpload({ uploadPath });
    const decision = decideUpdate(scan);
    await insertScan({ ...row, scan, decision });
    return decision;
  } catch (error) {
    console.error('Failed to record plugin scan:', error);
    return null;
  }
}

function scanSummaryHtml(decision) {
  if (!decision) return '<br><br>Security scan: not recorded.';
  const reasons = decision.reasons.slice(0, 5).map((reason) => `<li>${escapeHtml(reason)}</li>`);
  return `<br><br>Security scan: <strong>${escapeHtml(decision.recommendation)}</strong>${reasons.length ? `<ul>${reasons.join('')}</ul>` : ''}`;
}

function notifyAdmins(subject, html) {
  User.get([User.EMAIL, User.NAME], [User.ROLE, 'admin'])
    .then((rows) => {
      for (const row of rows) sendEmail(row.email, row.name, subject, html);
    })
    .catch((error) => console.error('Failed to notify admins:', error));
}

function notifyDeveloper(userId, { subject, html }) {
  User.get([User.EMAIL, User.NAME], [User.ID, userId])
    .then(([row]) => row && sendEmail(row.email, row.name, subject, html))
    .catch((error) => console.error('Failed to notify developer:', error));
}

function notifyHeldUpdate({ pluginId, name, version, user, decision }) {
  const link = `<a href='https://acode.app/plugin/${pluginId}'><strong>${escapeHtml(name)}</strong></a>`;
  notifyAdmins(
    'Plugin update waiting for review',
    `Version ${escapeHtml(version)} of ${link} was held by the security scan. Review it in the admin panel (Plugin updates).${scanSummaryHtml(decision)}`,
  );
  sendEmail(
    user.email,
    user.name,
    'Plugin update submitted for review',
    `Version ${escapeHtml(version)} of ${link} needs a manual review before it goes live. You will get an email when it is reviewed.${scanSummaryHtml(decision)}`,
  );
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
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
let cachedRegionsVersion = null;

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
    cachedRegionsVersion = res.data.regionVersion.version;
    return {
      version: res.data.regionVersion.version,
      regionPrices: res.data.convertedRegionPrices || {},
    };
  } catch (_) {
    if (!cachedRegionsVersion) cachedRegionsVersion = '2025/05';
    console.warn(`convertRegionPrices failed for INR ${price}, falling back to cached region version`);
    return { version: cachedRegionsVersion, regionPrices: {} };
  }
}

async function registerSKU(name, id, price) {
  const sku = getPluginSKU(id);
  if (!isValidPrice(price)) {
    throw new Error('Invalid price');
  }

  const regionPricing = await getRegionPricing(price);
  const errors = [];

  await register('com.foxdebug.acode');
  await register('com.foxdebug.acodefree');

  async function register(packageName) {
    try {
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
        try {
          await androidpublisher.inappproducts.get({ packageName, sku });
          await androidpublisher.inappproducts.delete({ packageName, sku });
        } catch (err) {
          if (err.code !== 404) {
            console.warn(`Legacy product check/delete failed for ${packageName}/${sku}:`, err.message);
          }
        }
      }

      const newConfigs = Object.entries(regionPricing.regionPrices).map(([regionCode, region]) => {
        const units = Number(region.price.units) || 0;
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
            units: String(Math.floor(price)),
            nanos: Math.round((price % 1) * 1000000000),
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
              title: name,
              description: `Purchase ${name} (${id}) plugin for Acode editor`,
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
        console.warn(`Activate purchase options failed for ${packageName}/${sku}: ${err.message}`);
      }
    } catch (error) {
      const details = error.errors?.map(({ message: msg }) => msg).join('\n') || error.message;
      console.error(`Failed to register SKU for ${packageName}: ${details}`, error);
      errors.push({ packageName, error: details });
    }
  }

  return errors;
}

function isValidPrice(price) {
  return price > 0 && !Number.isNaN(price) && price >= MIN_PRICE && price <= MAX_PRICE;
}

/**
 * Verify a purchase is still active with the payment provider.
 * Returns true if valid, false if revoked. Falls back to true on API errors
 * so a provider outage doesn't block legitimate downloads.
 * @param {object} order - purchase_order row (id, token, provider, package)
 * @param {object} plugin - plugin row (sku)
 */
async function verifyPurchase(order, plugin) {
  try {
    if (order.provider === Order.PROVIDER_RAZORPAY) {
      const payment = await getRazorpay().payments.fetch(order.token);
      return payment.status === 'captured';
    }

    if (order.provider === Order.PROVIDER_GOOGLE_PLAY) {
      const purchase = await androidpublisher.purchases.products.get({
        packageName: order.package,
        productId: plugin.sku,
        token: order.token,
      });
      return Number(purchase.data.purchaseState) === 0;
    }

    // Unknown provider — don't trust without verification
    console.warn(`Unknown purchase provider: ${order.provider} (order=${order.id})`);
    return false;
  } catch (err) {
    // Provider API unreachable — don't block download, log for monitoring
    console.error(`Purchase verification failed (provider=${order.provider}):`, err.message);
    return true;
  }
}

async function recordDownload(pluginId, device, clientIp, pkgName) {
  try {
    if (!device || !clientIp || !pkgName) return;
    const deviceCountOnIp = await Download.count([
      [Download.CLIENT_IP, clientIp],
      [Download.PLUGIN_ID, pluginId],
    ]);
    if (deviceCountOnIp < 5) {
      const [download] = await Download.get([
        [Download.PLUGIN_ID, pluginId],
        [Download.DEVICE_ID, device],
      ]);
      if (!download) {
        await Download.insert(
          [Download.PLUGIN_ID, pluginId],
          [Download.DEVICE_ID, device],
          [Download.CLIENT_IP, clientIp],
          [Download.PACKAGE_NAME, pkgName],
        );
        await Plugin.increment(Plugin.DOWNLOADS, 1, [Plugin.ID, pluginId]);
      }
    }
  } catch (error) {
    console.error('Failed to record download:', error);
  }
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
module.exports.registerSKU = registerSKU;
module.exports.isValidPrice = isValidPrice;
module.exports.isVersionGreater = isVersionGreater;
module.exports.matchScore = matchScore;
module.exports.getMatchingModeEntries = getMatchingModeEntries;
module.exports.getModePluginIds = getModePluginIds;
