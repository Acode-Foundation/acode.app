/**
 * Dynamic route metadata map for SEO.
 *
 * Named routes get explicit titles and descriptions.
 * Unmatched routes fall back to sensible defaults derived from the path,
 * ensuring new front-end routes get reasonable SEO without manual updates.
 *
 * For the plugins page, a separate async fetcher pulls the live count from DB.
 */

const sharedMetadata = require('../shared/routeMetadata.json');
const { formatMilestoneCount } = require('../shared/metadataText');
const { getPublicOrigin, publicUrl } = require('./lib/publicMetadata');

const FALLBACK_TITLE = sharedMetadata.fallback.title;
const FALLBACK_DESC = sharedMetadata.fallback.description;
const PLUGINS_FALLBACK = sharedMetadata.pluginsFallback;

/**
 * Explicit route → metadata map.
 * Add entries here only when you want a custom title/description.
 * All other paths are handled dynamically by getMetadata().
 */
const namedRoutes = sharedMetadata.routes;

/**
 * Build a human-readable title from a URL path segment.
 * e.g. "my-new-page" → "My New Page"
 */
function pathToTitle(segment) {
  return segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get metadata for any path.
 *
 * Checks explicit named routes first.
 * For unmatched paths, derives sensible defaults from the path —
 * so new front-end SPA routes get reasonable SEO automatically.
 *
 * @param {string} pathname — URL path (e.g. '/plugins')
 * @returns {{ title: string, description: string, schema?: object, orgSchema?: object } | null}
 */
function getMetadata(pathname, origin = getPublicOrigin()) {
  const clean = pathname.replace(/\/$/, '') || '/';

  if (clean === '/plugins') return { ...PLUGINS_FALLBACK };

  if (namedRoutes[clean]) {
    const entry = { ...namedRoutes[clean] };
    entry.title = entry.title.replace(/\{\{count\}\}/g, '250+');
    entry.description = (entry.description || '').replace(/\{\{count\}\}/g, '250+');
    if (clean === '/') Object.assign(entry, getHomeSchemas(origin));
    return entry;
  }

  // Landing pages — these have their own server-rendered routes,
  // but this fallback ensures the catch-all can still serve metadata.
  const landingPages = require('../shared/landingPages.json');
  if (landingPages.includes(clean.slice(1))) {
    return null; // landing pages manage their own metadata via JSON
  }

  // Unknown paths: derive title from URL pattern
  const segments = clean.split('/').filter(Boolean);
  if (segments.length > 0) {
    const lastSegment = segments[segments.length - 1];
    const pageName = pathToTitle(lastSegment);
    return {
      title: `${pageName} - Acode`,
      description: `${pageName}. Acode is an extensible code editor for Android and iOS with a Linux terminal and community plugins.`,
    };
  }

  return null;
}

function getHomeSchemas(origin) {
  const publicOrigin = getPublicOrigin(origin);
  return {
    schema: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Acode',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: ['Android', 'iOS', 'iPadOS'],
      description: FALLBACK_DESC,
      url: publicOrigin,
      image: publicUrl('/og/default.png', publicOrigin),
      author: { '@type': 'Organization', name: 'Foxbiz Software Pvt. Ltd.', url: publicOrigin },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
      aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.1', reviewCount: '13347' },
    },
    orgSchema: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Foxbiz Software Pvt. Ltd.',
      url: publicOrigin,
      logo: publicUrl('/logo-512.png', publicOrigin),
      sameAs: [
        'https://github.com/Acode-Foundation/Acode',
        'https://play.google.com/store/apps/details?id=com.foxdebug.acodefree',
        'https://t.me/foxdebug_acode',
      ],
    },
  };
}

/**
 * Fetch live plugin count from the database and return /plugins metadata
 * with the actual number interpolated.
 *
 * @returns {Promise<{ title: string, description: string }>}
 */
async function getPluginsMetadata() {
  const Plugin = require('./entities/plugin');
  try {
    const count = await Plugin.count([Plugin.STATUS, Plugin.STATUS_APPROVED]);
    const countLabel = formatMilestoneCount(count);
    if (countLabel === null) return { ...PLUGINS_FALLBACK };

    const entry = namedRoutes['/plugins'] || {};
    return {
      title: (entry.title || '').replace(/\{\{count\}\}/g, countLabel),
      description: (entry.description || '').replace(/\{\{count\}\}/g, countLabel),
    };
  } catch (_err) {
    return { ...PLUGINS_FALLBACK };
  }
}

module.exports = { getMetadata, getPluginsMetadata, FALLBACK_TITLE, FALLBACK_DESC };
