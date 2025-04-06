/* eslint-disable no-console */
const nodeMailer = require('nodemailer');
const login = require('../entities/login');
const user = require('../entities/user');

/**
 * @typedef {object} LoggedInUser
 * @property {boolean} isAdmin
 */

/**
 * Get logged in user from cookie
 * @param {import('express').Request} req
 * @returns {Promise<LoggedInUser & User>}
 */
async function getLoggedInUser(req) {
  let { token } = req.cookies;

  if (!token) {
    token = req.headers['x-auth-token'];

    if (!token) {
      return null;
    }
  }

  const row = await login.get([login.TOKEN, token]);

  if (!row.length) {
    return null;
  }

  const { user_id: userId } = row[0];

  const userRow = await user.get(user.safeColumns, [user.ID, userId]);

  if (!userRow.length) {
    return null;
  }

  const [loggedInUser] = userRow;

  if (loggedInUser.role === 'admin') {
    loggedInUser.isAdmin = true;
  }

  return loggedInUser;
}

async function sendNotification(email, name, subject, message) {
  const transporter = nodeMailer.createTransport({
    host: 'smtppro.zoho.in',
    port: 465,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.PASSWORD,
    },
  });

  const mailOptions = {
    from: '"Acode - Foxbiz" <noreply@acode.app>',
    to: email,
    subject,
    html: `<div style="font-family: Helvetica,Arial,sans-serif;overflow:auto;line-height:2">
    <h1 style="border-bottom:1px solid #eee">
      <a href="https://acode.app" style="font-size:1.4em;color: #00466a;text-decoration:none;font-weight:600">Acode by Foxbiz Software Pvt. Ltd.</a>
    </h1>
    <p style="font-size:1.1em">Hi ${name},</p>
    <p>${message}</p>
    <p>Regards,<br />Acode by Foxbiz</p>
    <small>This is an auto-generated email. Please do not reply.</small>
  </div>`,
  };

  if (process.env.NODE_ENV === 'development') {
    console.log('Email:', mailOptions);
    return { messageId: 'development' };
  }
  const info = await transporter.sendMail(mailOptions);
  return info;
}

function getPluginSKU(id) {
  const hash = hashCode(id);
  const sku = `plugin_${hash.toLowerCase()}`;
  return sku;
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    hash = (hash << 5) - hash + chr;
    // eslint-disable-next-line no-bitwise
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash) + (hash < 0 ? 'N' : '');
}

function areSameUser(u1, u2) {
  const u1id = getUid(u1);
  const u2id = getUid(u2);

  if (u1id === null || u2id === null) {
    return false;
  }

  return u1id === u2id;
}

function getUid(u) {
  switch (typeof u) {
    case 'object':
      return u.id || u.user_id;

    case 'string':
      return +u;

    case 'number':
      return u;

    default:
      return null;
  }
}

module.exports = {
  areSameUser,
  getLoggedInUser,
  sendNotification,
  getPluginSKU,
};
