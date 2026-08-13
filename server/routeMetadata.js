/**
 * Dynamic route metadata map for SEO.
 *
 * Named routes get explicit titles and descriptions.
 * Unmatched routes fall back to sensible defaults derived from the path,
 * ensuring new front-end routes get reasonable SEO without manual updates.
 *
 * For the plugins page, a separate async fetcher pulls the live count from DB.
 */

const fs = require('node:fs');
const path = require('node:path');
const sharedMetadata = require('../shared/routeMetadata.json');
const { getPublicOrigin, publicUrl } = require('./lib/publicMetadata');

const FALLBACK_TITLE = sharedMetadata.fallback.title;
const FALLBACK_DESC = sharedMetadata.fallback.description;

/**
 * Explicit route → metadata map.
 * Add entries here only when you want a custom title/description.
 * All other paths are handled dynamically by getMetadata().
 */
const namedRoutes = {
  ...sharedMetadata.routes,
  '/': sharedMetadata.routes['/'],

  '/faqs': {
    ...sharedMetadata.routes['/faqs'],
    _buildFaqSchema() {
      return buildFaqSchema();
    },
  },
};

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

  if (namedRoutes[clean]) {
    const entry = { ...namedRoutes[clean] };
    entry.title = entry.title.replace(/\{\{count\}\}/g, '250+');
    entry.description = (entry.description || '').replace(/\{\{count\}\}/g, '250+');
    if (entry._buildFaqSchema) {
      entry.schema = entry._buildFaqSchema();
      entry._buildFaqSchema = undefined;
    }
    if (clean === '/') Object.assign(entry, getHomeSchemas(origin));
    return entry;
  }

  // Landing pages — these have their own server-rendered routes,
  // but this fallback ensures the catch-all can still serve metadata.
  const landingPages = new Set([
    '/claude-code-android',
    '/codex-android',
    '/opencode-android',
    '/ai-coding-android',
    '/termux-alternative',
    '/android-ide',
    '/linux-terminal-android',
    '/nodejs-android',
    '/npm-android',
    '/react-android',
    '/nextjs-android',
    '/git-android',
    '/ssh-android',
    '/vscode-alternative-android',
    '/cursor-alternative-android',
    '/windsurf-alternative-android',
    '/spck-alternative',
    '/web-development-android',
  ]);
  if (landingPages.has(clean)) {
    return null; // landing pages manage their own metadata via JSON
  }

  // Unknown paths: derive title from URL pattern
  const segments = clean.split('/').filter(Boolean);
  if (segments.length > 0) {
    const lastSegment = segments[segments.length - 1];
    const pageName = pathToTitle(lastSegment);
    return {
      title: `${pageName} — Acode`,
      description: `${pageName} — Acode is a code editor with a full Alpine Linux terminal, AI coding support, and 250+ plugins.`,
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
      operatingSystem: 'Android',
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
    const count = await Plugin.for('internal').count();
    const entry = namedRoutes['/plugins'] || {};
    return {
      title: (entry.title || '').replace(/\{\{count\}\}/g, String(count)),
      description: (entry.description || '').replace(/\{\{count\}\}/g, String(count)),
    };
  } catch (_err) {
    const entry = namedRoutes['/plugins'] || {};
    return {
      title: (entry.title || '').replace(/\{\{count\}\}/g, '250+'),
      description: (entry.description || '').replace(/\{\{count\}\}/g, '250+'),
    };
  }
}

/**
 * Read data/faqs.json and build a schema.org FAQPage mainEntity array.
 * Handles both legacy flat array format and the v2 categorized format.
 * Each entry becomes { '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }.
 * Falls back to null if the file is missing or unparseable.
 */
function buildFaqSchema() {
  try {
    const faqPath = path.resolve(__dirname, '..', 'data', 'faqs.json');
    const raw = fs.readFileSync(faqPath, 'utf8');
    const data = JSON.parse(raw);
    const faqs = Array.isArray(data) ? data : (data.categories || []).flatMap((c) => c.faqs || []);
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: a
            .replace(/```[\s\S]*?```/g, '') // strip code blocks
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text
            .replace(/[*_~`#]/g, '') // strip markdown formatting
            .replace(/\n+/g, ' ')
            .trim(),
        },
      })),
    };
  } catch (_err) {
    return null;
  }
}

/**
 * Build metadata for the /faqs page with live FAQ data.
 * @returns {{ title: string, description: string, schema: object | null }}
 */
function getFaqsMetadata() {
  const entry = namedRoutes['/faqs'] || {};
  return {
    title: entry.title,
    description: entry.description,
    schema: buildFaqSchema(),
  };
}

module.exports = { getMetadata, getPluginsMetadata, getFaqsMetadata, FALLBACK_TITLE, FALLBACK_DESC };
