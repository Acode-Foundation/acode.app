const { Router } = require('express');
const moment = require('moment');
const crypto = require('node:crypto');
const { encryptPassword, isValidPassword } = require('../password');
const { getLoggedInUser, getWebLoggedInUser, areSameUser, getCountryFromIp } = require('../lib/helpers');
const { rejectSignedIn } = require('../lib/guestOnly');
const Comment = require('../entities/comment');
const User = require('../entities/user');
const Payment = require('../entities/payment');
const PaymentMethod = require('../entities/paymentMethod');
const UserEarnings = require('../entities/userEarnings');
const calcEarnings = require('../lib/calcEarnings');
const earningsReview = require('../lib/earningsReview');
const { getDeveloperDashboard } = require('../lib/developerDashboard');
const AppConfig = require('../entities/appConfig');
const login = require('../entities/login');
const AppAuthCode = require('../entities/appAuthCode');
const { appAuthCodeLimiter, appTokenExchangeLimiter, appleUnlinkLimiter, emailCodeCheckLimiter } = require('../lib/rateLimits');
const { consumeEmailCode } = require('../lib/emailCode');
const { logAppleError } = require('../lib/appleOAuth');
const {
  BANK_INDIA,
  PAYMENT_METHOD_LIMIT,
  PAYMENT_METHOD_TYPES,
  getPaymentMethodType,
  isPaymentMethodTypeAvailable,
  validatePaymentMethod,
} = require('../../shared/paymentMethods');

const route = Router();

const hexPattern = /^[a-f0-9]+$/i;

function isHex(value, minLength, maxLength = minLength) {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength && hexPattern.test(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeCompareHex(a, b) {
  if (!isHex(a, 64) || !isHex(b, 64)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

route.post('/app-token', appAuthCodeLimiter, async (req, res) => {
  try {
    const loggedInUser = await getWebLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'User not logged in' });
      return;
    }

    // Older clients omit this field; new confirmations must match the issuing session.
    if (req.body?.expectedUserId !== undefined && req.body.expectedUserId !== loggedInUser.id) {
      res.status(409).send({ error: 'Your signed-in account changed. Please confirm the account again.' });
      return;
    }

    const [loginRow] = await login.get(login.columns, [
      [login.USER_ID, loggedInUser.id],
      [login.TYPE, 'app'],
    ]);

    const token = crypto.randomBytes(64).toString('hex');
    const expiredAt = moment().add(150, 'day').format('YYYY-MM-DD HH:mm:ss.sss');

    if (loginRow) {
      await login.update(
        [
          [login.TOKEN, token],
          [login.EXPIRED_AT, expiredAt],
        ],
        [login.ID, loginRow.id],
      );
    } else {
      await login.insert([login.USER_ID, loggedInUser.id], [login.TOKEN, token], [login.EXPIRED_AT, expiredAt], [login.TYPE, 'app']);
    }

    res.send({ token });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Failed to get app token' });
  }
});

route.post('/app-auth-code', appAuthCodeLimiter, async (req, res) => {
  try {
    const loggedInUser = await getWebLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'User not logged in' });
      return;
    }

    if (req.body?.expectedUserId !== undefined && req.body.expectedUserId !== loggedInUser.id) {
      res.status(409).send({ error: 'Your signed-in account changed. Please confirm the account again.' });
      return;
    }

    const { state, challenge, appVersionCode } = req.body || {};
    if (!isHex(state, 16, 128)) {
      res.status(400).send({ error: 'Invalid login state' });
      return;
    }

    if (!isHex(challenge, 64)) {
      res.status(400).send({ error: 'Invalid app auth challenge' });
      return;
    }

    const code = crypto.randomBytes(32).toString('hex');
    const expiredAt = moment().add(5, 'minutes').format('YYYY-MM-DD HH:mm:ss.sss');
    const parsedVersionCode = Number.parseInt(appVersionCode, 10);

    AppAuthCode.cleanupStaleRows();
    await AppAuthCode.insert(
      [AppAuthCode.USER_ID, loggedInUser.id],
      [AppAuthCode.CODE, code],
      [AppAuthCode.STATE, state],
      [AppAuthCode.CHALLENGE, challenge],
      [AppAuthCode.APP_VERSION_CODE, Number.isFinite(parsedVersionCode) ? parsedVersionCode : null],
      [AppAuthCode.EXPIRED_AT, expiredAt],
    );

    res.send({ code });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Failed to create app auth code' });
  }
});

