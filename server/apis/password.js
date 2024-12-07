const { Router } = require('express');
const User = require('../entities/user');
const Otp = require('../entities/otp');
const { getLoggedInUser } = require('../helpers');
const { comparePassword, encryptPassword } = require('../password');

const router = Router();

router.put('/reset', async (req, res) => {
  try {
    const { otp, password, email } = req.body;
    const [user] = await User.get([User.EMAIL, email]);

    if (!otp) {
      res.status(400).send({ error: 'Missing OTP' });
      return;
    }

    if (!password || password.length < 6) {
      res.status(400).send({ error: 'Invalid password' });
      return;
    }

    const [{ otp: storedOtp }] = await Otp.get([Otp.OTP], [Otp.EMAIL, user.email]);
    if (storedOtp !== otp) {
      res.status(400).send({ error: 'Invalid OTP' });
      return;
    }

    await User.update([User.PASSWORD, encryptPassword(password)], [User.ID, user.id]);
    res.send({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in' });
      return;
    }

    const { oldPassword, password } = req.body;
    if (!oldPassword || !password) {
      res.status(400).send({ error: 'Missing password' });
      return;
    }

    const [{
      password: userPassword,
    }] = await User.get([User.PASSWORD], [User.ID, loggedInUser.id]);
    if (!comparePassword(oldPassword, userPassword)) {
      res.status(400).send({ error: 'Incorrect password' });
      return;
    }

    await User.update([User.PASSWORD, encryptPassword(password)], [User.ID, loggedInUser.id]);
    res.send({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

module.exports = router;
