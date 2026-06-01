/* eslint-disable no-console */
const moment = require('moment');
const Otp = require('../entities/otp');
const Login = require('../entities/login');
const Download = require('../entities/download');
const RazorpayOrder = require('../entities/razorpayOrder');
const Order = require('../entities/purchaseOrder');

const now = moment().format('YYYY-MM-DD');
const today = moment(now).format('YYYY-MM-DD HH:mm:ss.sss');
const currentTimestamp = moment().format('YYYY-MM-DD HH:mm:ss.sss');
const oneMonthAgo = moment(now).subtract(1, 'month').format('YYYY-MM-DD HH:mm:ss.sss');

async function cleanOtp() {
  await Otp.delete([Otp.CREATED_AT, today, '<']);
  console.log('Deleted expired otp');
}

async function cleanLogin() {
  await Login.delete([Login.EXPIRED_AT, currentTimestamp, '<']);
  console.log('Deleted expired logins');
}

async function cleanDownload() {
  await Download.delete([Download.CREATED_AT, oneMonthAgo, '<']);
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
