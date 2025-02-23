const { Router } = require('express');
const moment = require('moment');
const { encryptPassword } = require('../password');
const { getLoggedInUser, areSameUser } = require('../lib/helpers');
const Comment = require('../entities/comment');
const Otp = require('../entities/otp');
const User = require('../entities/user');
const Payment = require('../entities/payment');
const PaymentMethod = require('../entities/paymentMethod');
const UserEarnings = require('../entities/userEarnings');
const calcEarnings = require('../lib/calcEarnings');

const route = Router();

route.get('/payment-methods', async (req, res) => {
  try {
    const user = await getAuthorizedUser(req);
    const rows = await PaymentMethod.get(PaymentMethod.columns, [
      [PaymentMethod.USER_ID, user.id],
      [PaymentMethod.IS_DELETED, 0],
    ]);

    res.send(rows);
  } catch (error) {
    handleError(res, error);
  }
});

route.get('/earnings/:year/:month', async (req, res) => {
  try {
    const user = await getAuthorizedUser(req);
    let { year, month } = req.params;

    year = Number.parseInt(year, 10);
    month = Number.parseInt(month, 10);

    if (Number.isNaN(year) || Number.isNaN(month) || month < 0 || month > 11) {
      res.status(400).send({ error: 'Invalid year or month' });
      return;
    }

    let earnings;

    const now = moment();
    const thisMonth = moment({ year: now.year(), month: now.month() });
    const targetMonth = moment({ year, month });
    if (thisMonth.isSame(targetMonth)) {
      earnings = await calcEarnings.total(year, month, user);
    } else {
      const [row] = await UserEarnings.get([
        [UserEarnings.USER_ID, user.id],
        [UserEarnings.YEAR, year],
        [UserEarnings.MONTH, month],
      ]);

      earnings = row?.amount || 0;
    }

    res.send({
      earnings,
      month: moment().month(month).format('MMMM'),
      year,
    });
  } catch (error) {
    handleError(res, error);
  }
});

route.get('/unpaid-earnings', async (req, res) => {
  try {
    const user = await getAuthorizedUser(req);
    const { earnings, from, to } = await calcEarnings.unpaid(user);

    if (!earnings) {
      // send earnings from last month
      const now = moment();
      const date = now.date();
      const lastMonth = moment({ year: now.year(), month: now.month() }).subtract(1, 'month');
      const lastMonthEarnings = await calcEarnings.total(lastMonth.year(), lastMonth.month(), user);

      if (date >= 16) {
        // send earnings from this month
        const thisMonthEarnings = await calcEarnings.total(now.year(), now.month(), user);
        res.send({
          threshold: +process.env.PAYMENT_THRESHOLD,
          earnings: thisMonthEarnings,
          from: now.startOf('month').format('YYYY-MM-DD'),
          to: now.endOf('month').format('YYYY-MM-DD'),
        });
        return;
      }

      res.send({
        threshold: +process.env.PAYMENT_THRESHOLD,
        earnings: lastMonthEarnings,
        from: lastMonth.startOf('month').format('YYYY-MM-DD'),
        to: lastMonth.endOf('month').format('YYYY-MM-DD'),
      });
      return;
    }

    res.send({
      threshold: +process.env.PAYMENT_THRESHOLD,
      earnings,
      from,
      to,
    });
  } catch (error) {
    handleError(res, error);
  }
});

route.get('/payment-method', async (req, res) => {
  try {
    const user = await getAuthorizedUser(req);
    const [row] = await PaymentMethod.get(PaymentMethod.columns, [
      [PaymentMethod.USER_ID, user.id],
      [PaymentMethod.IS_DEFAULT, 1],
      [PaymentMethod.IS_DELETED, 0],
    ]);

    res.send(row);
  } catch (error) {
    handleError(res, error);
  }
});

