import { TIER_ORDER } from '../../shared/sponsorTiers';

function tierRank(sponsor) {
  const rank = TIER_ORDER.indexOf(sponsor.tier);
  return rank < 0 ? TIER_ORDER.length : rank;
}

export function mergeSponsors(activeSponsors, expiredSponsors, { totalLimit = Number.POSITIVE_INFINITY } = {}) {
  const active = Array.isArray(activeSponsors) ? activeSponsors.map((sponsor) => ({ ...sponsor, expired: false })) : [];
  const seen = new Set(active.map((sponsor) => String(sponsor.id)));
  // The API supplies expired sponsors by latest expiry; preserve that order.
  const expired = Array.isArray(expiredSponsors)
    ? expiredSponsors.filter((sponsor) => !seen.has(String(sponsor.id))).map((sponsor) => ({ ...sponsor, expired: true }))
    : [];
  active.sort((a, b) => tierRank(a) - tierRank(b));
  return [...active, ...expired].slice(0, totalLimit);
}

export async function fetchSponsorMix({ totalLimit = Number.POSITIVE_INFINITY, expiredLimit = 12 } = {}) {
  let activeSponsors = [];
  try {
    const response = await fetch('/api/sponsors');
    if (response.ok) activeSponsors = await response.json();
  } catch {
    return [];
  }

  if (!Array.isArray(activeSponsors)) return [];
  if (activeSponsors.length >= totalLimit) return mergeSponsors(activeSponsors, [], { totalLimit });

  const remaining = Number.isFinite(totalLimit) ? totalLimit - activeSponsors.length : expiredLimit;
  const requestedExpired = Math.max(0, Math.min(expiredLimit, remaining));
  if (!requestedExpired) return mergeSponsors(activeSponsors, [], { totalLimit });

  let expiredSponsors = [];
  try {
    const response = await fetch(`/api/sponsors?scope=expired&limit=${requestedExpired}`);
    if (response.ok) expiredSponsors = await response.json();
  } catch {
    // Active sponsors remain usable when the presentation-only fallback fails.
  }

  return mergeSponsors(activeSponsors, expiredSponsors, { totalLimit });
}
