const crypto = require('crypto');

function encryptPassword(password) {
  return crypto.createHash('sha256', process.env.PASSWORD_SALT)
    .update(password)
    .digest('hex');
}

function comparePassword(password, encryptedPassword) {
  return encryptPassword(password) === encryptedPassword;
}

module.exports = {
  encryptPassword,
  comparePassword,
};
