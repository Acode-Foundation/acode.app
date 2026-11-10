// Public rules for the verified developer badge. The server scores with these,
// the admin tab labels with them, and the FAQ explains them to developers, so
// all three stay in step. Anti-abuse heuristics live only on the server.

/** Points per signal; they add up to 100. */
const WEIGHTS = {
  reach: 25,
  momentum: 15,
  quality: 25,
  portfolio: 10,
  maintenance: 10,
  engagement: 10,
  profile: 5,
};

const SIGNALS = {
  reach: { label: 'Reach', hint: 'Lifetime downloads of your approved plugins, on a log scale (full points at 100k).' },
  momentum: { label: 'Momentum', hint: 'Downloads from real, distinct users in the last 90 days (full points at 10k).' },
  quality: { label: 'Quality', hint: 'Share of positive reviews. A few votes count less than many, so ratings have to be earned.' },
  portfolio: { label: 'Portfolio', hint: 'Number of approved plugins (full points at 5).' },
  maintenance: { label: 'Maintenance', hint: 'Full points for a release in the last 90 days, fading to zero after a year.' },
  engagement: { label: 'Support', hint: 'Share of user reviews you have replied to.' },
  profile: { label: 'Profile', hint: 'GitHub linked, a profile picture, and a website, X or LinkedIn link.' },
};

/** Hard bars for the badge: the score ranks developers, these decide who is eligible. */
const CRITERIA = {
  minAccountDays: 90,
  minDownloads: 1_000,
  minRating: 0.8,
  minVotes: 5,
  maxDaysSinceRelease: 180,
};

const CHECKS = {
  account: `Account at least ${CRITERIA.minAccountDays} days old`,
  downloads: `At least ${CRITERIA.minDownloads.toLocaleString('en')} downloads`,
  rating: `Rating of ${CRITERIA.minRating * 100}% or more over at least ${CRITERIA.minVotes} votes`,
  active: `A release in the last ${CRITERIA.maxDaysSinceRelease} days`,
  github: 'GitHub linked on your profile',
  clean: 'No blocked or rejected uploads in the last year',
  organic: 'No signs of inflated downloads or reviews',
};

module.exports = { WEIGHTS, SIGNALS, CRITERIA, CHECKS };
