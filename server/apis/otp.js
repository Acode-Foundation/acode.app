const { Router } = require('express');
const Otp = require('../entities/otp');
const { sendNotification } = require('../lib/helpers');
const User = require('../entities/user');

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
      await Otp.update([Otp.OTP, otp], [Otp.EMAIL, email]);
      res.send({ message: 'OTP sent' });
      return;
    }

    await Otp.insert([Otp.EMAIL, email], [Otp.OTP, otp]);
    res.send({ message: 'OTP sent' });
  } catch (error) {
    res.status(500).send({ error: error.message });
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
  const res = await sendNotification(
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
