const PLUGIN_DESCRIPTION_MAX_LENGTH = 120;

/**
 * Convert the small Markdown subset used in plugin descriptions into compact,
 * browser-safe metadata text. This intentionally has no Node-only dependencies
 * so SSR and SPA navigation can share the exact same implementation.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeMetadataText(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)]/gi, ' ')
    .replace(/!\[([^\]]*)]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_~`#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bound metadata text without leaving a partial final word when a suitable
 * boundary exists. The ellipsis is included in the requested maximum length.
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string}
 */
function truncateMetadataText(value, maxLength = PLUGIN_DESCRIPTION_MAX_LENGTH) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;

  const candidate = text.slice(0, maxLength - 1);
  const lastSpace = candidate.lastIndexOf(' ');
  const boundary = lastSpace > maxLength / 2 ? lastSpace : candidate.length;
  return `${candidate.slice(0, boundary).trimEnd()}…`;
}

function createPluginMetadataDescription(markdown, fallback = 'Explore this plugin for Acode.') {
  const normalizedDescription = normalizeMetadataText(markdown);
  const normalizedFallback = normalizeMetadataText(fallback);
  return truncateMetadataText(normalizedDescription || normalizedFallback);
}

module.exports = {
  PLUGIN_DESCRIPTION_MAX_LENGTH,
  createPluginMetadataDescription,
  normalizeMetadataText,
  truncateMetadataText,
};
