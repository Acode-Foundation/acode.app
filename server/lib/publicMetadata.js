const { PLUGIN_DESCRIPTION_MAX_LENGTH, createPluginMetadataDescription } = require('../../shared/metadataText');

const DEFAULT_PUBLIC_ORIGIN = 'https://acode.app';
const DEFAULT_IMAGE_PATH = '/og/default.png';

function getPublicOrigin(host = process.env.HOST) {
  try {
    const url = new URL(host || DEFAULT_PUBLIC_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return DEFAULT_PUBLIC_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_PUBLIC_ORIGIN;
  }
}

function publicUrl(pathname, origin = getPublicOrigin()) {
  return new URL(pathname, `${getPublicOrigin(origin)}/`).href;
}

function createMetadataContext(metadata, { canonicalPath, imagePath, origin = getPublicOrigin() }) {
  const publicOrigin = getPublicOrigin(origin);
  return {
    ...metadata,
    canonical_url: publicUrl(canonicalPath, publicOrigin),
    image_url: publicUrl(imagePath || metadata.image_path || DEFAULT_IMAGE_PATH, publicOrigin),
  };
}

function createPluginDescription(markdown, fallback) {
  return createPluginMetadataDescription(markdown, fallback);
}

function localizeStructuredData(schema, origin = getPublicOrigin()) {
  if (!schema) return null;
  const publicOrigin = getPublicOrigin(origin);
  const value = typeof schema === 'string' ? JSON.parse(schema) : schema;
  return JSON.stringify(rewriteUrls(value, publicOrigin));
}

function rewriteUrls(value, publicOrigin) {
  if (Array.isArray(value)) return value.map((item) => rewriteUrls(item, publicOrigin));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteUrls(item, publicOrigin)]));
  }
  if (typeof value === 'string' && value.startsWith(DEFAULT_PUBLIC_ORIGIN)) {
    return `${publicOrigin}${value.slice(DEFAULT_PUBLIC_ORIGIN.length)}`;
  }
  return value;
}

module.exports = {
  DEFAULT_PUBLIC_ORIGIN,
  MAX_PLUGIN_DESCRIPTION_LENGTH: PLUGIN_DESCRIPTION_MAX_LENGTH,
  createMetadataContext,
  createPluginDescription,
  getPublicOrigin,
  localizeStructuredData,
  publicUrl,
};
