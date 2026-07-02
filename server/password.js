const crypto = require('node:crypto');

function encryptPassword(password) {
  return crypto.createHash('sha256', process.env.PASSWORD_SALT).update(password).digest('hex');
}

function comparePassword(password, encryptedPassword) {
  return encryptPassword(password) === encryptedPassword;
}

function isValidPassword(password) {
  return typeof password === 'string' && password.trim().length >= 6;
}

module.exports = {
  encryptPassword,
  comparePassword,
  isValidPassword,
};
