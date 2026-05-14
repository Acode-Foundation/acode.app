const crypto = require('node:crypto');
const moment = require('moment');
const login = require('../entities/login');
const { encryptPassword } = require('../password');

function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

function getGitHubAuthURL(state) {
  return `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.GITHUB_CALLBACK_URL)}&scope=user:email&state=${state}`;
}

async function getGitHubToken(code) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return data.access_token;
}

async function getGitHubUser(accessToken) {
  const [userResponse, emailsResponse] = await Promise.all([
    fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'acode.app',
      },
    }),
    fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'acode.app',
      },
    }),
  ]);

  const userData = await userResponse.json();
  const emailsData = await emailsResponse.json();

  const primaryEmail = emailsData.find((e) => e.primary)?.email;

  return {
    id: String(userData.id),
    name: userData.name || userData.login,
    login: userData.login,
    email: primaryEmail,
    avatar_url: userData.avatar_url,
  };
}

function getGoogleAuthURL(state) {
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.GOOGLE_CALLBACK_URL)}&response_type=code&scope=${encodeURIComponent('openid profile email')}&state=${state}`;
}

async function getGoogleToken(code) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_CALLBACK_URL,
      grant_type: 'authorization_code',
    }).toString(),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return data.access_token;
}

async function getGoogleUser(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  return {
    id: String(data.id),
    name: data.name,
    email: data.email,
    avatar_url: data.picture,
  };
}

async function issueTokenAndLogin(userId, res) {
  const token = crypto.randomBytes(64).toString('hex');
  const expiredAt = moment().add(1, 'week').format('YYYY-MM-DD HH:mm:ss.sss');

  await login.insert([login.USER_ID, userId], [login.TOKEN, token], [login.EXPIRED_AT, expiredAt]);

  res.cookie('token', token, {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: 'lax',
  });

  return token;
}

function generateRandomPassword() {
  return encryptPassword(crypto.randomBytes(32).toString('hex'));
}

module.exports = {
  generateState,
  getGitHubAuthURL,
  getGitHubToken,
  getGitHubUser,
  getGoogleAuthURL,
  getGoogleToken,
  getGoogleUser,
  issueTokenAndLogin,
  generateRandomPassword,
};
