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

  // Check if this provider account is already linked to a user
  const existingLink = await authenticationProvider.get(
    [authenticationProvider.ID, authenticationProvider.USER_ID],
    [authenticationProvider.PROVIDER, providerType],
    [authenticationProvider.PROVIDER_USER_ID, providerUserId],
  );

  if (existingLink.length > 0) {
    // Provider account already linked - just update tokens and log in
    userId = existingLink[0].user_id;

    await authenticationProvider.update([
      [authenticationProvider.ID, existingLink[0].id],
      [authenticationProvider.ACCESS_TOKEN, await encryptToken(accessToken)],
      [authenticationProvider.REFRESH_TOKEN, refreshToken ? await encryptToken(refreshToken) : null],
      [authenticationProvider.ACCESS_TOKEN_EXPIRES_AT, tokenExpiresAt],
      [authenticationProvider.SCOPE, tokens.scope || null],
    ]);
  } else {
    // No existing link for this provider account
    // Check if a user with this email already exists
    const existingUser = await User.get([User.EMAIL, email]);

    if (existingUser && existingUser.length > 0) {
      // User with this email exists but is NOT linked to this provider account.
      // This could be:
      // 1. A user who registered with email/password
      // 2. A user who registered with a different OAuth provider
      // 3. A different person who happens to have access to a GitHub account with this email
      //
      // For security, we should NOT automatically link accounts.
      // The user should explicitly link their accounts from their profile settings.
      throw new Error(
        `An account with email "${email}" already exists. Please log in with your original method and link your ${providerType} account from your profile settings.`,
      );
    }

    // No existing user with this email - create a new user
    await User.insert(
      [User.NAME, name],
      [User.EMAIL, email],
      [User.PASSWORD, ''],
      [User.WEBSITE, null],
      [User.GITHUB, providerType === 'github' ? username : null],
    );

    // Fetch the newly created user
    const userRes = await User.get([User.EMAIL, email]);
    if (!userRes || userRes.length === 0) {
      throw new Error(`Failed to create user`);
    }
    userId = userRes[0].id;

    // Create the provider link for the new user
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
