const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { getLoginSession } = require('./helpers');
const { getApiKeyAuth } = require('./apiKeyAuth');

/**
 * Bucket key for a request. Signed-in users are keyed by account, so developers
 * behind one IP (an office, a carrier NAT) don't share a bucket. Only a token
 * that matches a live login session counts; made-up tokens fall back to the
 * client IP, so rotating them doesn't buy a fresh bucket.
 * @param {(req: object) => Promise<{ user_id: number } | null>} lookupSession
 */
function createUserOrIpKey(lookupSession) {
  return async (req) => {
    const session = await lookupSession(req).catch(() => null);
    return session ? `user:${session.user_id}` : ipKeyGenerator(req.ip);
  };
}

/**
 * API-key requests are bucketed by the key owner, so CI runners that share an IP
 * don't throttle each other. Requests with a rejected key fall back to the IP.
 * @param {object} req
 */
async function getRequesterSession(req) {
  const apiKey = await getApiKeyAuth(req);
  if (apiKey) return apiKey.key ? { user_id: apiKey.key.user_id } : null;
  return getLoginSession(req);
}

function limiter(limit, windowMinutes, options = {}) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: createUserOrIpKey(getRequesterSession),
    message: { error: 'Too many requests, please try again later.' },
    ...options,
  });
}

module.exports = {
  createUserOrIpKey,
  // Shared-IP allowance, before database access; spoofable bot/prefetch headers get no exemption.
  // Like the other limiters, this quota is per process and resets on restart.
  promotionRedirectLimiter: limiter(120, 1, {
    keyGenerator: (req) => ipKeyGenerator(req.ip),
  }),
  appAuthCodeLimiter: limiter(process.env.NODE_ENV === 'development' ? 200 : 20, 15),
  appTokenExchangeLimiter: limiter(process.env.NODE_ENV === 'development' ? 400 : 120, 15, {
    keyGenerator: (req) => ipKeyGenerator(req.ip),
  }),
  // Start/completion use account-or-IP; callbacks can use only a verified sealed flow.
  createAppleSignInLimiter: (handler) => limiter(120, 15, { handler }),
  createAppleCallbackLimiter: (handler, flowKey) =>
    limiter(120, 15, {
      keyGenerator: (req) => flowKey(req) || ipKeyGenerator(req.ip),
      handler,
    }),
  appleUnlinkLimiter: limiter(5, 10),
  // Each request emails a sign-up or password reset code.
  emailCodeLimiter: limiter(5, 10),
  // Sign-up and password reset check an emailed code.
  emailCodeCheckLimiter: limiter(20, 15),
  // Only failed sign-ins count, so people who sign in often aren't locked out.
  loginLimiter: limiter(10, 15, { skipSuccessfulRequests: true }),
  accountDeletionCodeLimiter: limiter(5, 10),
  accountDeletionLimiter: limiter(5, 10),
  apiKeyCodeLimiter: limiter(5, 10),
  apiKeyCreateLimiter: limiter(10, 10),
  // Each upload is unzipped and run through the plugin scanner.
  pluginUploadLimiter: limiter(10, 15),
  // Admin moderation and deletion touch plugin files on disk.
  pluginAdminLimiter: limiter(120, 15),
  // Scan history reads several plugin_scan rows (with full reports for admins).
  pluginScanReadLimiter: limiter(300, 15),
};
