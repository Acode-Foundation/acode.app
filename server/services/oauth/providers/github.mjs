import OAuthService from '../OAuthService.mjs';

class GitHubOAuthProvider extends OAuthService {
  constructor() {
    super({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      redirectUri: process.env.GITHUB_CALLBACK_URL,
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userInfoUrl: 'https://api.github.com/user',
      scopes: ['read:user', 'user:email'],
      providerName: 'github',
    });
  }

  async getUserProfile(accessToken) {
    try {
      const userProfileResponse = await fetch(this.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!userProfileResponse.ok) {
        const errorData = await userProfileResponse.json().catch(() => ({}));
        // ignore warning, Rethrown after catching....
        throw new Error(`Failed to fetch user profile, err message: ${errorData.message || 'Unknown error'}`);
      }

      const profile = await userProfileResponse.json(); // GitHub may not return email in profile, fetch separately
      let email = profile.email;
      if (!email) {
        const emailResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });

        if (!emailResponse.ok) {
          // ignore warning, Rethrown after catching....
          throw Error(
            `Failed to fetch User Email (response status: ${emailResponse.status}, response msg: ${(await emailResponse.json().catch(() => ({})))?.message || 'Unknown error'})`,
          );
        }

        emailResponse.data = await emailResponse.json();

        // Find primary verified email
        const primaryEmail = emailResponse?.data?.find((e) => e.primary && e.verified);
        email = primaryEmail ? primaryEmail.email : emailResponse.data[0]?.email;

        if (!email) {
          // ignore warning, Rethrown after catching....
          throw Error(
            `${emailResponse.data?.error_description || 'No verified email address found for GitHub user'} ${emailResponse?.data?.error_uri ? `(See: ${emailResponse.data.error_uri})` : ''}`,
          );
        }
      }

      return {
        id: profile.id.toString(),
        email: email,
        name: profile.name || profile.login,
        username: profile.login,
        avatar_url: profile.avatar_url,
        profile_url: profile.html_url,
        bio: profile.bio,
        raw: profile,
      };
    } catch (e) {
      console.error('[GitHubOAuthProvider - getUserProfile] GitHub profile fetch error:', e?.response?.data || e?.message);
      throw e;
    }
  }

  // GitHub OAuth App tokens don't expire
  calculateTokenExpiry(_expiresIn) {
    return null;
  }

  // GitHub OAuth Apps don't support refresh tokens
  async refreshAccessToken(_refreshToken) {
    throw new Error('GitHub OAuth Apps do not support token refresh');
  }
}

export default GitHubOAuthProvider;