route.get('/comment/:pluginId', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in' });
      return;
    }

    const { pluginId } = req.params;
    const [comment] = await Comment.get([
      [Comment.PLUGIN_ID, pluginId],
      [Comment.USER_ID, loggedInUser.id],
    ]);

    res.send(comment || {});
  } catch (error) {
    handleError(res, error);
  }
});

route.get('/payments/:year?', async (req, res) => {
  try {
    const user = await getAuthorizedUser(req);
    const { year } = req.params;
    const where = [[Payment.USER_ID, user.id]];

    if (year) {
      where.push([`STRFTIME('%Y', ${Payment.CREATED_AT})`, year]);
    }

    const rows = await Payment.get(Payment.minColumns, where);
    res.send(rows);
  } catch (error) {
    handleError(res, error);
  }
});

route.get('/receipt/:paymentId', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);
    const { paymentId } = req.params;
    const [payment] = await Payment.get([Payment.ID, paymentId]);

    if (!payment) {
      res.status(404).send({ error: 'Payment not found' });
      return;
    }

    const [row] = await PaymentMethod.get(PaymentMethod.columns, [
      [PaymentMethod.ID, payment[Payment.PAYMENT_METHOD_ID]],
      [PaymentMethod.IS_DELETED, 0],
    ]);

    if (!row) {
      res.status(404).send({ error: 'Payment method not found' });
      return;
    }

    if (!areSameUser(payment[Payment.USER_ID], loggedInUser) && !loggedInUser.isAdmin) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { paymentMethod, paymentMethodId, ...rest } = payment;

    res.send({
      ...rest,
      paymentMethod: row,
    });
  } catch (error) {
    handleError(res, error);
  }
});

route.get('/:idOrEmail', async (req, res) => {
  const { idOrEmail } = req.params;

  const [row] = await User.get(
    [User.safeColumns],
    [
      [User.ID, idOrEmail],
      [User.EMAIL, idOrEmail],
    ],
    'OR',
  );

  if (!row) {
    res.status(404).send({ error: 'User not found' });
    return;
  }

  res.send(row);
});

route.patch('/verify/:revoke(revoke)?/:userId', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);
    if (!loggedInUser?.isAdmin) {
      res.status(401).send({ error: 'Not authorized' });
      return;
    }

    const { userId } = req.params;
    await User.update([User.VERIFIED, req.params.revoke ? 0 : 1], [User.ID, userId]);

    res.send({ message: 'User verified' });
  } catch (error) {
    handleError(res, error);
  }
});

route.post('/payment-method', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in' });
      return;
    }

    const paymentMethodsCount = await PaymentMethod.count([
      [PaymentMethod.USER_ID, loggedInUser.id],
      [PaymentMethod.IS_DELETED, 0],
    ]);

    if (paymentMethodsCount >= 3) {
      res.status(400).send({ error: 'You can add only 3 payment methods' });
      return;
    }

    const {
      paypal_email: paypal,
      bank_name: bankName,
      bank_account_number: bankAccount,
      bank_ifsc_code: bankIFSC,
      bank_swift_code: bankSwift,
      bank_account_holder: bankAccountHolder,
      bank_account_type: bankAccountType = PaymentMethod.BANK_ACCOUNT_TYPE_SAVINGS,
      wallet_address: walletAddress,
      wallet_type: walletType,
    } = req.body;

    const insert = [];
    if (paypal) {
      const [row] = await PaymentMethod.get([
        [PaymentMethod.PAYPAL_EMAIL, paypal],
        [PaymentMethod.USER_ID, loggedInUser.id],
        [PaymentMethod.IS_DELETED, 0],
      ]);
      if (row) {
        res.status(400).send({ error: 'Paypal email already exists' });
        return;
      }
      insert.push([PaymentMethod.PAYPAL_EMAIL, paypal]);
    } else if (walletAddress && walletType) {
      insert.push([PaymentMethod.WALLET_ADDRESS, walletAddress], [PaymentMethod.WALLET_TYPE, walletType]);
    } else {
      if (!bankName || !bankAccount || !bankIFSC || !bankAccountHolder) {
        res.status(400).send({ error: 'Missing required fields' });
        return;
      }

      const [row] = await PaymentMethod.get([
        [PaymentMethod.BANK_ACCOUNT_NUMBER, bankAccount],
        [PaymentMethod.USER_ID, loggedInUser.id],
        [PaymentMethod.IS_DELETED, 0],
      ]);

      if (row) {
        res.status(400).send({ error: 'Bank account already exists' });
        return;
      }

      insert.push(
        [PaymentMethod.BANK_NAME, bankName],
        [PaymentMethod.BANK_IFSC_CODE, bankIFSC],
        [PaymentMethod.BANK_SWIFT_CODE, bankSwift],
        [PaymentMethod.BANK_ACCOUNT_NUMBER, bankAccount],
        [PaymentMethod.BANK_ACCOUNT_TYPE, bankAccountType],
        [PaymentMethod.BANK_ACCOUNT_HOLDER, bankAccountHolder],
      );
    }

    const count = await PaymentMethod.count([PaymentMethod.USER_ID, loggedInUser.id]);
    insert.push([PaymentMethod.USER_ID, loggedInUser.id]);
    await PaymentMethod.insert(...insert, [PaymentMethod.IS_DEFAULT, count === 0]);
    res.send({ message: 'Payment method added' });
  } catch (error) {
    handleError(res, error);
  }
});

