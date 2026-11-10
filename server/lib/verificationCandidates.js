// Ranks plugin developers for the verified badge. Every signal is normalised
// to 0..1 and weighted, so the admin sees one score plus the reasons behind it
// instead of eyeballing profiles, downloads and ratings by hand.
//
// Gaming resistance: downloads are capped per network, votes from throwaway
// accounts are discounted, and bursts are flagged. A flag never verifies or
// rejects anyone on its own; it blocks "ready" so a human looks first.

const { WEIGHTS, CRITERIA, CHECKS } = require('../../shared/verification');

const APPROVED = 1;
const REJECTED = 2;

/** Downloads at which reach/momentum saturate (log scale). */
const REACH_CAP = 100_000;
const MOMENTUM_CAP = 10_000;
const RECENT_DAYS = 90;
/** Neutral votes added to every rating so a 3/3 plugin doesn't beat a 950/1000 one. */
const RATING_PRIOR_VOTES = 10;
const RATING_PRIOR = 0.5;
const PORTFOLIO_CAP = 5;
/** Last release this recent counts as fully maintained; it decays to zero at STALE_DAYS. */
const FRESH_DAYS = 90;
const STALE_DAYS = 365;
const SCAN_LOOKBACK_DAYS = 365;
const SCAN_PENALTY = 15;
const REJECTED_PLUGIN_PENALTY = 3;
const MAX_PENALTY = 40;

/** Most recent downloads one /24 (IPv4) or /64 (IPv6) network can contribute. */
const NETWORK_CAP = 25;
/** Share of recent downloads above the network cap that raises a flag. */
const CONCENTRATION_FLAG = 0.2;
/** A vote from an account this young that never reviewed anyone else is a throwaway. */
const THROWAWAY_HOURS = 48;
const THROWAWAY_FLAG = { share: 0.3, min: 5 };
const DOWNLOAD_SPIKE = { share: 0.4, min: 100 };
const REVIEW_BURST = { share: 0.5, min: 10 };

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const logScale = (value, cap) => clamp01(Math.log10(1 + Math.max(0, value)) / Math.log10(1 + cap));
const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const PRIVATE_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

/**
 * The network an address belongs to, or null when it can't be attributed
 * (private, loopback or missing), so proxies and local dev aren't read as abuse.
 * @param {string} ip
 */
function networkOf(ip) {
  const address = String(ip || '')
    .split(',')[0]
    .trim()
    .replace(/^::ffff:/i, '');
  if (!address || PRIVATE_IP.test(address)) return null;
  if (address.includes(':')) return address.split(':').slice(0, 4).join(':');
  const octets = address.split('.');
  return octets.length === 4 ? octets.slice(0, 3).join('.') : null;
}

/**
 * @param {object} [options]
 * @param {import('better-sqlite3').Database} [options.db]
 * @param {boolean} [options.includeVerified] also list developers who already have the badge
 * @param {string} [options.now] ISO timestamp, for tests
 */
