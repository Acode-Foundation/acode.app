const { Router } = require('express');
const User = require('../entities/user');
const login = require('../entities/login');
const AppAuthCode = require('../entities/appAuthCode');
const { consumeEmailCode } = require('../lib/emailCode');
const { getWebLoggedInUser } = require('../lib/helpers');
const { emailCodeCheckLimiter } = require('../lib/rateLimits');
const { comparePassword, encryptPassword, isValidPassword } = require('../password');

const router = Router();

router.put('/reset', emailCodeCheckLimiter, async (req, res) => {
  try {
    const { otp, password, email } = req.body;

    if (!otp) {
      res.status(400).send({ error: 'Missing OTP' });
      return;
    }

    if (!isValidPassword(password)) {
      res.status(400).send({ error: 'Invalid password' });
      return;
    }

    const [user] = typeof email === 'string' ? await User.get([User.ID], [User.EMAIL, email]) : [];
    if (!user || !consumeEmailCode(email, 'reset', otp)) {
      res.status(400).send({ error: 'Invalid or expired OTP' });
      return;
    }

    await User.update([User.PASSWORD, encryptPassword(password)], [User.ID, user.id]);
    // Whoever knew the old password must not stay signed in, or exchange an
    // app sign-in code they requested before the reset for a new session.
    await login.delete([login.USER_ID, user.id]);
    await AppAuthCode.delete([AppAuthCode.USER_ID, user.id]);
    res.send({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password reset failed:', error);
    res.status(500).send({ error: 'Unable to reset password. Please try again.' });
  }
});

router.put('/', async (req, res) => {
  try {
    const loggedInUser = await getWebLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in' });
      return;
    }

    const { oldPassword, password } = req.body;
    if (!oldPassword || !password) {
      res.status(400).send({ error: 'Missing password' });
      return;
    }

    if (!isValidPassword(password)) {
      res.status(400).send({ error: 'Invalid password' });
      return;
    }

    const [{ password: userPassword }] = await User.get([User.PASSWORD], [User.ID, loggedInUser.id]);
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
