/* eslint-disable no-console */
const moment = require('moment');
const Otp = require('../entities/otp');
const Login = require('../entities/login');
const ApiKey = require('../entities/apiKey');
const Download = require('../entities/download');
const RazorpayOrder = require('../entities/razorpayOrder');
const Order = require('../entities/purchaseOrder');
const { createNotifier } = require('../lib/cronNotifier');
const { DOWNLOAD_RETENTION_DAYS } = require('../lib/developerDashboard');
const downloadHistory = require('../lib/downloadHistory');

const FORMAT = 'YYYY-MM-DD HH:mm:ss.sss';
const downloadNotifier = createNotifier('Download cleanup');

// Dates are computed per run: this module is loaded once by the long-running cron process.
async function cleanOtp() {
  await Otp.delete([Otp.CREATED_AT, moment().startOf('day').format(FORMAT), '<']);
  console.log('Deleted expired otp');
}

async function cleanLogin() {
  await Login.delete([Login.EXPIRED_AT, moment().format(FORMAT), '<']);
  console.log('Deleted expired logins');
}

async function cleanApiKeys() {
  // Expired keys stay listed for 30 days so users can see why CI stopped working.
  const cutoff = moment().subtract(30, 'days').toISOString();
  ApiKey.deleteExpiredBefore(cutoff);
  console.log('Deleted expired api keys');
}

async function cleanDownload() {
  // Without a time: a download of exactly midnight sorts before '00:00:00.00' and would be deleted a day early.
  const cutoff = moment().startOf('day').subtract(DOWNLOAD_RETENTION_DAYS, 'days').format('YYYY-MM-DD');
  try {
    // Nothing is deleted if this fails, because held earnings would be lost. The next run tries again.
    await downloadHistory.keepHeldMonths(cutoff);
    await Download.delete([Download.CREATED_AT, cutoff, '<']);
    downloadNotifier.success();
    console.log('Deleted old downloads');
  } catch (error) {
    downloadNotifier.failure(error);
  }
}

async function cleanRazorpayOrders() {
  const thirtyDaysAgo = moment().subtract(30, 'days').format('YYYY-MM-DD HH:mm:ss.sss');
  await RazorpayOrder.delete([[RazorpayOrder.CREATED_AT, thirtyDaysAgo, '<'], 'AND', [RazorpayOrder.STATUS, RazorpayOrder.STATUS_FAILED]]);
  await RazorpayOrder.delete([[RazorpayOrder.CREATED_AT, thirtyDaysAgo, '<'], 'AND', [RazorpayOrder.STATUS, RazorpayOrder.STATUS_CANCELLED]]);
  await Order.delete([[Order.CREATED_AT, thirtyDaysAgo, '<'], 'AND', [Order.STATE, Order.STATE_CANCELED]]);
  console.log('Deleted old failed/cancelled razorpay orders and cancelled purchase orders');
}

async function cleanDb() {
  await cleanOtp();
  await cleanLogin();
  await cleanApiKeys();
  await cleanDownload();
  await cleanRazorpayOrders();
}

module.exports = cleanDb;
