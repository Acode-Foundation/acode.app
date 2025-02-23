const path = require('node:path');
const { google } = require('googleapis');

const gAuth = new google.auth.GoogleAuth({
  keyFile: path.resolve(__dirname, '../../data/key.json'),
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});

let gAuthClient;

async function setAuth() {
  if (!gAuthClient) {
    gAuthClient = await gAuth.getClient();
    google.options({ auth: gAuthClient });
  }
}

module.exports = setAuth;
