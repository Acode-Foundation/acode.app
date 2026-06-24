const path = require('node:path');
const fs = require('node:fs/promises');

const { Router } = require('express');
const moment = require('moment');
const Entity = require('../entities/entity');
const User = require('../entities/user');
const Payment = require('../entities/payment');
const PaymentMethod = require('../entities/paymentMethod');
const AppConfig = require('../entities/appConfig');
const { getLoggedInUser } = require('../lib/helpers');
const purchaseOrder = require('../entities/purchaseOrder');
const plugin = require('../entities/plugin');
const RazorpayOrder = require('../entities/razorpayOrder');
const Sponsor = require('../entities/sponsor');
const downloadSalesReportCsv = require('../lib/downloadSalesCsv');
const sendEmail = require('../lib/sendEmail');

const router = Router();

router.use('/', async (req, res, next) => {
  const loggedInUser = await getLoggedInUser(req);
  if (!loggedInUser?.isAdmin) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }

  next();
});

router.get('/', async (_req, res) => {
  const users = await User.count();
  const plugins = await plugin.count();
  const [{ total: pluginDownloads }] = await plugin.get(['SUM(downloads) as total'], []);
  const [{ total: pluginSales }] = await purchaseOrder.get(['SUM(amount) as total'], []);
  const [{ total: amountPaid }] = await Payment.get(['SUM(amount) as total'], [Payment.STATUS, Payment.STATUS_PAID]);
  res.send({
    users,
    plugins,
    amountPaid,
    pluginSales,
    pluginDownloads,
  });
});