function getVerificationCandidates({ db = require('./db'), includeVerified = false, now = new Date().toISOString() } = {}) {
  const developers = db
    .prepare(
      `SELECT u.id, u.name, u.avatar_url, u.github, u.website, u.x, u.linkedin, u.verified,
         julianday(?) - julianday(u.created_at) AS account_days,
         SUM(p.status = ${APPROVED}) AS approved_plugins,
         SUM(p.status = ${REJECTED}) AS rejected_plugins,
         SUM(CASE WHEN p.status = ${APPROVED} THEN CAST(p.downloads AS INTEGER) ELSE 0 END) AS downloads,
         SUM(CASE WHEN p.status = ${APPROVED} THEN IFNULL(p.votes_up, 0) ELSE 0 END) AS votes_up,
         SUM(CASE WHEN p.status = ${APPROVED} THEN IFNULL(p.votes_down, 0) ELSE 0 END) AS votes_down,
         MIN(CASE WHEN p.status = ${APPROVED} THEN julianday(?) - julianday(COALESCE(p.package_updated_at, p.created_at)) END) AS days_since_release
       FROM user u
       JOIN plugin p ON p.user_id = u.id
       WHERE u.role NOT IN ('admin', 'deleted') ${includeVerified ? '' : 'AND IFNULL(u.verified, 0) = 0'}
       GROUP BY u.id
       HAVING approved_plugins > 0`,
    )
    .all(now, now);
  if (!developers.length) return { candidates: [], criteria: CRITERIA, weights: WEIGHTS };

  const byUser = (rows) => new Map(rows.map((row) => [row.user_id, row]));
  const groupByUser = (rows) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.user_id)) map.set(row.user_id, []);
      map.get(row.user_id).push(row);
    }
    return map;
  };

  const recentByIp = groupByUser(
    db
      .prepare(
        `SELECT p.user_id, d.client_ip, COUNT(*) AS downloads
         FROM download d JOIN plugin p ON p.id = d.plugin_id
         WHERE p.status = ${APPROVED} AND d.created_at >= datetime(?, '-${RECENT_DAYS} days')
         GROUP BY p.user_id, d.client_ip`,
      )
      .all(now),
  );

  const peakDownloadDay = byUser(
    db
      .prepare(
        `SELECT user_id, MAX(downloads) AS downloads FROM (
           SELECT p.user_id, date(d.created_at) AS day, COUNT(*) AS downloads
           FROM download d JOIN plugin p ON p.id = d.plugin_id
           WHERE p.status = ${APPROVED} AND d.created_at >= datetime(?, '-${RECENT_DAYS} days')
           GROUP BY p.user_id, day
         ) GROUP BY user_id`,
      )
      .all(now),
  );

  // Reviews by others on approved plugins. A throwaway voter signed up shortly
  // before reviewing and has never reviewed any other developer's plugin.
  const reviews = byUser(
    db
      .prepare(
        `WITH voter_reach AS (
           SELECT c.user_id, COUNT(DISTINCT p.user_id) AS developers
           FROM comment c JOIN plugin p ON p.id = c.plugin_id
           GROUP BY c.user_id
         ),
         review AS (
           SELECT p.user_id, c.vote, c.created_at,
             (c.comment IS NOT NULL AND c.comment != '') AS has_text,
             (c.author_reply IS NOT NULL AND c.author_reply != '') AS replied,
             (vr.developers = 1 AND (julianday(c.created_at) - julianday(v.created_at)) * 24 < ${THROWAWAY_HOURS}) AS throwaway
           FROM comment c
           JOIN plugin p ON p.id = c.plugin_id
           LEFT JOIN user v ON v.id = c.user_id
           LEFT JOIN voter_reach vr ON vr.user_id = c.user_id
           WHERE p.status = ${APPROVED} AND c.user_id != p.user_id
         )
         SELECT r.user_id,
           SUM(r.has_text) AS reviews,
           SUM(r.has_text AND r.replied) AS replied,
           SUM(r.vote = 1 AND r.throwaway) AS throwaway_up,
           SUM(r.vote = -1 AND r.throwaway) AS throwaway_down,
           (SELECT MAX(n) FROM (SELECT COUNT(*) AS n FROM review r2 WHERE r2.user_id = r.user_id AND r2.has_text GROUP BY date(r2.created_at))) AS peak_day
         FROM review r
         GROUP BY r.user_id`,
      )
      .all(),
  );

  const scans = byUser(
    db
      .prepare(
        `SELECT p.user_id,
           SUM(s.recommendation = 'block') AS blocked,
           SUM(s.status = 'rejected') AS rejected
         FROM plugin_scan s JOIN plugin p ON p.id = s.plugin_id
         WHERE s.created_at >= datetime(?, '-${SCAN_LOOKBACK_DAYS} days')
         GROUP BY p.user_id`,
      )
      .all(now),
  );

  const topPlugins = byUser(
    db
      .prepare(
        `SELECT user_id, id AS plugin_id, name AS plugin_name FROM (
           SELECT user_id, id, name,
             ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY CAST(downloads AS INTEGER) DESC) AS rn
           FROM plugin WHERE status = ${APPROVED}
         ) WHERE rn = 1`,
      )
      .all(),
  );

  const candidates = developers.map((dev) => {
    const downloads = summariseDownloads(recentByIp.get(dev.id) || []);
    const peakDay = peakDownloadDay.get(dev.id)?.downloads || 0;
    const review = reviews.get(dev.id) || {};
    const reviewCount = review.reviews || 0;
    const replied = review.replied || 0;
    const throwawayVotes = (review.throwaway_up || 0) + (review.throwaway_down || 0);
    // Counters on the plugin row include every vote; take the throwaways back out.
    const trustedUp = Math.max(0, dev.votes_up - (review.throwaway_up || 0));
    const trustedDown = Math.max(0, dev.votes_down - (review.throwaway_down || 0));
    const votes = trustedUp + trustedDown;
    const rawVotes = dev.votes_up + dev.votes_down;
    const rating = votes ? trustedUp / votes : null;
    const { blocked = 0, rejected: rejectedScans = 0 } = scans.get(dev.id) || {};
    const daysSinceRelease = dev.days_since_release ?? Number.POSITIVE_INFINITY;
    const socials = [dev.x, dev.linkedin, dev.website].filter(Boolean).length;

    const signals = {
      reach: logScale(dev.downloads, REACH_CAP),
      momentum: logScale(downloads.credible, MOMENTUM_CAP),
      // Bayesian average: few votes stay near neutral until the rating is earned.
      quality: (trustedUp + RATING_PRIOR_VOTES * RATING_PRIOR) / (votes + RATING_PRIOR_VOTES),
      portfolio: clamp01(dev.approved_plugins / PORTFOLIO_CAP),
      maintenance: clamp01(1 - (daysSinceRelease - FRESH_DAYS) / (STALE_DAYS - FRESH_DAYS)),
      // No reviews yet is neither good nor bad.
      engagement: reviewCount ? replied / reviewCount : 0.5,
      profile: (Number(Boolean(dev.github)) + Number(Boolean(dev.avatar_url)) + Math.min(socials, 1)) / 3,
    };

    const breakdown = Object.fromEntries(Object.entries(WEIGHTS).map(([key, weight]) => [key, round(signals[key] * weight)]));

    // Strikes: things that happened. They cost points.
    const flags = [];
    if (blocked) flags.push(`${plural(blocked, 'upload')} blocked by the security scanner in the last year`);
    if (rejectedScans) flags.push(`${plural(rejectedScans, 'update')} rejected in review in the last year`);
    if (dev.rejected_plugins) flags.push(plural(dev.rejected_plugins, 'rejected plugin'));
    const penalty = Math.min(MAX_PENALTY, (blocked + rejectedScans) * SCAN_PENALTY + dev.rejected_plugins * REJECTED_PLUGIN_PENALTY);

    // Suspicions: patterns that may be gaming. Already discounted from the
    // score; they only hold back "ready" so an admin takes a look.
    const suspicions = [];
    const excess = downloads.total - downloads.credible;
    if (downloads.total >= 50 && excess / downloads.total >= CONCENTRATION_FLAG) {
      suspicions.push(
        `${Math.round((excess / downloads.total) * 100)}% of recent downloads came from a few networks (${plural(downloads.topNetworks, 'network')} over the cap)`,
      );
    }
    if (peakDay >= DOWNLOAD_SPIKE.min && peakDay / Math.max(1, downloads.total) >= DOWNLOAD_SPIKE.share) {
      suspicions.push(`${peakDay.toLocaleString('en')} of ${downloads.total.toLocaleString('en')} recent downloads landed on a single day`);
    }
    if (throwawayVotes >= THROWAWAY_FLAG.min && throwawayVotes / Math.max(1, rawVotes) >= THROWAWAY_FLAG.share) {
      suspicions.push(`${throwawayVotes} of ${rawVotes} votes came from brand-new accounts that reviewed nothing else`);
    }
    const peakReviews = review.peak_day || 0;
    if (peakReviews >= REVIEW_BURST.min && peakReviews / Math.max(1, reviewCount) >= REVIEW_BURST.share) {
      suspicions.push(`${peakReviews} of ${reviewCount} reviews were posted on a single day`);
    }

    const total = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
    const score = round(Math.max(0, total - penalty));

    const checks = Object.entries({
      account: dev.account_days >= CRITERIA.minAccountDays,
      downloads: dev.downloads >= CRITERIA.minDownloads,
      rating: votes >= CRITERIA.minVotes && rating >= CRITERIA.minRating,
      active: daysSinceRelease <= CRITERIA.maxDaysSinceRelease,
      github: Boolean(dev.github),
      clean: !blocked && !rejectedScans,
      organic: !suspicions.length,
    }).map(([id, pass]) => ({ id, label: CHECKS[id], pass }));

    return {
      id: dev.id,
      name: dev.name,
      avatarUrl: dev.avatar_url,
      github: dev.github,
      verified: Boolean(dev.verified),
      score,
      penalty,
      breakdown,
      ready: checks.every((check) => check.pass),
      checks,
      flags,
      suspicions,
      topPlugin: topPlugins.get(dev.id) ? { id: topPlugins.get(dev.id).plugin_id, name: topPlugins.get(dev.id).plugin_name } : null,
      stats: {
        plugins: dev.approved_plugins,
        downloads: dev.downloads,
        recentDownloads: downloads.total,
        credibleDownloads: downloads.credible,
        rating: rating === null ? null : round(rating * 100),
        votes,
        discountedVotes: rawVotes - votes,
        reviews: reviewCount,
        replyRate: reviewCount ? round((replied / reviewCount) * 100) : null,
        daysSinceRelease: Number.isFinite(daysSinceRelease) ? Math.floor(daysSinceRelease) : null,
        accountDays: Math.floor(dev.account_days),
      },
    };
  });

  candidates.sort((a, b) => b.score - a.score || b.stats.downloads - a.stats.downloads);
  return { candidates, criteria: CRITERIA, weights: WEIGHTS };
}

/**
 * Totals recent downloads, letting each network count only up to NETWORK_CAP.
 * Downloads from unattributable addresses count in full.
 * @param {{ client_ip: string, downloads: number }[]} rows
 */
function summariseDownloads(rows) {
  const networks = new Map();
  let total = 0;
  let unattributed = 0;
  for (const { client_ip: ip, downloads } of rows) {
    total += downloads;
    const network = networkOf(ip);
    if (network) networks.set(network, (networks.get(network) || 0) + downloads);
    else unattributed += downloads;
  }
  let credible = unattributed;
  let topNetworks = 0;
  for (const count of networks.values()) {
    credible += Math.min(count, NETWORK_CAP);
    if (count > NETWORK_CAP) topNetworks++;
  }
  return { total, credible, topNetworks };
}

module.exports = { getVerificationCandidates, networkOf };
