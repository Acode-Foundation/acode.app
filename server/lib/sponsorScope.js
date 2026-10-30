const { TIER_ORDER } = require('../../shared/sponsorTiers');

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
    // Migrations use SQLite timestamps; purchases use ISO timestamps. Compare
    // both in the same UTC format so sponsors remain active until their expiry.
    [`strftime('%Y-%m-%dT%H:%M:%fZ', ${sponsor.EXPIRES_AT})`, now, scope === 'expired' ? '<=' : '>'],
  ];
}

function getSponsorQueryOptions(sponsor, scope, { page, limit } = {}) {
  const options = {
    page,
    limit: scope === 'expired' ? normalizeExpiredLimit(limit) : limit,
    orderBy: [
      `CASE ${sponsor.TIER} ${TIER_ORDER.map((tier, rank) => `WHEN '${tier}' THEN ${rank}`).join(' ')} ELSE ${TIER_ORDER.length} END`,
      `${sponsor.CREATED_AT} DESC`,
      `${sponsor.ID} DESC`,
    ],
  };
  if (scope === 'expired') options.orderBy = [`julianday(${sponsor.EXPIRES_AT}) DESC`, `${sponsor.ID} DESC`];
  return options;
}

module.exports = { getSponsorQueryOptions, getSponsorScope, getSponsorWhereClause, normalizeExpiredLimit };
