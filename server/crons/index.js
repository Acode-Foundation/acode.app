const { CronJob } = require('cron');
const updateOrders = require('./updateOrders');
const updateEarnings = require('../lib/updateEarnings');
const cleanDb = require('./cleanDb');
const updateSponsors = require('./updateSponsors');

const daily = new CronJob('0 1 * * *', async () => {
  await updateOrders();
  await cleanDb();
  await updateSponsors();
});

const monthly = new CronJob('0 0 16 * *', async () => {
  await updateEarnings();
});

daily.start();
monthly.start();

console.log(daily.isActive ? 'Daily cron job is running' : 'Daily cron job is not running');
console.log(monthly.isActive ? 'Monthly cron job is running' : 'Monthly cron job is not running');
