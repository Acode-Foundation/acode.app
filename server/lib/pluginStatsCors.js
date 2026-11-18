function pluginStatsCors(req, res, next) {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'ETag, Retry-After',
  });
  res.removeHeader('Access-Control-Allow-Credentials');
  if (req.method === 'OPTIONS') {
    res.set({
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'If-None-Match, Cache-Control, Pragma',
      'Access-Control-Max-Age': '600',
    });
    res.status(204).end();
    return;
  }
  next();
}

module.exports = pluginStatsCors;
