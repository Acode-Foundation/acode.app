const { CronJob } = require('cron');
const updateOrders = require('./updateOrders');
const updateEarnings = require('./updateEarnings');
const cleanDb = require('./cleanDb');
const updateSponsors = require('./updateSponsors');
const updateRazorpayOrders = require('./updateRazorpayOrders');

const daily = new CronJob('0 1 * * *', async () => {
  await updateOrders();
  await cleanDb();
  await updateSponsors();
  // Required lazily: the plugin API loads entities and routes the cron process doesn't otherwise need at start.
  await require('../apis/plugin')
    .sweepStagedFiles()
    .catch((error) => console.error('Failed to sweep staged plugin files:', error));
});

const monthly = new CronJob('0 0 16 * *', async () => {
  await updateEarnings();
});

const every15min = new CronJob('*/15 * * * *', async () => {
  await updateRazorpayOrders();
});

daily.start();
monthly.start();
every15min.start();

console.log(daily.isActive ? 'Daily cron job is running' : 'Daily cron job is not running');
console.log(monthly.isActive ? 'Monthly cron job is running' : 'Monthly cron job is not running');
console.log(every15min.isActive ? 'Razorpay sync cron job is running' : 'Razorpay sync cron job is not running');
