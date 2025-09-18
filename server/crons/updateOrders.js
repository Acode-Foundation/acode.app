/* eslint-disable no-console */
const { google } = require('googleapis');
const { config } = require('dotenv');
const path = require('node:path');
const moment = require('moment');
const setAuth = require('../lib/gapis');
const updateOrders = require('../lib/updateOrders');
const sendEmail = require('../lib/sendEmail');

module.exports = async () => {
  try {
    config({ path: path.resolve(__dirname, '../.env') });
    await setAuth();

    const now = moment();
    const date = now.date();
    let startMonth = now.month();
    let startYear = now.year();
    const endMonth = startMonth;
    const endYear = startYear;

    if (date < 16) {
      startMonth -= 1;
      if (startMonth < 0) {
        startMonth = 11;
        startYear -= 1;
      }
    }

    const startDate = moment({ year: startYear, month: startMonth }).startOf('month').format('YYYY-MM-DD');
    const endDate = moment({ year: endYear, month: endMonth }).endOf('month').format('YYYY-MM-DD');
    await updateOrders(startDate, endDate, google);
    sendEmail('dellevenjack+notification@gmail.com', 'Ajit Kumar', 'Daily cron job completed', 'Cron job completed successfully');
  } catch (error) {
    sendEmail('me@ajitkumar.dev', 'Ajit Kumar', 'Daily cron job failed', `Cron job failed, ${error.message}`);
    console.error(error);
  }
};
