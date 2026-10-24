const { Router } = require('express');
const User = require('../entities/user');
const { EmailCodeCooldownError, discardEmailCode, issueEmailCode } = require('../lib/emailCode');
const { emailCodeLimiter } = require('../lib/rateLimits');
const sendEmail = require('../lib/sendEmail');

const route = Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

route.post('/', emailCodeLimiter, async (req, res) => {
  const { email } = req.body;
  const type = req.query.type === 'reset' ? 'reset' : 'signup';

  if (!email) {
    res.status(400).send({ error: 'Missing required fields' });
    return;
  }

  if (typeof email !== 'string' || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    res.status(400).send({ error: 'Invalid email' });
    return;
  }

  try {
    const user = await User.get([User.EMAIL, email]);

    if (type === 'reset' && !user.length) {
      res.status(400).send({ error: 'Email not registered' });
      return;
    }

    const code = await issueEmailCode(email, type);
    try {
      await sendOtpToEmail(email, user?.[0]?.name, code, type);
    } catch (error) {
      await discardEmailCode(email);
      throw error;
    }

    res.send({ message: 'OTP sent' });
  } catch (error) {
    if (error instanceof EmailCodeCooldownError) {
      res.status(error.status).send({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).send({ error: 'Something went wrong! Please try again later.' });
  }
});

async function sendOtpToEmail(email, name, otp, type) {
  name = name || email;
  let message = 'Thank you for signing up with Acode.';
  let subject = 'OTP for registration';
  if (type === 'reset') {
    message = 'You have requested to reset your password.';
    subject = 'OTP for password reset';
  }
  const res = await sendEmail(
    email,
    name,
    subject,
    `<div>
      <p>${message}</p>
      <p>Your OTP is: <strong>${otp}</strong>. It expires in 10 minutes.</p>
    </div>`,
  );
  return res;
}

module.exports = route;
