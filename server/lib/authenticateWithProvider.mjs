import moment from 'moment';
import authenticationProvider from '../entities/authenticationProvider.mjs';
import login from '../entities/login.js';
import User from '../entities/user.js';
// Tokens are encrypted while they're stored, and SHOULD BE decrypted
// When it's being used as values (i.e API with the tokens retrieved from the DB).
import { encryptToken } from '../lib/tokenCrypto.mjs';

async function authenticateWithProvider(providerType, profile, tokens) {
  const { id: providerUserId, email, name, username } = profile;
  const { accessToken, refreshToken, expiresIn } = tokens;

  if (!email) {
    throw new Error('Email not provided by OAuth provider');
  }

  // Calculate token expiry
  const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

  let userId;

  const existingLink = await authenticationProvider.get(
    [authenticationProvider.ID, authenticationProvider.USER_ID],
    [authenticationProvider.PROVIDER, providerType],
    [authenticationProvider.PROVIDER_USER_ID, providerUserId],
  );

  if (existingLink.length > 0) {
    userId = existingLink[0].user_id;

    await authenticationProvider.update([
      [authenticationProvider.ID, existingLink[0].id],
      [authenticationProvider.ACCESS_TOKEN, await encryptToken(accessToken)],
      [authenticationProvider.REFRESH_TOKEN, refreshToken ? await encryptToken(refreshToken) : null],
      [authenticationProvider.ACCESS_TOKEN_EXPIRES_AT, tokenExpiresAt],
      [authenticationProvider.SCOPE, tokens.scope || null],
    ]);
  } else {
    // Atomic, race-safe upsert pattern for user
    await User.insertOrIgnore(
      [User.NAME, name],
      [User.EMAIL, email],
      [User.PASSWORD, ''],
      [User.WEBSITE, null],
      [User.GITHUB, providerType === 'github' ? username : null],
    );
    // Always fetch the user after insert - ensures you get the correct id whether existing or new
    const userRes = await User.get([User.EMAIL, email]);
    if (!userRes || userRes.length === 0) {
      throw new Error(`Failed to retrieve user`);
    }
    userId = userRes[0].id;

    await authenticationProvider.insert(
      [authenticationProvider.USER_ID, userId],
      [authenticationProvider.PROVIDER, providerType],
      [authenticationProvider.PROVIDER_USER_ID, providerUserId],
      [authenticationProvider.ACCESS_TOKEN, await encryptToken(accessToken)],
      [authenticationProvider.REFRESH_TOKEN, refreshToken ? await encryptToken(refreshToken) : null],
      [authenticationProvider.ACCESS_TOKEN_EXPIRES_AT, tokenExpiresAt],
      [authenticationProvider.REFRESH_TOKEN_EXPIRES_AT, null],
      [authenticationProvider.SCOPE, tokens.scope || null],
    );
  }

  // break this into a Function, if it gets too repetitive throughout the whole codebase.
  const { randomBytes } = await import('node:crypto');
  const sessionToken = randomBytes(64).toString('hex');
  const sessionExpiredAt = moment().add(1, 'week').format('YYYY-MM-DD HH:mm:ss.sss');

  await login.insert([login.USER_ID, userId], [login.TOKEN, sessionToken], [login.EXPIRED_AT, sessionExpiredAt]);

  return sessionToken;
}

export default authenticateWithProvider;
