const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Logged-in routes are keyed by session so developers behind one IP (an office,
// a carrier NAT) don't share a bucket; anything else falls back to the client IP.
function sessionOrIp(req) {
  const token = req.cookies?.token || req.headers['x-auth-token'];
  return token ? `session:${token}` : ipKeyGenerator(req.ip);
}

function limiter(limit, windowMinutes) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: sessionOrIp,
    message: { error: 'Too many requests, please try again later.' },
  });
}

module.exports = {
  // Each upload is unzipped and run through the plugin scanner.
  pluginUploadLimiter: limiter(10, 15),
  // Admin moderation and deletion touch plugin files on disk.
  pluginAdminLimiter: limiter(120, 15),
};
