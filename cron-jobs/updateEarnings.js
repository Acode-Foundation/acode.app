/* eslint-disable no-console */
const { config } = require('dotenv');
const path = require('path');
const setAuth = require('../server/gapis');
const updateEarnings = require('../server/updateEarnings');
const { sendNotification } = require('../server/helpers');

(async () => {
  try {
    config({ path: path.resolve(__dirname, '../.env') });
    await setAuth();
    await updateEarnings();
    sendNotification(
      'dellevenjack+notification@gmail.com',
      'Ajit Kumar',
      'Monthly cron job completed',
      'Cron job completed successfully',
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    sendNotification(
      'me@ajitkumar.dev',
      'Ajit Kumar',
      'Monthly cron job failed',
      `Cron job failed, ${error.message}`,
    );
    console.error(error);
  }
})();
