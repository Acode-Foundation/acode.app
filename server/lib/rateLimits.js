const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { getLoginSession } = require('./helpers');

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

function limiter(limit, windowMinutes) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: createUserOrIpKey(getLoginSession),
    message: { error: 'Too many requests, please try again later.' },
  });
}

module.exports = {
  createUserOrIpKey,
  // Each upload is unzipped and run through the plugin scanner.
  pluginUploadLimiter: limiter(10, 15),
  // Admin moderation and deletion touch plugin files on disk.
  pluginAdminLimiter: limiter(120, 15),
  // Scan history reads several plugin_scan rows (with full reports for admins).
  pluginScanReadLimiter: limiter(300, 15),
};
