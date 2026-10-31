function errorHandler(err, _req, res, next) {
  if (res.headersSent) return next(err);
  if (err.message === 'Unexpected end of form') {
    res.status(400).send({ error: 'Upload was interrupted. Please try again.' });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).send({ error: 'Internal server error' });
}

module.exports = errorHandler;
