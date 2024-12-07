const { Router } = require('express');
const moment = require('moment');
const crypto = require('crypto');
const { comparePassword } = require('../password');
const login = require('../entities/login');
const user = require('../entities/user');
const { getLoggedInUser } = require('../helpers');

const route = Router();

route.get('/', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);

    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in.' });
      return;
    }

    res.send(loggedInUser);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

route.post('/', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).send({ error: 'Email and password are required.' });
    return;
  }

  const userRow = await user.get([user.EMAIL, email]);
  const ERROR = 'Email or Password is incorrect.';

  if (!userRow.length) {
    res.status(400).send({ error: ERROR });
    return;
  }

  const { id, password: storedPassword } = userRow[0];

  if (!comparePassword(password, storedPassword)) {
    res.status(400).send({ error: ERROR });
    return;
  }

  // use crypto to generate a random token
  const token = crypto.randomBytes(64).toString('hex');
  const expiredAt = moment().add(1, 'week').format('YYYY-MM-DD HH:mm:ss.sss');

  try {
    // store the token in the login table
    await login.insert(
      [login.USER_ID, id],
      [login.TOKEN, token],
      [login.EXPIRED_AT, expiredAt],
    );

    // set the token in the cookie
    res.cookie('token', token, {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    });

    res.send({ message: 'Logged in' });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

route.delete('/', async (req, res) => {
  const { token } = req.cookies;

  if (!token) {
    res.status(400).send({ error: 'Not logged in.' });
    return;
  }

  try {
    await login.delete([login.TOKEN, token]);
    res.clearCookie('token');
    res.send({ message: 'Logged out' });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

module.exports = route;
