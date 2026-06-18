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
      `SELECT strftime('%Y-%m', created_at) as month, SUM(amount) as total
       FROM purchase_order
       WHERE state = 0 AND created_at >= date('now', '-12 months')
       GROUP BY strftime('%Y-%m', created_at)
       ORDER BY month ASC`,
      [],
      plugin,
    );

    const monthlyPayments = await Entity.execSql(
      `SELECT strftime('%Y-%m', created_at) as month, SUM(amount) as total
       FROM payment
       WHERE status = ${Payment.STATUS_PAID} AND created_at >= date('now', '-12 months')
       GROUP BY strftime('%Y-%m', created_at)
       ORDER BY month ASC`,
      [],
      plugin,
    );

    const paymentStatus = await Entity.execSql(
      `SELECT
        CASE
          WHEN status = ${Payment.STATUS_PAID} THEN 'paid'
          WHEN status = ${Payment.STATUS_INITIATED} THEN 'initiated'
          ELSE 'none'
        END as status,
        COUNT(*) as count
       FROM payment
       GROUP BY status
       ORDER BY count DESC`,
      [],
      plugin,
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

    res.send({
      monthlyRevenue,
      monthlyPayments,
      paymentStatus,
      editorDistribution,
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
  const { page, limit, name, email } = req.query;
  const count = await User.count();
  const where = [];

  if (name) {
    where.push([User.NAME, name, 'LIKE']);
  }
  if (email) {
    where.push([User.EMAIL, email, 'LIKE']);
  }

  const users = await User.get(User.safeColumns, where, {
    page,
    limit,
  });
  res.send({
    pages: Math.ceil(count / limit),
    users,
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

module.exports = router;
