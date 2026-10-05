const crypto = require('node:crypto');
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
const { pluginUploadLimiter, pluginAdminLimiter } = require('../lib/rateLimits');
const { LICENSES, normalizeLicense } = require('../lib/pluginLicense');
const db = require('../lib/db');
const {
  scanUpload,
  decideUpdate,
  scanRowFields,
  serializeChanges,
  parseChanges,
  presentScan,
  sha256,
  fileInDir,
  replaceWithRollback,
  createKeyedLock,
  planLiveZipRepair,
  pickOrphanedStagedFiles,
  stagedFilePattern,
  backupFilePattern,
  transitionScan,
  supersedePendingScans,
} = require('../lib/pluginScanner');

const androidpublisher = google.androidpublisher('v3');

const router = Router();
const MIN_PRICE = 10;
const MAX_PRICE = 10000;
const VERSION_REGEX = /^\d+\.\d+\.\d+$/;
const ID_REGEX = /^[a-z][a-z0-9._]{3,49}$/i;

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

    const isApproved = row.status === Plugin.STATUS_APPROVED;
    const loggedInUser = row.price || !isApproved ? await getLoggedInUser(req) : null;

    // Packages that aren't approved (pending review, rejected, deleted) reach only admins and their owner.
    if (!isApproved && !loggedInUser?.isAdmin && loggedInUser?.id !== row.user_id) {
      res.status(404).send({ error: 'Not found' });
      return;
    }

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

    // Only approved versions are offered to installed copies.
    res.send({
      update: row.status === Plugin.STATUS_APPROVED && isVersionGreater(row.version, version),
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

router.post('/', pluginUploadLimiter, async (req, res) => {
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

router.put('/', pluginUploadLimiter, async (req, res) => {
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

    // Checked up front so the Play SKU call can't fail halfway through publishing.
    if (price && (price < MIN_PRICE || price > MAX_PRICE)) {
      res.status(400).send({
        error: `Price should be between ₹${MIN_PRICE} and ₹${MAX_PRICE}`,
      });
      return;
    }

    const [row] = await Plugin.get([Plugin.ID, Plugin.USER_ID, Plugin.VERSION, Plugin.NAME, Plugin.PRICE, Plugin.STATUS], [Plugin.ID, pluginId]);
    // Deleted plugins can't be updated: that would publish outside the scan gate.
    if (!row || row.user_id !== user.id || row.status === Plugin.STATUS_DELETED) {
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
    let skuErrors;
    if (packageChanged) {
      // One publish per plugin at a time: file swaps and row updates must not interleave.
      const outcome = await withPluginLock(pluginId, async () => {
        const [current] = await Plugin.get([Plugin.VERSION, Plugin.STATUS], [Plugin.ID, pluginId]);
        // The plugin may have been deleted, or another upload published, while this one waited.
        if (!current || current.status === Plugin.STATUS_DELETED) return { missing: true };
        if (!isVersionGreater(version, current.version)) return { conflict: current.version };

        const live = { ...row, version: current.version };
        if (current.status === Plugin.STATUS_APPROVED) {
          return scanPublishedUpdate({ row: live, user, version, name, updates, zipBuffer: pluginZip.data, icon });
        }

        // Unpublished plugins are reviewed as a whole on approval; scan exactly these
        // bytes so the reviewer has a record of them.
        const uploadPath = await writeUpload(pluginId, pluginZip.data);
        try {
          const scan = await scanUpload({ uploadPath });
          const record = {
            pluginId,
            userId: user.id,
            version,
            previousVersion: current.version,
            kind: PluginScan.KIND_UPDATE,
            scan,
            decision: decideUpdate(scan),
            zipBuffer: pluginZip.data,
          };
          const published = await publishWithScanRecord(record, () => publishUpdate(pluginId, updates, name, { zipFrom: uploadPath, icon }));
          return { held: false, skuErrors: published };
        } finally {
          await fs.promises.rm(uploadPath, { force: true });
        }
      });

      if (outcome.missing) {
        res.status(404).send({ error: 'Plugin not found' });
        return;
      }
      if (outcome.conflict !== undefined) {
        res.status(409).send({ error: `Version ${outcome.conflict} was published in the meantime; upload a version greater than it.` });
        return;
      }
      if (outcome.held) {
        res.send({
          message: `Version ${version} was submitted for review and will go live once an admin approves it.`,
          review: true,
          reasons: outcome.decision.reasons,
        });
        notifyHeldUpdate({ pluginId, name, version, user, decision: outcome.decision });
        return;
      }
      skuErrors = outcome.skuErrors;
    } else {
      skuErrors = await applyPluginUpdate(pluginId, updates, name);
    }

    const response = { message: 'Plugin updated successfully' };
    if (skuErrors.length) {
      response.warning = 'Price updated on website but Google Play SKU sync had errors';
      response.skuErrors = skuErrors;
      console.error('Google Play SKU registration had errors:', skuErrors);
    }
    res.send(response);
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
    // Looked up on its own: rescans can push a held update out of the capped history.
    const pending = db
      .prepare(`SELECT ${columns.join(', ')} FROM plugin_scan WHERE plugin_id = ? AND status = ? ORDER BY id DESC LIMIT 1`)
      .get(id, PluginScan.STATUS_PENDING);
    res.send({
      pending: pending ? presentScan(pending, { isAdmin: user.isAdmin }) : null,
      scans: rows.map((row) => presentScan(row, { isAdmin: user.isAdmin })),
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Admin-triggered scan of the live zip, e.g. after a scanner or rules upgrade.
// Only records the result; it never changes the plugin or its live zip.
router.post('/:id/scans', pluginAdminLimiter, async (req, res) => {
  try {
    const user = await getWebLoggedInUser(req);
    if (!user?.isAdmin) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const [plugin] = await Plugin.get([Plugin.ID], [Plugin.ID, req.params.id]);
    if (!plugin) {
      res.status(404).send({ error: 'Not found' });
      return;
    }

    const result = await rescanLive(plugin.id, user.id);
    if (!result) {
      res.status(404).send({ error: 'This plugin has no live zip to scan' });
      return;
    }

    const [row] = await PluginScan.get([PluginScan.ID, result.scanId]);
    res.send(presentScan(row, { isAdmin: true }));
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.post('/scans/:scanId/review', pluginAdminLimiter, async (req, res) => {
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

    // An approval holds `approving` until the publish is final, so startup recovery
    // can finish or undo it if the server stops part-way.
    const claim = action === 'approve' ? PluginScan.STATUS_APPROVING : PluginScan.STATUS_REJECTED;
    const review = [
      [PluginScan.REVIEWED_BY, user.id],
      [PluginScan.REVIEWED_AT, moment().format('YYYY-MM-DD HH:mm:ss')],
      [PluginScan.REVIEW_MESSAGE, reason || null],
    ];
    const staged = { zip: stagedZipPath(pluginId, scan.zip_sha256), icon: stagedIconPath(pluginId, scan.zip_sha256) };

    // Uploads supersede pending scans inside this same queue, and hard deletes run
    // in it too, so a review always sees a settled state: either a newer upload
    // already replaced this scan (the claim fails) or it runs after this review.
    let skuErrors = [];
    const conflict = await withPluginLock(pluginId, async () => {
      if (!transitionScan(db, scan.id, PluginScan.STATUS_PENDING, claim)) {
        return 'This update was already reviewed or replaced by a newer upload.';
      }

      if (action === 'reject') {
        // The rejection is recorded; leftover staged files are only clutter.
        await discardStaged(staged).catch((error) => console.error('Failed to remove staged files:', error));
        await PluginScan.update(review, [PluginScan.ID, scan.id]);
        return null;
      }

      // Until the update is live, any failure (a full disk while copying, an unreadable
      // staged file, a database error) must put the scan back to `pending` so admins
      // can retry or reject it, rather than leaving it stuck in `approving`.
      let published = false;
      try {
        const [current] = await Plugin.get([Plugin.VERSION, Plugin.STATUS], [Plugin.ID, pluginId]);
        const stale = !current || current.status === Plugin.STATUS_DELETED || !isVersionGreater(scan.version, current.version);
        if (stale) {
          transitionScan(db, scan.id, claim, PluginScan.STATUS_SUPERSEDED);
          await PluginScan.update(review, [PluginScan.ID, scan.id]);
          await discardStaged(staged).catch((error) => console.error('Failed to remove staged files:', error));
          if (!current || current.status === Plugin.STATUS_DELETED) return 'The plugin was deleted, so this update was discarded.';
          return `The live version (${current.version}) is already newer than ${scan.version}.`;
        }

        // Publish exactly the bytes that were scanned and reviewed.
        const stagedBytes = fs.existsSync(staged.zip) ? await fs.promises.readFile(staged.zip) : null;
        if (!stagedBytes || sha256(stagedBytes) !== scan.zip_sha256) {
          transitionScan(db, scan.id, claim, PluginScan.STATUS_PENDING);
          return 'The staged zip is missing or does not match the scanned upload; reject it and ask for a new upload.';
        }

        const changes = parseChanges(scan.changes);
        const newName = changes.find(([column]) => column === Plugin.NAME)?.[1] || plugin.name;
        // Publish from a copy: the staged zip stays put until the publish is final, so a
        // failed or interrupted approval can go back to pending with nothing lost.
        const uploadPath = await writeUpload(pluginId, stagedBytes);
        try {
          const icon = fs.existsSync(staged.icon) ? (await fs.promises.readFile(staged.icon)).toString('base64') : null;
          // publishUpdate only throws before the swap or after rolling it back.
          skuErrors = await publishUpdate(pluginId, changes, newName, { zipFrom: uploadPath, icon });
          published = true;
        } finally {
          await fs.promises.rm(uploadPath, { force: true }).catch((error) => console.error('Failed to remove upload copy:', error));
        }
      } catch (error) {
        // A no-op if the scan already reached a final status (e.g. superseded).
        if (!published) transitionScan(db, scan.id, claim, PluginScan.STATUS_PENDING);
        throw error;
      }

      // The update is live. Bookkeeping failures below are logged, not reported as a
      // failed approval; startup recovery settles a scan left in `approving`.
      try {
        transitionScan(db, scan.id, claim, PluginScan.STATUS_APPROVED);
      } catch (error) {
        console.error(`Approved ${pluginId} ${scan.version} but could not mark the scan approved:`, error);
      }
      await discardStaged(staged).catch((error) => console.error('Failed to remove staged files:', error));
      await PluginScan.update(review, [PluginScan.ID, scan.id]).catch((error) => console.error('Failed to save review details:', error));
      return null;
    });

    if (conflict) {
      res.status(409).send({ error: conflict });
      return;
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

router.delete('/:id', pluginAdminLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await getWebLoggedInUser(req);
    const { mode } = req.query;

    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    if (mode === 'hard' && user.isAdmin) {
      // File paths use the stored id, never the raw URL parameter.
      const [plugin] = await Plugin.get([Plugin.ID], [Plugin.ID, id]);
      if (!plugin) {
        res.status(404).send({ error: 'Plugin not found' });
        return;
      }
      const pluginId = plugin.id;
      // In the plugin's queue, so it can't interleave with a publish or review.
      await withPluginLock(pluginId, async () => {
        await Plugin.deletePermanently([Plugin.ID, pluginId]);
        await PluginScan.delete([PluginScan.PLUGIN_ID, pluginId]);
        try {
          await discardAllStaged(pluginId);
          fs.unlinkSync(livePath(pluginId));
          fs.unlinkSync(liveIconPath(pluginId));
        } catch (error) {
          // eslint-disable-next-line no-console
          console.log(error);
        }
      });
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
// Held updates wait here until an admin reviews them, one file per upload.
const STAGING_DIR = path.join(PLUGINS_DIR, 'pending');

const withPluginLock = createKeyedLock();

const livePath = (id) => fileInDir(PLUGINS_DIR, `${id}.zip`);
const liveIconPath = (id) => fileInDir(ICONS_DIR, `${id}.png`);
// Keyed by the zip's hash so a newer upload can never replace the bytes an admin is reviewing.
const stagedZipPath = (id, hash) => fileInDir(STAGING_DIR, `${id}-${hash}.zip`);
const stagedIconPath = (id, hash) => fileInDir(STAGING_DIR, `${id}-${hash}.png`);

async function savePlugin(id, zipBuffer, icon) {
  await fs.promises.writeFile(livePath(id), zipBuffer);
  await fs.promises.writeFile(liveIconPath(id), icon, 'base64');
}

/** Write an upload to a private temporary file next to the staged updates. */
async function writeUpload(pluginId, zipBuffer) {
  await fs.promises.mkdir(STAGING_DIR, { recursive: true });
  const file = fileInDir(STAGING_DIR, `${pluginId}.${crypto.randomUUID()}.upload`);
  await fs.promises.writeFile(file, zipBuffer);
  return file;
}

/**
 * Scan a new version of a published plugin against the live zip. A passing
 * update is published immediately; anything else (including a scanner
 * failure) is staged and recorded as a pending update for admin review.
 * @returns {Promise<{ held: boolean, decision: ReturnType<typeof decideUpdate>, skuErrors: object[] }>}
 */
async function scanPublishedUpdate({ row, user, version, name, updates, zipBuffer, icon }) {
  const pluginId = row.id;
  const uploadPath = await writeUpload(pluginId, zipBuffer);

  try {
    const live = livePath(pluginId);
    const scan = await scanUpload({ uploadPath, livePath: fs.existsSync(live) ? live : null });
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

    // Whatever happens, older pending updates are replaced by this upload.
    for (const superseded of supersedePendingScans(db, pluginId)) {
      if (superseded.zip_sha256) {
        await discardStaged({ zip: stagedZipPath(pluginId, superseded.zip_sha256), icon: stagedIconPath(pluginId, superseded.zip_sha256) });
      }
    }

    if (decision.hold) {
      const hash = sha256(zipBuffer);
      await fs.promises.rename(uploadPath, stagedZipPath(pluginId, hash));
      await fs.promises.writeFile(stagedIconPath(pluginId, hash), icon, 'base64');
      await insertScan({ ...base, status: PluginScan.STATUS_PENDING, changes: serializeChanges(updates) });
      return { held: true, decision, skuErrors: [] };
    }

    const skuErrors = await publishWithScanRecord(base, () => publishUpdate(pluginId, updates, name, { zipFrom: uploadPath, icon }));
    return { held: false, decision, skuErrors };
  } finally {
    await fs.promises.rm(uploadPath, { force: true });
  }
}

/**
 * Make a new zip live together with its plugin changes. The Play SKU call
 * (remote, can throw) runs before anything local changes, and the old zip is
 * restored if the database update fails, so live code and metadata never drift.
 * @param {string} pluginId
 * @param {Array<[string, any]>} updates
 * @param {string} name plugin name to register the SKU under
 * @param {{ zipFrom: string, icon?: string, iconFrom?: string }} source
 */
async function publishUpdate(pluginId, updates, name, { zipFrom, icon, iconFrom }) {
  const skuErrors = await registerPriceChange(pluginId, updates, name);
  await replaceWithRollback({
    livePath: livePath(pluginId),
    backupPath: fileInDir(PLUGINS_DIR, `${pluginId}.${Date.now()}.${crypto.randomUUID()}.previous`),
    fromPath: zipFrom,
    commit: async () => {
      // An UPDATE on a missing row "succeeds" with zero changes; refuse instead,
      // so the zip swap is rolled back rather than left without a plugin record.
      if (!db.prepare('SELECT 1 FROM plugin WHERE id = ?').get(pluginId)) {
        throw new Error(`Plugin ${pluginId} no longer exists`);
      }
      await Plugin.update(updates, [Plugin.ID, pluginId]);
    },
  });

  // The update is live at this point, so the icon must not turn it into a failure:
  // it is cosmetic, and the next upload rewrites it.
  try {
    if (iconFrom && fs.existsSync(iconFrom)) {
      await fs.promises.rename(iconFrom, liveIconPath(pluginId));
    } else if (icon) {
      await fs.promises.writeFile(liveIconPath(pluginId), icon, 'base64');
    }
  } catch (error) {
    console.error(`Published ${pluginId} but could not update its icon:`, error);
  }
  return skuErrors;
}

async function discardStaged({ zip, icon }) {
  await fs.promises.rm(zip, { force: true });
  await fs.promises.rm(icon, { force: true });
}

async function discardAllStaged(pluginId) {
  if (!fs.existsSync(STAGING_DIR)) return;
  const pattern = stagedFilePattern(pluginId);
  for (const name of await fs.promises.readdir(STAGING_DIR)) {
    if (pattern.test(name)) await fs.promises.rm(fileInDir(STAGING_DIR, name), { force: true });
  }
}

const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * Delete staged files no pending or approving scan refers to: leftovers from a
 * rejection or stale approval whose cleanup failed, superseded uploads, and
 * temporary copies from interrupted requests. Runs at startup and daily.
 */
async function sweepStagedFiles() {
  if (!fs.existsSync(STAGING_DIR)) return;
  const referenced = new Set(
    db
      .prepare('SELECT plugin_id, zip_sha256 FROM plugin_scan WHERE status IN (?, ?) AND zip_sha256 IS NOT NULL')
      .all(PluginScan.STATUS_PENDING, PluginScan.STATUS_APPROVING)
      .flatMap(({ plugin_id: id, zip_sha256: hash }) => [`${id}-${hash}.zip`, `${id}-${hash}.png`]),
  );
  const now = Date.now();
  const entries = [];
  for (const name of await fs.promises.readdir(STAGING_DIR)) {
    try {
      const stat = await fs.promises.stat(fileInDir(STAGING_DIR, name));
      if (stat.isFile()) entries.push({ name, ageMs: now - stat.mtimeMs });
    } catch (error) {
      console.error(`Skipping staged entry ${name}:`, error.message);
    }
  }
  for (const name of pickOrphanedStagedFiles({ entries, referenced, minAgeMs: ORPHAN_MIN_AGE_MS })) {
    await fs.promises
      .rm(fileInDir(STAGING_DIR, name), { force: true })
      .catch((error) => console.error(`Failed to remove orphaned staged file ${name}:`, error));
  }
}

/**
 * Settle scans left in `publishing` or `approving` because the server stopped
 * mid-publish (or the final status update failed). Runs at startup, before requests are served,
 * one plugin at a time: the live zip and its backups belong to the plugin, not
 * to any single scan.
 */
async function reconcilePublishingScans() {
  const pluginIds = db
    .prepare('SELECT DISTINCT plugin_id FROM plugin_scan WHERE status IN (?, ?)')
    .all(PluginScan.STATUS_PUBLISHING, PluginScan.STATUS_APPROVING)
    .map((row) => row.plugin_id);
  for (const pluginId of pluginIds) {
    try {
      await withPluginLock(pluginId, () => reconcilePlugin(pluginId));
    } catch (error) {
      console.error(`Could not reconcile interrupted publishes for ${pluginId}; leaving them for the next start:`, error);
    }
  }
}

async function reconcilePlugin(pluginId) {
  const rows = db
    .prepare('SELECT id, version, zip_sha256, status FROM plugin_scan WHERE plugin_id = ? AND status IN (?, ?) ORDER BY id')
    .all(pluginId, PluginScan.STATUS_PUBLISHING, PluginScan.STATUS_APPROVING);
  const [plugin] = await Plugin.get([Plugin.VERSION], [Plugin.ID, pluginId]);

  // A publish sets the version only in its final row update, and versions only
  // increase, so a stored version at or past a scan's means it went live.
  const isLive = (row) => plugin && (plugin.version === row.version || isVersionGreater(plugin.version, row.version));
  const published = rows.filter(isLive);
  const unpublished = rows.filter((row) => !isLive(row));
  const backups = await listBackups(pluginId);

  // Repair files before touching rows or backups: if this fails, the next start retries with everything intact.
  if (plugin) {
    const live = livePath(pluginId);
    const plan = planLiveZipRepair({
      liveHash: fs.existsSync(live) ? sha256(await fs.promises.readFile(live)) : null,
      expectedHash: expectedZipHash(pluginId, plugin.version, published),
      strayHashes: new Set(unpublished.map((row) => row.zip_sha256)),
      backups,
    });
    if (plan.action === 'stuck') throw new Error(`Cannot repair ${pluginId}: ${plan.reason}`);
    if (plan.action === 'restore') {
      await fs.promises.rename(fileInDir(PLUGINS_DIR, plan.name), live);
      console.warn(`Restored the live zip for ${pluginId} (version ${plugin.version}) from ${plan.name}.`);
    }
  }

  for (const row of published) {
    const done = row.status === PluginScan.STATUS_APPROVING ? PluginScan.STATUS_APPROVED : PluginScan.STATUS_APPLIED;
    transitionScan(db, row.id, row.status, done);
    if (row.status === PluginScan.STATUS_APPROVING && row.zip_sha256) {
      await discardStaged({ zip: stagedZipPath(pluginId, row.zip_sha256), icon: stagedIconPath(pluginId, row.zip_sha256) });
    }
  }
  for (const row of unpublished) {
    if (row.status === PluginScan.STATUS_APPROVING) {
      // The staged zip is untouched until an approval is final, so it can simply be reviewed again.
      transitionScan(db, row.id, PluginScan.STATUS_APPROVING, PluginScan.STATUS_PENDING);
    } else {
      db.prepare('DELETE FROM plugin_scan WHERE id = ? AND status = ?').run(row.id, PluginScan.STATUS_PUBLISHING);
    }
  }
  // Backups only exist during a publish; once the live zip is settled none are needed.
  for (const { name } of backups) {
    await fs.promises.rm(fileInDir(PLUGINS_DIR, name), { force: true });
  }
}

/** Hash of the zip for the plugin's recorded version, when a scan captured it. */
function expectedZipHash(pluginId, version, publishedRows) {
  const fromInterrupted = publishedRows.filter((row) => row.version === version).at(-1)?.zip_sha256;
  if (fromInterrupted) return fromInterrupted;
  const recorded = db
    .prepare(
      `SELECT zip_sha256 FROM plugin_scan
       WHERE plugin_id = ? AND version = ? AND zip_sha256 IS NOT NULL AND status IN ('applied', 'approved', 'recorded') AND kind != 'rescan'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(pluginId, version);
  return recorded?.zip_sha256 || null;
}

/** Backups of a plugin's live zip, newest first, with their hashes. */
async function listBackups(pluginId) {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  const pattern = backupFilePattern(pluginId);
  const backups = [];
  for (const name of await fs.promises.readdir(PLUGINS_DIR)) {
    const match = pattern.exec(name);
    if (!match) continue;
    const hash = sha256(await fs.promises.readFile(fileInDir(PLUGINS_DIR, name)));
    backups.push({ name, time: match[1] ? Number(match[1]) : 0, hash });
  }
  return backups.sort((a, b) => b.time - a.time);
}

/** Register the Play SKU when the price changed and is non-zero. */
async function registerPriceChange(pluginId, updates, name) {
  const priceChange = updates.find(([column]) => column === Plugin.PRICE);
  return priceChange?.[1] ? registerSKU(name, pluginId, priceChange[1]) : [];
}

/**
 * Apply plugin column changes that don't touch the zip.
 * @param {string} pluginId
 * @param {Array<[string, any]>} updates
 * @param {string} name plugin name to register the SKU under
 */
async function applyPluginUpdate(pluginId, updates, name) {
  const skuErrors = await registerPriceChange(pluginId, updates, name);
  await Plugin.update(updates, [Plugin.ID, pluginId]);
  return skuErrors;
}

/**
 * Publish with a durable scan record. The record is written before anything
 * goes live (so a published version always has its scan), marked `applied`
 * once the publish succeeds, and removed if the publish fails (so a failed
 * upload never shows as published).
 * @template T
 * @param {object} record insertScan fields without `status`
 * @param {() => Promise<T>} publish
 * @returns {Promise<T>}
 */
async function publishWithScanRecord(record, publish) {
  const scanId = insertScan({ ...record, status: PluginScan.STATUS_PUBLISHING });
  let result;
  try {
    result = await publish();
  } catch (error) {
    db.prepare('DELETE FROM plugin_scan WHERE id = ? AND status = ?').run(scanId, PluginScan.STATUS_PUBLISHING);
    throw error;
  }
  // A single-row status change; if even this fails, the full report is still stored (as "publishing").
  try {
    transitionScan(db, scanId, PluginScan.STATUS_PUBLISHING, PluginScan.STATUS_APPLIED);
  } catch (error) {
    console.error(`Published ${record.pluginId} ${record.version} but could not mark its scan applied:`, error);
  }
  return result;
}

/**
 * Admin re-scan of a plugin's live zip, recorded as a `rescan` row. The version,
 * zip, and scan are all read under the plugin lock, so a publish can't swap the
 * zip (or the version it is recorded under) partway through.
 * @returns {Promise<{ scanId: number, decision: ReturnType<typeof decideUpdate> } | null>} null when there is no live zip
 */
function rescanLive(pluginId, userId) {
  return withPluginLock(pluginId, async () => {
    const [plugin] = await Plugin.get([Plugin.VERSION], [Plugin.ID, pluginId]);
    const live = livePath(pluginId);
    if (!plugin || !fs.existsSync(live)) return null;
    const zipBuffer = await fs.promises.readFile(live);
    const scan = await scanUpload({ uploadPath: live });
    const decision = decideUpdate(scan);
    const scanId = insertScan({
      pluginId,
      userId,
      version: plugin.version,
      kind: PluginScan.KIND_RESCAN,
      status: PluginScan.STATUS_RECORDED,
      scan,
      zipBuffer,
      decision,
    });
    return { scanId, decision };
  });
}

/** Insert a scan row and return its id. */
function insertScan({ pluginId, userId, version, previousVersion = null, kind, status, scan, zipBuffer, decision, changes = null }) {
  const fields = scanRowFields(scan, zipBuffer, decision);
  const row = {
    [PluginScan.PLUGIN_ID]: pluginId,
    [PluginScan.USER_ID]: userId,
    [PluginScan.VERSION]: version,
    [PluginScan.PREVIOUS_VERSION]: previousVersion,
    [PluginScan.KIND]: kind,
    [PluginScan.STATUS]: status,
    [PluginScan.RECOMMENDATION]: fields.recommendation,
    [PluginScan.RISK]: fields.risk,
    [PluginScan.REASONS]: fields.reasons,
    [PluginScan.ZIP_SHA256]: fields.zip_sha256,
    [PluginScan.SCANNER_VERSION]: fields.scanner_version,
    [PluginScan.RULES_VERSION]: fields.rules_version,
    [PluginScan.REPORT]: fields.report,
    [PluginScan.DIFF]: fields.diff,
    [PluginScan.CHANGES]: changes,
  };
  const columns = Object.keys(row);
  const sql = `INSERT INTO plugin_scan (${columns.join(', ')}) VALUES (${columns.map((column) => `@${column}`).join(', ')})`;
  return Number(db.prepare(sql).run(row).lastInsertRowid);
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

  if (license) {
    const canonical = normalizeLicense(license);
    if (!canonical) {
      throw new Error(`Invalid license "${license}". Use one of: ${LICENSES.join(', ')}.`);
    }
    // Stored in its canonical spelling (e.g. `mit` -> `MIT`).
    json.license = canonical;
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
module.exports.reconcilePublishingScans = reconcilePublishingScans;
module.exports.sweepStagedFiles = sweepStagedFiles;
module.exports.isValidPrice = isValidPrice;
module.exports.isVersionGreater = isVersionGreater;
module.exports.matchScore = matchScore;
module.exports.getMatchingModeEntries = getMatchingModeEntries;
module.exports.getModePluginIds = getModePluginIds;