route.post('/app-token/exchange', appTokenExchangeLimiter, async (req, res) => {
  try {
    const { code, state, verifier } = req.body || {};
    if (!isHex(code, 64) || !isHex(state, 16, 128) || !isHex(verifier, 64)) {
      res.status(400).send({ error: 'Invalid app auth exchange payload' });
      return;
    }

    const [authCode] = await AppAuthCode.for('internal').get(AppAuthCode.columns, [
      [AppAuthCode.CODE, code],
      [AppAuthCode.STATE, state],
      [AppAuthCode.USED, 0],
    ]);

    if (!authCode?.challenge || moment().isAfter(moment(authCode.expired_at))) {
      res.status(400).send({ error: 'Invalid or expired app auth code' });
      return;
    }

    if (!safeCompareHex(sha256(verifier), authCode.challenge)) {
      res.status(400).send({ error: 'Invalid app auth verifier' });
      return;
    }

    if (!AppAuthCode.markUsed(authCode.id)) {
      res.status(400).send({ error: 'Invalid or expired app auth code' });
      return;
    }

    const [loginRow] = await login.for('internal').get(login.columns, [
      [login.USER_ID, authCode.user_id],
      [login.TYPE, 'app'],
    ]);

    const token = crypto.randomBytes(64).toString('hex');
    const expiredAt = moment().add(150, 'day').format('YYYY-MM-DD HH:mm:ss.sss');

    if (loginRow) {
      await login.update(
        [
          [login.TOKEN, token],
          [login.EXPIRED_AT, expiredAt],
        ],
        [login.ID, loginRow.id],
      );
    } else {
      await login.insert([login.USER_ID, authCode.user_id], [login.TOKEN, token], [login.EXPIRED_AT, expiredAt], [login.TYPE, 'app']);
    }

    AppAuthCode.cleanupStaleRows();
    res.send({ token });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Failed to exchange app auth code' });
  }
});

route.get('/payment-methods', async (req, res) => {
  try {
    const user = await getAuthorizedUser(req);
    const rows = await PaymentMethod.get(PaymentMethod.columns, [
      [PaymentMethod.USER_ID, user.id],
      [PaymentMethod.IS_DELETED, 0],
    ]);

    const paypalEnabled = await AppConfig.isPayPalEnabled();
    res.send(
      rows.map((row) => {
        const type = getPaymentMethodType(row);
        return { ...row, type, available: isPaymentMethodTypeAvailable(type, { paypalEnabled }) };
      }),
    );
  } catch (error) {
    handleError(res, error);
  }
});

