/* eslint-disable no-console */
const path = require('node:path');
const { config } = require('dotenv');
const setAuth = require('../server/lib/gapis');
const updateEarnings = require('../server/lib/updateEarnings');
const { sendNotification } = require('../server/lib/helpers');

config({ path: path.resolve(__dirname, '../.env') });

(async () => {
  try {
    await setAuth();
    await updateEarnings();
    sendNotification('dellevenjack+notification@gmail.com', 'Ajit Kumar', 'Monthly cron job completed', 'Cron job completed successfully');
  } catch (error) {
    // eslint-disable-next-line no-console
    sendNotification('me@ajitkumar.dev', 'Ajit Kumar', 'Monthly cron job failed', `Cron job failed, ${error.message}`);
    console.error(error);
  }
})();
