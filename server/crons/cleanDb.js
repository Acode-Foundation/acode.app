/* eslint-disable no-console */
const moment = require('moment');
const Otp = require('../entities/otp');
const Login = require('../entities/login');
const Download = require('../entities/download');
const RazorpayOrder = require('../entities/razorpayOrder');
const Order = require('../entities/purchaseOrder');
const { DOWNLOAD_RETENTION_DAYS } = require('../lib/developerDashboard');

const FORMAT = 'YYYY-MM-DD HH:mm:ss.sss';

// Dates are computed per run: this module is loaded once by the long-running cron process.
async function cleanOtp() {
  await Otp.delete([Otp.CREATED_AT, moment().startOf('day').format(FORMAT), '<']);
  console.log('Deleted expired otp');
}

async function cleanLogin() {
  await Login.delete([Login.EXPIRED_AT, moment().format(FORMAT), '<']);
  console.log('Deleted expired logins');
}

async function cleanDownload() {
  const cutoff = moment().startOf('day').subtract(DOWNLOAD_RETENTION_DAYS, 'days').format(FORMAT);
  await Download.delete([Download.CREATED_AT, cutoff, '<']);
  console.log('Deleted old downloads');
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
  await cleanDownload();
  await cleanRazorpayOrders();
}

module.exports = cleanDb;
