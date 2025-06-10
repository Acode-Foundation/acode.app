/* eslint-disable no-console */
const path = require('node:path');
const { config } = require('dotenv');
const setAuth = require('../lib/gapis');
const updateEarnings = require('../lib/updateEarnings');
const { sendNotification } = require('../lib/helpers');

config({ path: path.resolve(__dirname, '../.env') });

module.exports = async () => {
  try {
    await setAuth();
    await updateEarnings();
    sendNotification('dellevenjack+notification@gmail.com', 'Ajit Kumar', 'Monthly cron job completed', 'Cron job completed successfully');
  } catch (error) {
    // eslint-disable-next-line no-console
    sendNotification('me@ajitkumar.dev', 'Ajit Kumar', 'Monthly cron job failed', `Cron job failed, ${error.message}`);
    console.error(error);
  }
};
