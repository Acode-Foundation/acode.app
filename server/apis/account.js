const { Router } = require('express');
const crypto = require('node:crypto');
const User = require('../entities/user');
const Otp = require('../entities/otp');
const { getWebLoggedInUser, getToken } = require('../lib/helpers');
const { accountDeletionCodeLimiter, accountDeletionLimiter } = require('../lib/rateLimits');
const sendEmail = require('../lib/sendEmail');

const route = Router();
const lifetime = 10 * 60 * 1000;
const cooldownMessage = 'Wait a minute before requesting another code.';

route.use(async (req, res, next) => {
  try {
    const user = await getWebLoggedInUser(req);
    if (!user || user.role === 'deleted') return res.status(401).send({ error: 'Please sign in to manage your account.' });
    if (user.isAdmin || user.role === 'admin') return res.status(403).send({ error: 'Admin accounts cannot be deleted.' });
    req.accountUser = user;
    req.deletionKey = `account-delete:${user.id}:${digest(getToken(req))}`;
    next();
  } catch {
    res.status(500).send({ error: 'Unable to load your account.' });
  }
});

route.post('/deletion-code', accountDeletionCodeLimiter, async (req, res) => {
  try {
    const [previous] = await Otp.for('internal').get([Otp.EMAIL, req.deletionKey]);
    if (previous && Date.now() - Date.parse(previous.created_at) < 60_000) {
      return res.status(429).send({ error: cooldownMessage });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    const hash = digest(`${req.deletionKey}:${code}`);
    const values = [
      [Otp.OTP, hash],
      [Otp.CREATED_AT, new Date().toISOString()],
    ];
    if (previous) await Otp.update(values, [Otp.EMAIL, req.deletionKey]);
    else await Otp.insert([Otp.EMAIL, req.deletionKey], ...values);
    try {
      await sendEmail(
        req.accountUser.email,
        req.accountUser.name,
        'Confirm Acode account deletion',
        `<p>You requested permanent deletion of your Acode account.</p><p>Your confirmation code is <strong>${code}</strong>. It expires in 10 minutes.</p><p>If you did not request this, do not share the code.</p>`,
      );
    } catch (error) {
      await Otp.delete([
        [Otp.EMAIL, req.deletionKey],
        [Otp.OTP, hash],
      ]);
      throw error;
    }
    res.send({ message: 'A confirmation code has been sent to your account email.' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(429).send({ error: cooldownMessage });
    res.status(500).send({ error: 'Unable to send the confirmation code. Please try again.' });
  }
});

route.delete('/', accountDeletionLimiter, async (req, res) => {
  try {
    const code = req.body?.otp;
    const [pending] = await Otp.for('internal').get([Otp.EMAIL, req.deletionKey]);
    const createdAt = Date.parse(pending?.created_at);
    if (
      typeof code !== 'string' ||
      !/^\d{6}$/.test(code) ||
      !Number.isFinite(createdAt) ||
      createdAt > Date.now() ||
      Date.now() - createdAt >= lifetime ||
      !matches(digest(`${req.deletionKey}:${code}`), pending?.otp)
    ) {
      return res.status(400).send({ error: 'Invalid or expired confirmation code.' });
    }
    await User.delete([User.ID, req.accountUser.id]);
    res.clearCookie('token');
    res.send({ message: 'Your account has been deleted.' });
  } catch {
    res.status(500).send({ error: 'Unable to delete your account. Please try again.' });
  }
});

module.exports = route;

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function matches(first, second) {
  return typeof second === 'string' && /^[a-f0-9]{64}$/.test(second) && crypto.timingSafeEqual(Buffer.from(first, 'hex'), Buffer.from(second, 'hex'));
}
