import metadataText from '../../shared/metadataText';
import ogImageConfig from '../../shared/ogImage.json';
import metadataConfig from '../../shared/routeMetadata.json';

const { createPluginMetadataDescription, createProfileMetadata, formatMilestoneCount } = metadataText;

const DEFAULT_IMAGE_PATH = '/og/default.png';
const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 630;
const SITE_NAME = 'Acode';
const TWITTER_SITE = '@foxbiz_io';
const PLUGINS_PATH = '/plugins';

let latestRouteMetadataRequest = 0;
let pluginCountRequest;

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return `/${pathname.replace(/^\/+|\/+$/g, '')}`;
}

function absoluteUrl(pathname, origin) {
  return new URL(pathname, origin).href;
}

function pathToTitle(segment) {
  return segment.replace(/-/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function resolveNamedRoute(pathname) {
  if (metadataConfig.routes[pathname]) return metadataConfig.routes[pathname];
  if (pathname.startsWith('/faqs/')) return metadataConfig.routes['/faqs'];
  return null;
}

function getPluginCount() {
  if (!pluginCountRequest) {
    pluginCountRequest = fetch('/api/plugins/count')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load plugin count.');

        const { count } = await response.json();
        if (formatMilestoneCount(count) === null) throw new Error('Invalid plugin count.');
        return count;
      })
      .finally(() => {
        pluginCountRequest = null;
      });
  }

  return pluginCountRequest;
}

/**
 * Resolve browser metadata without changing route behavior.
 * @param {string} pathname
 * @param {string} [origin]
 * @param {number} [pluginCount]
 */
export function resolveRouteMetadata(pathname, origin = window.location.origin, pluginCount) {
  const path = normalizePath(pathname);
  const pluginMatch = /^\/plugin\/([^/]+)/i.exec(path);
  const namedRoute = resolveNamedRoute(path);

  let title;
  let description;
  let canonicalPath = path;

  const pluginCountLabel = formatMilestoneCount(pluginCount);
  if (path === PLUGINS_PATH && pluginCountLabel === null) {
    ({ title, description } = metadataConfig.pluginsFallback);
  } else if (namedRoute) {
    const count = path === PLUGINS_PATH ? pluginCountLabel : '250+';
    title = namedRoute.title.replace(/\{\{count\}\}/g, count);
    description = namedRoute.description.replace(/\{\{count\}\}/g, count);
  } else if (pluginMatch) {
    title = 'Acode Plugin — Acode';
    description = 'Explore this plugin for Acode, the extensible Android code editor.';
    canonicalPath = `/plugin/${pluginMatch[1]}`;
  } else {
    const lastSegment = path.split('/').filter(Boolean).at(-1);
    const pageName = lastSegment ? pathToTitle(lastSegment) : 'Acode';
    title = lastSegment ? `${pageName} — Acode` : metadataConfig.fallback.title;
    description = lastSegment ? `${pageName} on Acode, the extensible Android code editor.` : metadataConfig.fallback.description;
  }

  return {
    title,
    description,
    canonicalUrl: absoluteUrl(canonicalPath, origin),
    imageUrl: absoluteUrl(DEFAULT_IMAGE_PATH, origin),
    imageWidth: IMAGE_WIDTH,
    imageHeight: IMAGE_HEIGHT,
    imageType: 'image/png',
    imageAlt: 'Acode — code, build, and run projects on Android',
    siteName: SITE_NAME,
    type: 'website',
  };
}

/**
 * Build metadata for a loaded plugin while keeping section URLs canonicalized
 * to the main plugin page.
 * @param {object} plugin
 * @param {string} [origin]
 */
export function resolvePluginMetadata(plugin, origin = window.location.origin) {
  const id = String(plugin.id);
  const version = encodeURIComponent(plugin.package_updated_at || plugin.updated_at || plugin.version || 'latest');
  const description = createPluginMetadataDescription(plugin.description, `${plugin.name} is a plugin for Acode.`);

  return {
    title: `${plugin.name} — Acode Plugin`,
    description,
    canonicalUrl: absoluteUrl(`/plugin/${encodeURIComponent(id)}`, origin),
    imageUrl: absoluteUrl(`/og/plugin/${encodeURIComponent(id)}.png?v=${version}&r=${ogImageConfig.pluginRevision}`, origin),
    imageWidth: IMAGE_WIDTH,
    imageHeight: IMAGE_HEIGHT,
    imageType: 'image/png',
    imageAlt: `${plugin.name} plugin for Acode`,
    siteName: SITE_NAME,
    type: 'website',
  };
}

