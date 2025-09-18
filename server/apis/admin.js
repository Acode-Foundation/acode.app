const { Router } = require('express');
const moment = require('moment');
const User = require('../entities/user');
const Payment = require('../entities/payment');
const PaymentMethod = require('../entities/paymentMethod');
const { getLoggedInUser } = require('../lib/helpers');
const purchaseOrder = require('../entities/purchaseOrder');
const plugin = require('../entities/plugin');
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

router.get('/reports/:year/:month', async (req, res) => {
  const { year, month } = req.params;
  const report = await downloadSalesReportCsv(year, month);
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
  const { status, user, page, limit } = req.query;
  const where = [];

  if (status) {
    where.push([Payment.STATUS, Payment.statusInt(status)]);
  }

  if (user) {
    where.push([Payment.USER_ID, user]);
  }

  const payments = await Payment.get(where, {
    page,
    limit,
  });
  res.send(payments);
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

module.exports = router;
