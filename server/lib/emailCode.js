const crypto = require('node:crypto');
const Otp = require('../entities/otp');

// One-time codes emailed for sign-up, email changes and password resets.
const CODE_LIFETIME_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const PURPOSES = new Set(['signup', 'reset']);
const CODE_PATTERN = /^\d{6}$/;

class EmailCodeCooldownError extends Error {
  constructor() {
    super('Wait a minute before requesting another code.');
    this.status = 429;
  }
}

/**
 * Create a code for `email`, replacing any earlier one. Only its hash is stored.
 * @param {string} email
 * @param {'signup' | 'reset'} purpose
 * @returns {Promise<string>} the code to email
 */
async function issueEmailCode(email, purpose) {
  assertPurpose(purpose);
  const [previous] = await Otp.for('internal').get([Otp.EMAIL, email]);
  if (previous && Date.now() - parseTime(previous.created_at) < RESEND_COOLDOWN_MS) throw new EmailCodeCooldownError();

  const code = String(crypto.randomInt(100000, 1000000));
  const values = [
    [Otp.OTP, codeHash(email, purpose, code)],
    [Otp.CREATED_AT, new Date().toISOString()],
    [Otp.ATTEMPTS, 0],
  ];
  if (previous) await Otp.update(values, [Otp.EMAIL, email]);
  else await Otp.insert([Otp.EMAIL, email], ...values);
  return code;
}

/**
 * Check a code and consume it when it matches. Every check counts toward the
 * attempt limit, and codes expire after ten minutes.
 * @param {string} email
 * @param {'signup' | 'reset'} purpose
 * @param {string | number} code
 * @returns {boolean}
 */
function consumeEmailCode(email, purpose, code) {
  assertPurpose(purpose);
  code = String(code ?? '').trim();
  if (typeof email !== 'string' || !CODE_PATTERN.test(code)) return false;

  const row = Otp.claimAttempt(email, MAX_ATTEMPTS);
  if (!row) return false;

  const age = Date.now() - parseTime(row.created_at);
  if (!(age >= 0 && age < CODE_LIFETIME_MS)) return false;
  if (!matches(codeHash(email, purpose, code), row.otp)) return false;
  return Otp.consume(row.id, row.otp);
}

/**
 * Remove one issued code, e.g. when the email carrying it couldn't be sent. Only
 * that code is removed: a slow send can fail after a newer code was delivered.
 * @param {string} email
 * @param {'signup' | 'reset'} purpose
 * @param {string} code
 */
async function discardEmailCode(email, purpose, code) {
  assertPurpose(purpose);
  await Otp.delete([
    [Otp.EMAIL, email],
    [Otp.OTP, codeHash(email, purpose, code)],
  ]);
}

function assertPurpose(purpose) {
  if (!PURPOSES.has(purpose)) throw new Error(`Unknown email code purpose: ${purpose}`);
}

function codeHash(email, purpose, code) {
  return crypto.createHash('sha256').update(`email-code:${purpose}:${email}:${code}`).digest('hex');
}

function matches(hash, stored) {
  return typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored) && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored, 'hex'));
}

/** `created_at` is an ISO string, or SQLite's UTC `YYYY-MM-DD HH:MM:SS` for older rows. */
function parseTime(value) {
  if (typeof value !== 'string') return Number.NaN;
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

module.exports = {
  CODE_LIFETIME_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  EmailCodeCooldownError,
  consumeEmailCode,
  discardEmailCode,
  issueEmailCode,
};
