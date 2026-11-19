const { acodeLogo } = require('../../shared/acodeLogo');

const METRICS = new Set(['downloads', 'rating', 'version', 'updated']);
const METRIC_ICONS = {
  downloads: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  rating: '<path d="M7 10v11H3V10h4Zm0 0 4-8a3 3 0 0 1 3 3v4h5a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7"/>',
};
function count(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function releaseDate(value) {
  if (!value) return null;
  // SQLite timestamps are UTC but have no timezone suffix.
  const text = String(value).trim();
  const naiveUtc = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const zoned = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  if (!naiveUtc && !dateOnly && !zoned) return null;
  const date = new Date(naiveUtc ? `${text.replace(' ', 'T')}Z` : text.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function publicStats(plugin) {
  const votesUp = count(plugin.votes_up);
  const votesDown = count(plugin.votes_down);
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    downloads: count(plugin.downloads),
    votes_up: votesUp,
    votes_down: votesDown,
    rating: votesUp + votesDown ? Math.round((votesUp / (votesUp + votesDown)) * 100) : null,
    updated_at: releaseDate(plugin.package_updated_at) || releaseDate(plugin.created_at),
  };
}

function escapeXml(value) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip characters forbidden in XML 1.0.
  const clean = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
  return clean.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
}

function renderBadge(label, value, color = '#007ec6') {
  // Fixed-width text keeps layout predictable without a font/image dependency.
  const displayLabel = label.charAt(0).toUpperCase() + label.slice(1);
  const message = String(value).slice(0, 80);
  const icon = METRICS.has(label) ? METRIC_ICONS[label] : null;
  const showLabel = !icon && label !== 'version';
  const iconSpace = 20;
  const left = showLabel ? displayLabel.length * 7 + 12 + iconSpace : iconSpace + 6;
  const valueIconSpace = icon ? 20 : 0;
  const right = [...message].length * 7 + 12 + valueIconSpace;
  const width = left + right;
  const title = escapeXml(`Acode ${displayLabel}: ${message}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${title}">
  <title>${title}</title>
  <rect width="${width}" height="20" rx="3" fill="#555"/>
  <path fill="${color}" d="M${left} 0H${width - 3}a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H${left}Z"/>
  ${acodeLogo(5, 3, 16, 14)}
  ${icon ? `<svg x="${left + 6}" y="3" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>` : ''}
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans Mono,monospace" font-size="11">
    ${showLabel ? `<text x="${(left + iconSpace) / 2}" y="14" textLength="${displayLabel.length * 7}" lengthAdjust="spacingAndGlyphs">${escapeXml(displayLabel)}</text>` : ''}
    <text x="${left + (right + valueIconSpace) / 2}" y="14" textLength="${[...message].length * 7}" lengthAdjust="spacingAndGlyphs">${escapeXml(message)}</text>
  </g>
</svg>`;
}

function pluginBadge(stats, metric) {
  switch (metric) {
    case 'downloads':
      return renderBadge('downloads', stats.downloads.toLocaleString('en-US'));
    case 'rating':
      return renderBadge('rating', stats.rating == null ? 'unrated' : `${stats.rating}%`, '#4c7d12');
    case 'version':
      return renderBadge('version', stats.version ? `v${String(stats.version).replace(/^v/i, '')}` : 'unknown');
    case 'updated':
      return renderBadge('updated', stats.updated_at?.slice(0, 10) || 'unknown', '#6b52a3');
    default:
      throw new Error('Unknown badge metric');
  }
}

module.exports = { METRICS, publicStats, renderBadge, pluginBadge };
