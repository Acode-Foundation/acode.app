const { Router } = require('express');
const Otp = require('../entities/otp');
const User = require('../entities/user');
const sendEmail = require('../lib/sendEmail');

const route = Router();

route.post('/', async (req, res) => {
  const { email } = req.body;
  const { type } = req.query;

  if (!email) {
    res.status(400).send({ error: 'Missing required fields' });
    return;
  }

  const otp = Math.floor(100000 + Math.random() * 900000);

  try {
    const user = await User.get([User.EMAIL, email]);

    if (type === 'reset' && !user.length) {
      res.status(400).send({ error: 'Email not registered' });
      return;
    }

    const name = user?.[0]?.name;
    await sendOtpToEmail(email, name, otp, type);
    const row = await Otp.get([Otp.EMAIL, email]);

    if (row.length) {
      await Otp.update([Otp.OTP, String(otp)], [Otp.EMAIL, email]);
      res.send({ message: 'OTP sent' });
      return;
    }

    await Otp.insert([Otp.EMAIL, email], [Otp.OTP, String(otp)]);
    res.send({ message: 'OTP sent' });
  } catch (error) {
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
      <p></p>${message}</p>
      <p>Your OTP is: <strong>${otp}</strong></p>
    </div>`,
  );
  return res;
}

module.exports = route;
