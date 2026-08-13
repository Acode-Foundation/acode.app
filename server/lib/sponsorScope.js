const MAX_EXPIRED_SPONSORS = 100;

function normalizeExpiredLimit(value, fallback = 12) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_EXPIRED_SPONSORS, Math.max(1, parsed));
}

function getSponsorScope(scope) {
  if (scope == null || scope === '' || scope === 'active') return 'active';
  if (scope === 'expired') return 'expired';
  return null;
}

function getSponsorWhereClause(sponsor, scope, now = new Date().toISOString()) {
  return [
    [sponsor.STATUS, sponsor.STATE_PURCHASED],
    [sponsor.PUBLIC, 1],
    [sponsor.EXPIRES_AT, now, scope === 'expired' ? '<=' : '>'],
  ];
}

function getSponsorQueryOptions(sponsor, scope, { page, limit } = {}) {
  const options = {
    page,
    limit: scope === 'expired' ? normalizeExpiredLimit(limit) : limit,
  };
  if (scope === 'expired') options.orderBy = `${sponsor.EXPIRES_AT} DESC`;
  return options;
}

module.exports = { getSponsorQueryOptions, getSponsorScope, getSponsorWhereClause, normalizeExpiredLimit };
