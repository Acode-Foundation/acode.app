const moment = require('moment');
const login = require('../entities/login');
const user = require('../entities/user');
const db = require('./db');
const { CURRENCIES, getCurrencyForCountry, FALLBACK_CURRENCY } = require('./currencyMap');
const geoip = require('geoip-lite');

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
  if (req.user) {
    return req.user;
  }

  const token = getToken(req);

  if (!token) return null;

  const loginRow = await login.get([login.TOKEN, token]);

  if (!loginRow.length) {
    return null;
  }

  const { user_id: userId, expired_at: expiredAt } = loginRow[0];

  if (expiredAt && moment().isAfter(moment(expiredAt))) {
    return null;
  }

  const userRow = await user.get(user.safeColumns, [user.ID, userId]);

  if (!userRow.length) {
    return null;
  }

  const [loggedInUser] = userRow;

  if (loggedInUser.role === 'admin') {
    loggedInUser.isAdmin = true;
  }

  req.user = loggedInUser;
  return loggedInUser;
}

function getToken(req) {
  let { token } = req.cookies;

  if (!token) {
    token = req.headers['x-auth-token'];

    if (!token) {
      return null;
    }
  }
  return token;
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

/**
 * Get sqlite time
 * @returns {string}
 */
function getDbTime() {
  const [row] = db.prepare('select current_timestamp as now').all();
  return row.now;
}

/**
 * Parse sqlite db time
 * @param {string} time
 * @returns
 */
function parseDbTime(time) {
  time = time.replace(/z+$/i, 'Z');

  if (!time.toLowerCase().endsWith('z')) {
    time = `${time}Z`;
  }

  return new Date(time);
}

function detectUserCurrency(req) {
  const preferredCurrency = req.cookies.preferred_currency;

  if (preferredCurrency && CURRENCIES[preferredCurrency]) {
    if (CURRENCIES[preferredCurrency].supported) {
      return CURRENCIES[preferredCurrency];
    }
    console.warn(`Preferred currency ${preferredCurrency} is not supported by Razorpay, falling back to ${FALLBACK_CURRENCY}`);
    return CURRENCIES[FALLBACK_CURRENCY];
  }

  const countryCode = getCountryFromIp(req.ip);
  const currency = countryCode ? getCurrencyForCountry(countryCode) : null;

  if (currency && !currency.supported) {
    console.warn(`Detected currency ${currency.code} (${countryCode}) is not supported by Razorpay, falling back to ${FALLBACK_CURRENCY}`);
    return CURRENCIES[FALLBACK_CURRENCY];
  }

  return currency || CURRENCIES[FALLBACK_CURRENCY];
}

function getCountryFromIp(ip) {
  if (!ip) return null;

  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return null;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return null;

  const geo = geoip.lookup(ip);
  return geo?.country || null;
}

function formatAmount(amount, currency) {
  if (amount == null || Number.isNaN(amount)) return '';

  let currencyConfig;

  if (typeof currency === 'string') {
    currencyConfig = CURRENCIES[currency.toUpperCase()];
  } else if (currency && typeof currency === 'object') {
    currencyConfig = currency;
  }

  if (!currencyConfig) return String(amount);

  const { subunitDigits } = currencyConfig;

  return Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: subunitDigits,
    maximumFractionDigits: subunitDigits,
  });
}

module.exports = {
  areSameUser,
  getLoggedInUser,
  getPluginSKU,
  getToken,
  getDbTime,
  parseDbTime,
  detectUserCurrency,
  getCountryFromIp,
  formatAmount,
};