// What the logged in user can add right now.
route.get('/payment-method-options', async (req, res) => {
  try {
    const loggedInUser = await getWebLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in' });
      return;
    }

    const paypalEnabled = await AppConfig.isPayPalEnabled();
    const rows = await PaymentMethod.get([
      [PaymentMethod.USER_ID, loggedInUser.id],
      [PaymentMethod.IS_DELETED, 0],
    ]);

    res.set('Cache-Control', 'no-store');
    res.send({
      types: PAYMENT_METHOD_TYPES.filter((type) => isPaymentMethodTypeAvailable(type, { paypalEnabled })),
      count: rows.length,
      limit: PAYMENT_METHOD_LIMIT,
      hasDefault: rows.some((row) => row.is_default && isPaymentMethodTypeAvailable(getPaymentMethodType(row), { paypalEnabled })),
      threshold: await AppConfig.getPaymentThreshold(),
      country: getCountryFromIp(req.ip),
    });
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
    let estimated = false;
    await earningsReview.assertClear(user.id, year, month);

    const now = moment();
    const thisMonth = moment({ year: now.year(), month: now.month() });
    const targetMonth = moment({ year, month });
    if (thisMonth.isSame(targetMonth)) {
      estimated = true;
      earnings = await calcEarnings.total(year, month, user);
    } else {
      const [row] = await UserEarnings.get([
        [UserEarnings.USER_ID, user.id],
        [UserEarnings.YEAR, year],
        [UserEarnings.MONTH, month],
      ]);

      estimated = row?.amount == null && thisMonth.clone().subtract(1, 'month').isSame(targetMonth, 'month');
      earnings = row?.amount ?? (estimated ? await calcEarnings.total(year, month, user) : 0);
    }

    res.send({
      earnings,
      estimated,
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
    const threshold = await AppConfig.getPaymentThreshold();
    const { earnings, from, to } = await calcEarnings.unpaid(user);

    if (!earnings) {
      // send earnings from last month
      const now = moment();
      const date = now.date();
      const lastMonth = moment({
        year: now.year(),
        month: now.month(),
      }).subtract(1, 'month');
      const lastMonthEarnings = await calcEarnings.total(lastMonth.year(), lastMonth.month(), user);

      if (date >= 16) {
        // send earnings from this month
        const thisMonthEarnings = await calcEarnings.total(now.year(), now.month(), user);
        res.send({
          threshold,
          earnings: thisMonthEarnings,
          from: now.startOf('month').format('YYYY-MM-DD'),
          to: now.endOf('month').format('YYYY-MM-DD'),
        });
        return;
      }

      res.send({
        threshold,
        earnings: lastMonthEarnings,
        from: lastMonth.startOf('month').format('YYYY-MM-DD'),
        to: lastMonth.endOf('month').format('YYYY-MM-DD'),
      });
      return;
    }

    res.send({
      threshold,
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

route.get('/dashboard', async (req, res) => {
  try {
    const user = await getAuthorizedUser(req);
    const dashboard = await getDeveloperDashboard(user, { estimateEarnings: calcEarnings.total });
    res.send(dashboard);
  } catch (error) {
    handleError(res, error);
  }
});

route.get('/payments{/:year}', async (req, res) => {
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
    const loggedInUser = await getWebLoggedInUser(req);
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

    const { paymentMethod: _paymentMethod, paymentMethodId: _paymentMethodId, ...rest } = payment;

    res.send({
      ...rest,
      paymentMethod: row,
    });
  } catch (error) {
    handleError(res, error);
  }
});

route.delete('/link/github', async (req, res) => {
  try {
    const loggedInUser = await getWebLoggedInUser(req);
    if (!loggedInUser) {
      return res.status(401).send({ error: 'Not logged in' });
    }

    if (!loggedInUser.github_id) {
      return res.status(400).send({ error: 'GitHub is not linked' });
    }

    if (loggedInUser.primary_auth === 'github') {
      return res.status(400).send({ error: 'Cannot unlink your primary login method' });
    }

    await User.update(
      [
        [User.GITHUB_ID, null],
        [User.GITHUB, null],
      ],
      [User.ID, loggedInUser.id],
    );

    res.send({ message: 'GitHub account unlinked' });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

route.delete('/link/google', async (req, res) => {
  try {
    const loggedInUser = await getWebLoggedInUser(req);
    if (!loggedInUser) {
      return res.status(401).send({ error: 'Not logged in' });
    }

    if (!loggedInUser.google_id) {
      return res.status(400).send({ error: 'Google is not linked' });
    }

    if (loggedInUser.primary_auth === 'google') {
      return res.status(400).send({ error: 'Cannot unlink your primary login method' });
    }

    await User.update([[User.GOOGLE_ID, null]], [User.ID, loggedInUser.id]);

    res.send({ message: 'Google account unlinked' });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

route.delete('/link/apple', appleUnlinkLimiter, async (req, res) => {
  try {
    const account = await getWebLoggedInUser(req);
    if (!account) return res.status(401).send({ error: 'Not logged in' });
    if (!account.apple_id) return res.status(400).send({ error: 'Apple is not linked' });
    if (account.primary_auth === 'apple') return res.status(400).send({ error: 'Cannot unlink your primary login method' });
    const authorization = await User.revokeAppleAuthorization(account.id);
    if (authorization) {
      await User.update(
        [
          [User.APPLE_ID, null],
          [User.APPLE_REFRESH_TOKEN, null],
        ],
        [
          [User.ID, account.id],
          [User.APPLE_ID, authorization.apple_id],
          [User.APPLE_REFRESH_TOKEN, authorization.apple_refresh_token],
        ],
      );
    }
    const [current] = await User.get([User.ID, account.id]);
    if (current?.apple_id) return res.status(409).send({ error: 'Your Apple account link changed. Please try unlinking again.' });
    res.send({ message: 'Apple account unlinked' });
  } catch (error) {
    logAppleError('unlink', error);
    if (error?.code === 'APPLE_REVOCATION_CREDENTIAL_MISSING') {
      return res.status(409).send({ error: 'Sign in with your linked Apple account, then try unlinking again.' });
    }
    res.status(500).send({ error: 'Unable to unlink Apple. Please try again.' });
  }
});

route.get('/:idOrEmail', async (req, res) => {
  try {
    const { idOrEmail } = req.params;
    const loggedInUser = await getLoggedInUser(req);
    const isAdmin = Boolean(loggedInUser?.isAdmin);
    // Only admins may look users up by email, or anyone could check whether an address has an account.
    const where = isAdmin
      ? [
          [User.ID, idOrEmail],
          [User.EMAIL, idOrEmail],
        ]
      : [[User.ID, idOrEmail]];

    const [row] = await User.get(User.publicColumns, where, 'OR');
    if (!row) {
      res.status(404).send({ error: 'User not found' });
      return;
    }

    if (isAdmin || String(loggedInUser?.id) === String(row.id)) {
      const [privateRow] = await User.get(User.safeColumns, [User.ID, row.id]);
      res.send(privateRow);
      return;
    }

    res.send(row);
  } catch (error) {
    handleError(res, error);
  }
});

route.patch('/verify{/:type}/:userId', async (req, res) => {
  try {
    const loggedInUser = await getWebLoggedInUser(req);
    if (!loggedInUser?.isAdmin) {
      res.status(401).send({ error: 'Not authorized' });
      return;
    }

    const { userId } = req.params;
    await User.update([User.VERIFIED, req.params.type === 'revoke' ? 0 : 1], [User.ID, userId]);

    res.send({ message: 'User verified' });
  } catch (error) {
    handleError(res, error);
  }
});

route.post('/payment-method', async (req, res) => {
  try {
    const loggedInUser = await getWebLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in' });
      return;
    }

    const { is_default: makeDefault } = req.body;
    // Pages loaded before the types existed only know Indian bank accounts.
    const type = req.body.type ?? (req.body.bank_ifsc_code ? BANK_INDIA : undefined);
    const paypalEnabled = await AppConfig.isPayPalEnabled();
    if (PAYMENT_METHOD_TYPES.includes(type) && !isPaymentMethodTypeAvailable(type, { paypalEnabled })) {
      res.status(400).send({ error: 'This payment method is currently unavailable' });
      return;
    }

    const { values, errors } = validatePaymentMethod(type, req.body);
    const [error] = Object.values(errors);
    if (error) {
      res.status(400).send({ error, errors });
      return;
    }

    const result = PaymentMethod.add(loggedInUser.id, type, values, {
      makeDefault: ['1', 'true', 'on', true].includes(makeDefault),
      paypalEnabled,
      limit: PAYMENT_METHOD_LIMIT,
    });

    if (result === 'duplicate') {
      res.status(400).send({ error: 'You have already added this payment method' });
      return;
    }

    if (result === 'limit') {
      res.status(400).send({ error: `You can add only ${PAYMENT_METHOD_LIMIT} payment methods` });
      return;
    }

    res.send({ message: 'Payment method added' });
  } catch (error) {
    handleError(res, error);
  }
});

route.post('/', emailCodeCheckLimiter, rejectSignedIn, async (req, res) => {
  const { name, email, password, otp: sentOtp } = req.body;

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

  if (!isValidPassword(password)) {
    res.status(400).send({ error: 'Invalid password' });
    return;
  }

  if (!sentOtp) {
    res.status(400).send({ error: 'Missing OTP' });
    return;
  }

  const row = await User.get([User.EMAIL, email]);

  if (row.length) {
    res.status(400).send({ error: 'User already exists' });
    return;
  }

  try {
    if (!consumeEmailCode(email, 'signup', sentOtp)) {
      res.status(400).send({ error: 'Invalid or expired OTP' });
      return;
    }

    await User.insert([User.NAME, name], [User.EMAIL, email], [User.PASSWORD, encryptPassword(password)], [User.PRIMARY_AUTH, 'email']);

    res.send({ message: 'User created' });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

route.put('/threshold', async (_req, res) => {
  try {
    const threshold = await AppConfig.getPaymentThreshold();
    res.status(410).send({
      error: `Payment threshold is now fixed at ₹${threshold.toLocaleString()} for all users. It can be changed by an admin in Settings.`,
    });
  } catch {
    res.status(410).send({
      error: `Payment threshold is fixed. It can be changed by an admin in Settings.`,
    });
  }
});

route.put('/', async (req, res) => {
  const { email, name, github, website, x, linkedin, otp: sentOtp } = req.body;

  try {
    const loggedInUser = await getWebLoggedInUser(req);

    if (!loggedInUser) {
      res.status(401).send({ error: 'Not logged in' });
      return;
    }

    if (!isValidGithubId(github)) {
      res.status(400).send({ error: 'Invalid Github ID' });
      return;
    }

    if (!isValidXId(x)) {
      res.status(400).send({ error: 'Invalid X ID' });
      return;
    }

    if (!isValidLinkedInId(linkedin)) {
      res.status(400).send({ error: 'Invalid LinkedIn ID' });
      return;
    }

    if (!email) {
      res.status(400).send({ error: 'Missing email' });
      return;
    }

    if (email !== loggedInUser.email) {
      if (!sentOtp) {
        res.status(400).send({ error: 'Missing OTP' });
        return;
      }

      const row = await User.get([User.EMAIL, email]);
      if (row.length) {
        res.status(400).send({ error: 'User already' });
        return;
      }

      if (!consumeEmailCode(email, 'signup', sentOtp)) {
        res.status(400).send({ error: 'Invalid or expired OTP' });
        return;
      }
    }

    await User.update(
      [
        [User.X, x],
        [User.NAME, name],
        [User.EMAIL, email],
        [User.GITHUB, github],
        [User.WEBSITE, website],
        [User.LINKEDIN, linkedin],
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
    const loggedInUser = await getWebLoggedInUser(req);
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

    if (!isPaymentMethodTypeAvailable(getPaymentMethodType(row), { paypalEnabled: await AppConfig.isPayPalEnabled() })) {
      res.status(400).send({ error: 'This payment method is currently unavailable' });
      return;
    }

    // It may have been deleted since it was read.
    if (!PaymentMethod.setDefault(loggedInUser.id, id)) {
      res.status(400).send({ error: 'Payment method not found' });
      return;
    }

    res.send({ message: 'Payment method updated' });
  } catch (error) {
    handleError(res, error);
  }
});

route.delete('/payment-method/:id', async (req, res) => {
  try {
    const loggedInUser = await getWebLoggedInUser(req);
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

    if (row.is_default && !row.is_deleted) {
      res.status(400).send({ error: 'Set another payment method as default before deleting this one' });
      return;
    }

    const payments = await Payment.get([Payment.PAYMENT_METHOD_ID, id]);

    if (payments.length) {
      await PaymentMethod.update(
        [
          [PaymentMethod.IS_DELETED, 1],
          [PaymentMethod.IS_DEFAULT, 0],
        ],
        [PaymentMethod.ID, id],
      );
    } else {
      await PaymentMethod.delete([PaymentMethod.ID, id]);
    }

    const defaultRow = await PaymentMethod.get([
      [PaymentMethod.USER_ID, loggedInUser.id],
      [PaymentMethod.IS_DEFAULT, 1],
      [PaymentMethod.IS_DELETED, 0],
    ]);

    if (!defaultRow.length) {
      const paypalEnabled = await AppConfig.isPayPalEnabled();
      const rows = await PaymentMethod.get([
        [PaymentMethod.USER_ID, loggedInUser.id],
        [PaymentMethod.IS_DELETED, 0],
      ]);
      const firstRow = rows.find((method) => isPaymentMethodTypeAvailable(getPaymentMethodType(method), { paypalEnabled })) ?? rows[0];

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
 */
function isValidGithubId(id) {
  if (!id) return true;
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(id);
}

/**
 * Checks if the linkedin id is valid
 * @param {string} id
 */
function isValidLinkedInId(id) {
  if (!id) return true;
  return /^[a-zA-Z0-9-]{3,100}$/i.test(id);
}

/**
 * Checks if the x id is valid
 * @param {string} id
 */
function isValidXId(id) {
  if (!id) return true;
  return /^[A-Za-z0-9_]{1,15}$/i.test(id);
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
  const loggedInUser = await getWebLoggedInUser(req);

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
  console.log(error);
  const status = [error.statusCode, error.code].find((value) => Number.isInteger(value) && value >= 400 && value <= 599) ?? 500;
  res.status(status).send({ error: error.message });
}

module.exports = route;
