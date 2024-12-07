/* eslint-disable no-console */
const moment = require('moment');
const Otp = require('../server/entities/otp');
const Login = require('../server/entities/login');
const Download = require('../server/entities/download');

const now = moment().format('YYYY-MM-DD');
const today = moment(now).format('YYYY-MM-DD HH:mm:ss.sss');
const expiredAt = moment(now).add(1, 'week').format('YYYY-MM-DD HH:mm:ss.sss');
const oneMonthAgo = moment(now).subtract(1, 'month').format('YYYY-MM-DD HH:mm:ss.sss');

async function cleanOtp() {
  await Otp.delete([Otp.CREATED_AT, today, '<']);
  console.log('Deleted expired otp');
}

async function cleanLogin() {
  await Login.delete([Login.EXPIRED_AT, expiredAt, '<']);
  console.log('Deleted expired login');
}

async function cleanDownload() {
  await Download.delete([Download.CREATED_AT, oneMonthAgo, '<']);
  console.log('Deleted old downloads');
}

function cleanDb() {
  cleanOtp();
  cleanLogin();
  cleanDownload();
}

cleanDb();
// module.exports = cleanDb;