/**
 * Build metadata for a loaded user profile.
 * @param {object} user
 * @param {string} [origin]
 */
export function resolveProfileMetadata(user, origin = window.location.origin) {
  const { title, description } = createProfileMetadata(user);
  const id = encodeURIComponent(String(user.id));

  return {
    title,
    description,
    canonicalUrl: absoluteUrl(`/profile/${id}`, origin),
    imageUrl: absoluteUrl(DEFAULT_IMAGE_PATH, origin),
    imageWidth: IMAGE_WIDTH,
    imageHeight: IMAGE_HEIGHT,
    imageType: 'image/png',
    imageAlt: title,
    siteName: SITE_NAME,
    type: 'website',
  };
}

function ensureMeta(documentRef, attribute, key) {
  let element = documentRef.querySelector(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = documentRef.createElement('meta');
    element.setAttribute(attribute, key);
    documentRef.head.append(element);
  }
  return element;
}

function setMeta(documentRef, attribute, key, content) {
  ensureMeta(documentRef, attribute, key).setAttribute('content', String(content));
}

function setCanonical(documentRef, href) {
  let canonical = documentRef.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = documentRef.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    documentRef.head.append(canonical);
  }
  canonical.setAttribute('href', href);
}

/**
 * Apply presentation metadata to the current document.
 * @param {ReturnType<typeof resolveRouteMetadata>} metadata
 * @param {Document} [documentRef]
 */
export function applyPageMetadata(metadata, documentRef = document) {
  documentRef.title = metadata.title;
  setCanonical(documentRef, metadata.canonicalUrl);

  setMeta(documentRef, 'name', 'description', metadata.description);
  setMeta(documentRef, 'property', 'og:title', metadata.title);
  setMeta(documentRef, 'property', 'og:description', metadata.description);
  setMeta(documentRef, 'property', 'og:url', metadata.canonicalUrl);
  setMeta(documentRef, 'property', 'og:type', metadata.type);
  setMeta(documentRef, 'property', 'og:site_name', metadata.siteName);
  setMeta(documentRef, 'property', 'og:image', metadata.imageUrl);
  setMeta(documentRef, 'property', 'og:image:secure_url', metadata.imageUrl);
  setMeta(documentRef, 'property', 'og:image:type', metadata.imageType);
  setMeta(documentRef, 'property', 'og:image:width', metadata.imageWidth);
  setMeta(documentRef, 'property', 'og:image:height', metadata.imageHeight);
  setMeta(documentRef, 'property', 'og:image:alt', metadata.imageAlt);

  setMeta(documentRef, 'name', 'twitter:card', 'summary_large_image');
  setMeta(documentRef, 'name', 'twitter:site', TWITTER_SITE);
  setMeta(documentRef, 'name', 'twitter:title', metadata.title);
  setMeta(documentRef, 'name', 'twitter:description', metadata.description);
  setMeta(documentRef, 'name', 'twitter:image', metadata.imageUrl);
  setMeta(documentRef, 'name', 'twitter:image:alt', metadata.imageAlt);
}

export async function applyRouteMetadata(pathname = window.location.pathname) {
  const path = normalizePath(pathname);
  const requestId = ++latestRouteMetadataRequest;

  if (path !== PLUGINS_PATH) {
    applyPageMetadata(resolveRouteMetadata(path));
    return;
  }

  let pluginCount;
  try {
    pluginCount = await getPluginCount();
  } catch (_error) {
    // The route resolver supplies accurate count-free fallback metadata.
  }

  if (requestId !== latestRouteMetadataRequest || normalizePath(window.location.pathname) !== path) return;
  applyPageMetadata(resolveRouteMetadata(path, window.location.origin, pluginCount));
}

export function applyPluginMetadata(plugin) {
  applyPageMetadata(resolvePluginMetadata(plugin));
}

export function applyProfileMetadata(user, expectedPathname = window.location.pathname) {
  if (normalizePath(window.location.pathname) !== normalizePath(expectedPathname)) return false;
  applyPageMetadata(resolveProfileMetadata(user));
  return true;
}