route.post('/', async (req, res) => {
  const { name, email, password, github = null, website = null, otp: sentOtp } = req.body;

  if (!name) {
    res.status(400).send({ error: 'Missing name' });
    return;
  }

  if (!email) {
    res.status(400).send({ error: 'Missing email' });
    return;
  }

  if (!password) {
    res.status(400).send({ error: 'Missing password' });
    return;
  }

  if (!sentOtp) {
    res.status(400).send({ error: 'Missing OTP' });
    return;
  }

  if (!(await isValidGithubId(github))) {
    res.status(400).send({ error: 'Invalid Github ID' });
    return;
  }

  const row = await User.get([User.EMAIL, email]);

  if (row.length) {
    res.status(400).send({ error: 'User already exists' });
    return;
  }

  try {
    const [{ otp: storedOtp }] = await Otp.get([Otp.EMAIL, email]);

    if (storedOtp !== sentOtp) {
      res.status(400).send({ error: 'Invalid OTP' });
      return;
    }

    await User.insert(
      [User.NAME, name],
      [User.EMAIL, email],
      [User.PASSWORD, encryptPassword(password)],
      [User.WEBSITE, website],
      [User.GITHUB, github],
    );

    res.send({ message: 'User created' });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

route.put('/threshold', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in' });
      return;
    }

    const { threshold } = req.body;

    if (threshold < 1000) {
      res.status(400).send({ error: 'Invalid threshold' });
      return;
    }

    await User.update([User.THRESHOLD, threshold], [User.ID, loggedInUser.id]);

    res.send({ message: 'Threshold updated' });
  } catch (error) {
    handleError(res, error);
  }
});

