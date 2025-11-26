const moment = require('moment');
const authenticationProvider = require('../entities/authenticationProvider');
const login = require('../entities/login');
const User = require('../entities/user');

async function authenticateWithProvider(providerType, profile, tokens) {
    const { id: providerUserId, email, name, username } = profile;
    const { accessToken, refreshToken, expiresIn } = tokens;

    if (!email) {
      throw new Error('Email not provided by OAuth provider');
    }

    // Calculate token expiry
    const tokenExpiresAt = expiresIn 
      ? new Date(Date.now() + expiresIn * 1000)
      : null;

    let userId;

    const existingLink = await authenticationProvider.get(
        [authenticationProvider.ID, authenticationProvider.USER_ID],
        [authenticationProvider.PROVIDER, providerType],
        [authenticationProvider.PROVIDER_USER_ID, providerUserId]
    );

    if(existingLink.length > 0) {
      userId = existingLink[0].user_id;


      await authenticationProvider.update(
        [
          [authenticationProvider.ID, existingLink[0].id], 
          [authenticationProvider.ACCESS_TOKEN, accessToken], 
          [authenticationProvider.REFRESH_TOKEN, refreshToken]
        ]
      )
    } else {
        const existingUser = await User.get([User.EMAIL, email]);

        if (existingUser.length > 0) {
          userId = existingUser[0].id;
        } else {
          
          await User.insert(
            [User.NAME, name],
            [User.EMAIL, email],
            [User.PASSWORD, ""],
            [User.WEBSITE, null],
            [User.GITHUB, providerType === "github" ? username : null],
          );
          
          const newUser = User.get([User.EMAIL, email]);
          userId = newUser[0].id;
        }
        
        await authenticationProvider.insert(
          [authenticationProvider.USER_ID, userId],
          [authenticationProvider.PROVIDER, providerType],
          [authenticationProvider.PROVIDER_USER_ID, providerUserId],
          [authenticationProvider.ACCESS_TOKEN, accessToken],
          [authenticationProvider.REFRESH_TOKEN, refreshToken],
          [authenticationProvider.ACCESS_TOKEN_EXPIRES_AT, tokenExpiresAt],
          [authenticationProvider.REFRESH_TOKEN_EXPIRES_AT, ""],
          [authenticationProvider.SCOPE, tokens.scope]
        );
    }

    // break this into a Function, if it gets too repetitive throughout the whole codebase.
    const sessionToken = require('node:crypto').randomBytes(64).toString('hex');
    const sessionExpiredAt = moment().add(1, 'week').format('YYYY-MM-DD HH:mm:ss.sss');

    await login.insert(
      [login.USER_ID, userId],
      [login.TOKEN, sessionToken],
      [login.EXPIRED_AT, sessionExpiredAt]
    )

    return sessionToken;
}

module.exports = authenticateWithProvider;