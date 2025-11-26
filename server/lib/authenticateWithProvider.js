
async function authenticateWithProvider(providerType, profile, tokens) {
    const { id: providerUserId, email, name } = profile;
    const { accessToken, refreshToken, expiresIn } = tokens;

    if (!email) {
      throw new Error('Email not provided by OAuth provider');
    }

    // Calculate token expiry
    const tokenExpiresAt = expiresIn 
      ? new Date(Date.now() + expiresIn * 1000)
      : null;

    // Create a user in user table, & generate a login token for it if one doesn't already exist.
    // and return it.
}