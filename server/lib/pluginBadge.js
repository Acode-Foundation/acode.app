const METRICS = new Set(['downloads', 'rating', 'version', 'updated']);

function count(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function releaseDate(value) {
  if (!value) return null;
  // SQLite timestamps are UTC but have no timezone suffix.
  const text = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text);
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
    updated_at: releaseDate(plugin.package_updated_at || plugin.created_at),
  };
}

function escapeXml(value) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip characters forbidden in XML 1.0.
  const clean = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
  return clean.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
}

function renderBadge(label, value, color = '#007ec6') {
  // Fixed-width text keeps layout predictable without a font/image dependency.
  const message = String(value).slice(0, 80);
  const left = label.length * 7 + 12;
  const right = [...message].length * 7 + 12;
  const width = left + right;
  const title = escapeXml(`${label}: ${message}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${title}">
  <title>${title}</title>
  <clipPath id="r"><rect width="${width}" height="20" rx="3"/></clipPath>
  <g clip-path="url(#r)"><path fill="#555" d="M0 0h${left}v20H0z"/><path fill="${color}" d="M${left} 0h${right}v20H${left}z"/></g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans Mono,monospace" font-size="11">
    <text x="${left / 2}" y="14">${escapeXml(label)}</text>
    <text x="${left + right / 2}" y="14">${escapeXml(message)}</text>
  </g>
</svg>`;
}

function pluginBadge(stats, metric) {
  switch (metric) {
    case 'downloads':
      return renderBadge('downloads', stats.downloads.toLocaleString('en-US'));
    case 'rating':
      return renderBadge('rating', stats.rating === null ? 'unrated' : `${stats.rating}%`, '#4c7d12');
    case 'version':
      return renderBadge('version', stats.version || 'unknown');
    case 'updated':
      return renderBadge('updated', stats.updated_at?.slice(0, 10) || 'unknown', '#6b52a3');
    default:
      throw new Error('Unknown badge metric');
  }
}

module.exports = { METRICS, publicStats, renderBadge, pluginBadge };
