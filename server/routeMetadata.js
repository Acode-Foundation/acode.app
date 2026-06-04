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

const FALLBACK_TITLE = 'Acode — Code Editor with Linux Terminal & AI Coding';
const FALLBACK_DESC =
  'Acode is an Code Editor with a full Alpine Linux terminal. Run Claude Code, Codex, and OpenCode on your phone. Node.js, React, Next.js, Python, Git, and 250+ plugins. Open source. 3.6M+ downloads.';

/**
 * Explicit route → metadata map.
 * Add entries here only when you want a custom title/description.
 * All other paths are handled dynamically by getMetadata().
 */
const namedRoutes = {
  '/': {
    title: 'Acode — Code Editor with Linux Terminal & AI Coding',
    description: FALLBACK_DESC,
    schema: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Acode',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Android',
      description: FALLBACK_DESC,
      url: 'https://acode.app',
      image: 'https://acode.app/og-image.png',
      author: { '@type': 'Organization', name: 'Foxbiz Software Pvt. Ltd.', url: 'https://acode.app' },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
      aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.1', reviewCount: '13347' },
    },
    orgSchema: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Foxbiz Software Pvt. Ltd.',
      url: 'https://acode.app',
      logo: 'https://acode.app/logo-512.png',
      sameAs: [
        'https://github.com/Acode-Foundation/Acode',
        'https://play.google.com/store/apps/details?id=com.foxdebug.acodefree',
        'https://t.me/foxdebug_acode',
      ],
    },
  },

  '/plugins': {
    title: 'Acode Plugins — {{count}} Community Extensions',
    description:
      'Browse {{count}} community plugins for Acode. Language support, themes, AI assistants, build tools, and more. Extend your Code Editor with JavaScript and TypeScript plugins.',
  },

  '/faqs': {
    title: 'Frequently Asked Questions — Acode Code Editor',
    description:
      '150+ answers about Acode, the Code Editor. Learn about AI coding (Claude Code, Codex, OpenCode), Linux terminal setup, web development (Node.js, React, Next.js, Python), Git, SSH, plugin installation, pricing, comparisons with Termux/VS Code/Cursor, and more.',
    _buildFaqSchema() {
      return buildFaqSchema();
    },
  },

  '/sponsors': {
    title: 'Sponsors — Support Acode Development',
    description:
      'Support the development of Acode — the open-source Code Editor with a Linux terminal and AI coding capabilities. See our sponsors and learn how to become one.',
  },

  '/pro': {
    title: 'Acode Pro — Premium Code Editor Features',
    description: 'Unlock premium features in Acode, the Code Editor with a Linux terminal and AI coding support.',
  },

  '/policy': {
    title: 'Privacy Policy — Acode Code Editor',
    description: 'Read the privacy policy for Acode, the open-source Code Editor.',
  },

  '/terms': {
    title: 'Terms of Service — Acode Code Editor',
    description: 'Read the terms of service for Acode, the open-source Code Editor with Linux terminal and AI coding capabilities.',
  },

  '/refund': {
    title: 'Refund Policy — Acode Code Editor',
    description: 'Read the refund policy for Acode Pro and in-app purchases.',
  },

  '/contact': {
    title: 'Contact Us — Acode Code Editor',
    description: 'Get in touch with the Acode team. Support, feedback, and business inquiries.',
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
 * @returns {{ title: string, description: string, schema?: object, orgSchema?: object, icon?: string, iconAlt?: string } | null}
 */
function getMetadata(pathname) {
  const clean = pathname.replace(/\/$/, '') || '/';

  if (namedRoutes[clean]) {
    const entry = { ...namedRoutes[clean] };
    entry.title = entry.title.replace(/\{\{count\}\}/g, '250+');
    entry.description = (entry.description || '').replace(/\{\{count\}\}/g, '250+');
    if (entry._buildFaqSchema) {
      entry.schema = entry._buildFaqSchema();
      entry._buildFaqSchema = undefined;
    }
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
      description: `${pageName} — Acode is an Code Editor with a full Alpine Linux terminal, AI coding support, and 250+ plugins.`,
    };
  }

  return null;
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
