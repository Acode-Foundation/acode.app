const fs = require('node:fs');
const path = require('node:path');

function sendPublicAsset(req, res, file, next) {
  // Companions are an internal delivery detail, not standalone assets.
  if (/\.(br|gz)$/.test(file)) return res.sendStatus(404);
  let selected = file;
  if (/\.(js|css|svg)$/.test(file)) {
    res.vary('Accept-Encoding');
    // Only dev watchers need the stale-companion guard. Production emission
    // and deployment copy order do not guarantee matching modification times.
    const development = process.env.NODE_ENV === 'development';
    const modified = development && fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs;
    const available = [
      ['br', '.br'],
      ['gzip', '.gz'],
    ].filter(([, suffix]) => {
      if (req.headers.range) return false;
      const companion = fs.statSync(file + suffix, { throwIfNoEntry: false });
      return companion && (!development || companion.mtimeMs >= modified);
    });
    const encoding = req.acceptsEncodings(...available.map(([name]) => name), 'identity');
    if (!encoding) return res.sendStatus(406);
    if (encoding !== 'identity') {
      selected += available.find(([name]) => name === encoding)[1];
      res.setHeader('Content-Encoding', encoding);
    }
  }
  res.type(path.extname(file));
  res.setHeader(
    'Cache-Control',
    /\.[a-f0-9]{8}\.(mp4|webp)$/.test(file) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
  );
  res.sendFile(selected, { cacheControl: false }, (error) => {
    // sendFile has already supplied Content-Range. Keep the protocol response
    // instead of letting the application's generic error handler turn it into 500.
    if (error?.status === 416 && !res.headersSent) return res.status(416).end();
    if (error) next(error);
  });
}

module.exports = { sendPublicAsset };
