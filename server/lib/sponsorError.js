const path = require('node:path');
const { VerificationException, VerificationStatus } = require('@apple/app-store-server-library');
const sourceRoot = path.resolve(__dirname, '..') + path.sep;

module.exports = { logSponsorError };

function logSponsorError(phase, error) {
  // Provider messages/stacks can contain receipt URLs, tokens or email addresses.
  const code = error?.code ?? error?.apiError ?? error?.httpStatusCode;
  const name = ['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError'].includes(error?.name)
    ? error.name
    : 'Error';
  // Keep only source locations inside our server, never messages, function names or provider URLs.
  const frames =
    typeof error?.stack === 'string'
      ? error.stack
          .slice(0, 16384)
          .split('\n')
          .flatMap((line) => {
            const start = line.indexOf(sourceRoot);
            if (!line.trimStart().startsWith('at ') || start < 0) return [];
            const location = line.slice(start + sourceRoot.length).replace(/\)$/, '');
            return /^[\w/-]+\.js:\d+:\d+$/.test(location) ? [location] : [];
          })
          .slice(0, 5)
      : [];
  console.error('Sponsor operation failed:', {
    phase,
    name,
    frames,
    code: typeof code === 'number' || (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) ? code : undefined,
    verificationStatus: error instanceof VerificationException ? VerificationStatus[error.status] : undefined,
  });
}