route.put('/', async (req, res) => {
  let { email, name, github, website } = req.body;

  const { otp: sentOtp } = req.body;

  try {
    const loggedInUser = await getLoggedInUser(req);

    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in' });
      return;
    }

    if (loggedInUser.email === email) {
      email = undefined;
    }

    if (loggedInUser.name === name) {
      name = undefined;
    }

    if (loggedInUser.github === github) {
      github = undefined;
    }

    if (loggedInUser.website === website) {
      website = undefined;
    }

    if (!(await isValidGithubId(github))) {
      res.status(400).send({ error: 'Invalid Github ID' });
      return;
    }

    if (email) {
      const row = await User.get([User.EMAIL, email]);

      if (row.length) {
        res.status(400).send({ error: 'User already' });
        return;
      }

      const [{ otp: storedOtp }] = await Otp.get([Otp.EMAIL, email]);
      if (storedOtp !== sentOtp) {
        res.status(400).send({ error: 'Invalid OTP' });
        return;
      }
    }

    await User.update(
      [
        [User.EMAIL, email],
        [User.NAME, name],
        [User.GITHUB, github],
        [User.WEBSITE, website],
      ],
      [User.ID, loggedInUser.id],
    );

    res.send({ message: 'User updated' });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

route.patch('/payment-method/update-default/:id', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in' });
      return;
    }

    const { id } = req.params;

    const [row] = await PaymentMethod.get([
      [PaymentMethod.ID, id],
      [PaymentMethod.USER_ID, loggedInUser.id],
      [PaymentMethod.IS_DELETED, 0],
    ]);

    if (!row) {
      res.status(400).send({ error: 'Payment method not found' });
      return;
    }

    await PaymentMethod.update(
      [PaymentMethod.IS_DEFAULT, 0],
      [
        [PaymentMethod.USER_ID, loggedInUser.id],
        [PaymentMethod.IS_DEFAULT, 1],
      ],
    );

    await PaymentMethod.update([PaymentMethod.IS_DEFAULT, 1], [PaymentMethod.ID, id]);

    res.send({ message: 'Payment method updated' });
  } catch (error) {
    handleError(res, error);
  }
});

route.delete('/payment-method/:id', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in' });
      return;
    }

    const { id } = req.params;

    const [row] = await PaymentMethod.get([
      [PaymentMethod.ID, id],
      [PaymentMethod.USER_ID, loggedInUser.id],
    ]);

    if (!row) {
      res.status(400).send({ error: 'Payment method not found' });
      return;
    }

    const payments = await Payment.get([Payment.PAYMENT_METHOD_ID, id]);

    if (payments.length) {
      await PaymentMethod.update([PaymentMethod.IS_DELETED, 1], [PaymentMethod.ID, id]);
    } else {
      await PaymentMethod.delete([PaymentMethod.ID, id]);
    }

    const defaultRow = await PaymentMethod.get([
      [PaymentMethod.USER_ID, loggedInUser.id],
      [PaymentMethod.IS_DEFAULT, 1],
      [PaymentMethod.IS_DELETED, 0],
    ]);

    if (!defaultRow.length) {
      const [firstRow] = await PaymentMethod.get([
        [PaymentMethod.USER_ID, loggedInUser.id],
        [PaymentMethod.IS_DELETED, 0],
      ]);

      if (firstRow) {
        await PaymentMethod.update([PaymentMethod.IS_DEFAULT, 1], [PaymentMethod.ID, firstRow.id]);
      }
    }

    res.send({ message: 'Payment method deleted' });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * Checks if the github id is valid
 * @param {string} id
 * @returns
 */
async function isValidGithubId(id) {
  if (!id) return true;
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(id);
}

/**
 * First checks if the user is logged in, if not, returns null and sends a 401 response
 * if the user is logged in, it check wether is same as the user in the request params
 * if not, returns null and sends a 401 response
 * @param {Express.Request} req
 * @returns {Promise<object|null>}
 */
async function getAuthorizedUser(req) {
  const { user: userId } = req.query;
  const error = new Error('User not found');
  const loggedInUser = await getLoggedInUser(req);

  if (!userId) {
    error.message = 'No user id specified';
    error.code = 400;
    throw error;
  }

  if (!loggedInUser) {
    error.message = 'Not logged in';
    error.code = 401;
    throw error;
  }

  if (!areSameUser(userId, loggedInUser) && !loggedInUser.isAdmin) {
    error.message = 'Not authorized';
    error.code = 401;
    throw error;
  }

  const [user] = await User.get([User.ID, userId]);
  if (!user) {
    error.message = 'User not found';
    error.code = 404;
    throw error;
  }

  return user;
}

/**
 * Handles errors
 * @param {Express.Response} res
 * @param {Error} error
 */
function handleError(res, error) {
  res.status(error.code || 500).send({ error: error.message });
}

module.exports = route;