router.get('/analytics', async (_req, res) => {
  try {
    const monthlyRevenue = await Entity.execSql(
      `SELECT month, SUM(total) as total FROM (
        SELECT strftime('%Y-%m', created_at) as month, SUM(amount) as total
        FROM purchase_order
        WHERE CAST(state AS INTEGER) = ? AND created_at >= date('now', '-12 months')
        GROUP BY strftime('%Y-%m', created_at)
        UNION ALL
        SELECT strftime('%Y-%m', created_at) as month, SUM(amount_inr) as total
        FROM razorpay_order
        WHERE product_type = ? AND status = ? AND created_at >= date('now', '-12 months')
        GROUP BY strftime('%Y-%m', created_at)
      ) GROUP BY month ORDER BY month ASC`,
      [purchaseOrder.STATE_PURCHASED, RazorpayOrder.PRODUCT_PRO, RazorpayOrder.STATUS_PAID],
      purchaseOrder,
    );

    const monthlyPayments = await Entity.execSql(
      `SELECT strftime('%Y-%m', created_at) as month, SUM(amount) as total
       FROM payment
       WHERE status = ? AND created_at >= date('now', '-12 months')
       GROUP BY strftime('%Y-%m', created_at)
       ORDER BY month ASC`,
      [Payment.STATUS_PAID],
      Payment,
    );

    const paymentStatus = await Entity.execSql(
      `SELECT
        CASE
          WHEN status = ? THEN 'paid'
          WHEN status = ? THEN 'initiated'
          ELSE 'none'
        END as status,
        COUNT(*) as count
       FROM payment
       GROUP BY status
       ORDER BY count DESC`,
      [Payment.STATUS_PAID, Payment.STATUS_INITIATED],
      Payment,
    );

    const editorDistribution = await Entity.execSql(
      `SELECT supported_editor as editor, COUNT(*) as count
       FROM plugin
       WHERE status = ${plugin.STATUS_APPROVED}
       GROUP BY supported_editor
       ORDER BY count DESC`,
      [],
      plugin,
    );

    const topDevelopers = await Entity.execSql(
      `SELECT u.name, COALESCE(SUM(p.amount), 0) as total
       FROM payment p
       JOIN user u ON u.id = p.user_id
       WHERE p.status = ?
       GROUP BY p.user_id
       ORDER BY total DESC
       LIMIT 10`,
      [Payment.STATUS_PAID],
      Payment,
    );

    const poProviderStatus = await Entity.execSql(
      `SELECT provider,
        CASE
          WHEN CAST(state AS INTEGER) = ? THEN 'Successful'
          WHEN CAST(state AS INTEGER) = ? THEN 'Failed'
          ELSE 'Other'
        END as status,
        COUNT(*) as count
       FROM purchase_order
       GROUP BY provider, status`,
      [purchaseOrder.STATE_PURCHASED, purchaseOrder.STATE_CANCELED],
      purchaseOrder,
    );

    const rzpRaw = await Entity.execSql(
      `SELECT status, COUNT(*) as count
       FROM razorpay_order
       GROUP BY status`,
      [],
      RazorpayOrder,
    );

    const statusLabel = (s) => {
      if (s === RazorpayOrder.STATUS_PAID) return 'Successful';
      if ([RazorpayOrder.STATUS_FAILED, RazorpayOrder.STATUS_CANCELLED, RazorpayOrder.STATUS_REFUNDED].includes(s)) return 'Failed';
      return 'Other';
    };

    const statusMap = {};
    for (const row of poProviderStatus) {
      const key = `${row.provider}|${row.status}`;
      statusMap[key] = (statusMap[key] || 0) + Number(row.count);
    }
    for (const row of rzpRaw) {
      const key = `razorpay|${statusLabel(row.status)}`;
      statusMap[key] = (statusMap[key] || 0) + Number(row.count);
    }
    const providerStatus = Object.entries(statusMap).map(([key, count]) => {
      const [provider, status] = key.split('|');
      return { provider, status, count };
    });

    res.send({
      monthlyRevenue,
      monthlyPayments,
      paymentStatus,
      editorDistribution,
      topDevelopers,
      providerStatus,
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

router.get('/reports/:year/:month', async (req, res) => {
  const { year, month } = req.params;
  const { type = 'sales' } = req.query;
  if (!['sales', 'earnings'].includes(type)) {
    res.status(400).send({ error: 'Invalid report type. Must be "sales" or "earnings".' });
    return;
  }
  const report = await downloadSalesReportCsv(year, month, type);
  res.download(report);
});

router.get('/users', async (req, res) => {
  const { page = 1, limit = 10, name, email } = req.query;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(Math.min(parseInt(limit, 10) || 10, 100), 1);
  const where = [];

  if (name) {
    where.push([User.NAME, name, 'LIKE']);
  }
  if (email) {
    where.push([User.EMAIL, email, 'LIKE']);
  }

  const count = await User.count(where);
  const users = await User.get(User.safeColumns, where, {
    page: pageNum,
    limit: limitNum,
  });
  res.send({
    pages: Math.ceil(count / limitNum),
    users,
    total: count,
  });
});

router.get('/payments', async (req, res) => {
  const { status, search, page = 1, limit = 10 } = req.query;
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = Math.min(parseInt(limit, 10) || 10, 100);

  const where = [];

  if (status && status !== 'all') {
    where.push([Payment.STATUS, Payment.statusInt(status)]);
  }

  let payments;
  let total;

  if (search) {
    payments = await Payment.for('internal').get(where);

    const searchLower = search.toLowerCase();
    payments = payments.filter((p) => p.user_name?.toLowerCase().includes(searchLower) || p.user_email?.toLowerCase().includes(searchLower));

    total = payments.length;
    const offset = (pageNum - 1) * limitNum;
    payments = payments.slice(offset, offset + limitNum);
  } else {
    total = await Payment.count(where);
    payments = await Payment.get(where, { page: pageNum, limit: limitNum });
  }

  const pages = Math.ceil(total / limitNum);

  res.send({ payments, pages, total });
});

router.get('/payment-method/:id', async (req, res) => {
  const { id } = req.params;
  const [row] = await PaymentMethod.get([PaymentMethod.ID, id]);
  res.send(row);
});

router.patch('/payment', async (req, res) => {
  const { id, status } = req.body;
  const statusInt = Payment.statusInt(status);
  await Payment.update([Payment.STATUS, statusInt], [Payment.ID, id]);
  const [row] = await Payment.get([Payment.ID, id]);
  res.send(row);

  if (statusInt !== Payment.STATUS_PAID) return;
  const [user] = await User.get([User.ID, row.user_id]);
  // last month of current year
  const lastMonth = moment().subtract(1, 'month').format('MM-YYYY');
  const message = `Your payment for ${lastMonth} has been sent.`;

  sendEmail(user.email, user.name, 'Payment Sent', message);
});

router.delete('/user/:id', async (req, res) => {
  const { id } = req.params;
  const [user] = await User.get([User.ID, id]);
  if (!user) {
    res.status(404).send({ error: 'User not found' });
    return;
  }
  await User.delete([User.ID, id]);
  res.send(user);
});

const ALLOWED_FILTERS = ['all', 'with_plugins', 'with_paid_plugins', 'with_payment'];

router.get('/email-recipients-count', async (req, res) => {
  const { filter = 'all' } = req.query;
  if (!ALLOWED_FILTERS.includes(filter)) {
    res.status(400).send({ error: 'Invalid filter' });
    return;
  }
  const count = await User.countUsersByFilter(filter);
  res.send({ count });
});

router.post('/send-email', async (req, res) => {
  const { filter = 'all', subject, message } = req.body;
  if (!ALLOWED_FILTERS.includes(filter)) {
    res.status(400).send({ error: 'Invalid filter' });
    return;
  }
  if (!subject?.trim() || !message?.trim()) {
    res.status(400).send({ error: 'Subject and message are required' });
    return;
  }
  const users = await User.getUsersByFilter(filter);
  for (const user of users) {
    await sendEmail(user.email, user.name, subject.trim(), message.trim());
  }
  res.send({ sent: users.length });
});

const ALLOWED_CONFIG_KEYS = ['acode_pro_price', 'payment_threshold'];

router.get('/config', async (_req, res) => {
  try {
    const config = {};
    for (const key of ALLOWED_CONFIG_KEYS) {
      config[key] = await AppConfig.getValue(key);
    }
    res.send(config);
  } catch {
    res.status(500).send({ error: 'Failed to fetch config' });
  }
});

router.put('/config', async (req, res) => {
  try {
    const { key, value } = req.body;

    if (!key || value === undefined || value === null) {
      res.status(400).send({ error: 'Key and value are required' });
      return;
    }

    if (!ALLOWED_CONFIG_KEYS.includes(key)) {
      res.status(400).send({ error: `Invalid config key: ${key}` });
      return;
    }

    if (key === 'acode_pro_price') {
      const price = Number(value);
      if (Number.isNaN(price) || price <= 0) {
        res.status(400).send({ error: 'Price must be a positive number' });
        return;
      }
    }

    if (key === 'payment_threshold') {
      const threshold = Number(value);
      if (Number.isNaN(threshold) || threshold <= 0 || !Number.isInteger(threshold)) {
        res.status(400).send({ error: 'Threshold must be a positive integer' });
        return;
      }
    }

    await AppConfig.setValue(key, value);
    res.send({ success: true, key, value });
  } catch {
    res.status(500).send({ error: 'Failed to update config' });
  }
});

const promotionsFile = path.resolve(__dirname, '../../data/promotions.json');

router.get('/promotions', async (_req, res) => {
  try {
    const raw = await fs.readFile(promotionsFile, 'utf8');
    const data = JSON.parse(raw);
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Failed to read promotions' });
  }
});

router.put('/promotions', async (req, res) => {
  try {
    const { promotions } = req.body;
    if (!Array.isArray(promotions)) {
      res.status(400).json({ error: 'promotions must be an array' });
      return;
    }
    for (const promo of promotions) {
      if (!promo.url || !promo.label || !promo.icon || !promo.link_text) {
        res.status(400).json({ error: 'Each promotion must have url, label, icon, and link_text' });
        return;
      }
    }
    await fs.writeFile(promotionsFile, JSON.stringify(promotions, null, 2));
    res.json({ message: 'success', promotions });
  } catch {
    res.status(500).json({ error: 'Failed to save promotions' });
  }
});

const modePluginsFile = path.resolve(__dirname, '../../data/mode-plugins.json');

router.get('/modes', async (_req, res) => {
  try {
    const raw = await fs.readFile(modePluginsFile, 'utf8');
    const data = JSON.parse(raw);
    res.json(data.modes || []);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Failed to read mode plugins' });
  }
});

router.put('/modes', async (req, res) => {
  try {
    const { modes } = req.body;
    if (!Array.isArray(modes)) {
      res.status(400).json({ error: 'modes must be an array' });
      return;
    }
    const normalizedModes = [];
    for (const m of modes) {
      const regex = String(m.regex || m.mode || '').trim();
      if (!regex || !Array.isArray(m.pluginIds)) {
        res.status(400).json({ error: 'Each mode must have regex (string) and pluginIds (array)' });
        return;
      }
      try {
        new RegExp(regex);
      } catch (err) {
        res.status(400).json({ error: `Invalid regex "${regex}": ${err.message}` });
        return;
      }
      normalizedModes.push({
        regex,
        pluginIds: [...new Set(m.pluginIds.map((id) => String(id).trim()).filter(Boolean))],
      });
    }
    const regexes = normalizedModes.map((m) => m.regex);
    if (new Set(regexes).size !== regexes.length) {
      res.status(400).json({ error: 'Duplicate mode regexes are not allowed' });
      return;
    }
    const allIds = [...new Set(normalizedModes.flatMap((m) => m.pluginIds))];
    if (allIds.length) {
      const existing = await plugin.get([plugin.ID], [plugin.ID, allIds, 'IN']);
      const existingIds = new Set(existing.map((r) => String(r.id)));
      const invalid = allIds.filter((id) => !existingIds.has(String(id)));
      if (invalid.length) {
        res.status(400).json({ error: `Plugin(s) not found: ${invalid.join(', ')}` });
        return;
      }
    }
    const tmpFile = `${modePluginsFile}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify({ modes: normalizedModes }, null, 2));
    await fs.rename(tmpFile, modePluginsFile);
    res.json({ message: 'success', modes: normalizedModes });
  } catch {
    res.status(500).json({ error: 'Failed to save mode plugins' });
  }
});

router.get('/sponsors', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const total = await Sponsor.count();
  const SPONSOR_ADMIN_COLUMNS = [Sponsor.ID, Sponsor.NAME, Sponsor.TIER, Sponsor.EMAIL, Sponsor.STATUS, Sponsor.CREATED_AT, Sponsor.EXPIRES_AT];

  const sponsors = await Sponsor.get(SPONSOR_ADMIN_COLUMNS, [], {
    page,
    limit,
    orderBy: 'created_at DESC',
  });
  res.send({
    pages: Math.ceil(total / limit),
    sponsors,
  });
});

router.get('/plugins/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      res.json([]);
      return;
    }
    const rows = await plugin.get([plugin.ID, plugin.NAME], [[plugin.ID, q, 'LIKE'], 'OR', [plugin.NAME, q, 'LIKE']], { limit: 10, page: 1 });
    res.json(rows.map((r) => ({ id: r.id, name: r.name })));
  } catch {
    res.status(500).json({ error: 'Failed to search plugins' });
  }
});

router.get('/plugins', async (req, res) => {
  const { page = 1, limit = 10, search, status } = req.query;
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = Math.min(parseInt(limit, 10) || 10, 100);

  const where = [];

  if (search) {
    where.push([plugin.NAME, search, 'LIKE']);
  }
  if (status !== undefined && status !== null && status !== '') {
    where.push([plugin.STATUS, parseInt(status, 10)]);
  }

  const total = await plugin.count(where);
  const plugins = await plugin.get(['*'], where, {
    page: pageNum,
    limit: limitNum,
  });

  res.send({
    pages: Math.ceil(total / limitNum),
    plugins,
    total,
  });
});

router.patch('/plugin', async (req, res) => {
  try {
    const { id, status, supported_editor } = req.body;

    if (!id) {
      res.status(400).send({ error: 'Plugin ID is required' });
      return;
    }

    if (status !== undefined && status !== null && status !== '') {
      const statusInt = parseInt(status, 10);
      if (![plugin.STATUS_PENDING, plugin.STATUS_APPROVED, plugin.STATUS_REJECTED, plugin.STATUS_DELETED].includes(statusInt)) {
        res.status(400).send({ error: 'Invalid status' });
        return;
      }
      await plugin.update([plugin.STATUS, statusInt], [plugin.ID, id]);
    }

    if (supported_editor) {
      if (!['cm', 'ace', 'all'].includes(supported_editor)) {
        res.status(400).send({ error: 'Invalid editor type. Must be cm, ace, or all' });
        return;
      }
      await plugin.update([plugin.SUPPORTED_EDITOR, supported_editor], [plugin.ID, id]);
    }

    const [updated] = await plugin.get(['*'], [plugin.ID, id]);
    res.send(updated);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;
