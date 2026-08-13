import metadataText from '../../shared/metadataText';
import ogImageConfig from '../../shared/ogImage.json';
import metadataConfig from '../../shared/routeMetadata.json';

const { createPluginMetadataDescription } = metadataText;

const DEFAULT_IMAGE_PATH = '/og/default.png';
const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 630;
const SITE_NAME = 'Acode';
const TWITTER_SITE = '@foxbiz_io';

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

/**
 * Resolve browser metadata without changing route behavior.
 * @param {string} pathname
 * @param {string} [origin]
 */
export function resolveRouteMetadata(pathname, origin = window.location.origin) {
  const path = normalizePath(pathname);
  const pluginMatch = /^\/plugin\/([^/]+)/i.exec(path);
  const namedRoute = resolveNamedRoute(path);

  let title;
  let description;
  let canonicalPath = path;

  if (namedRoute) {
    title = namedRoute.title.replace(/\{\{count\}\}/g, '250+');
    description = namedRoute.description.replace(/\{\{count\}\}/g, '250+');
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

export function applyRouteMetadata(pathname = window.location.pathname) {
  applyPageMetadata(resolveRouteMetadata(pathname));
}

export function applyPluginMetadata(plugin) {
  applyPageMetadata(resolvePluginMetadata(plugin));
}
