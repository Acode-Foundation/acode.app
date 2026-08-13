const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { pluginRevision } = require('../../shared/ogImage.json');

const WIDTH = 1200;
const HEIGHT = 630;
const CACHE_LIMIT = 100;
const cache = new Map();
const logoPath = path.resolve(__dirname, '../../client/res/logo.svg');

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(value, maxLength) {
  const text = String(value ?? '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function wrapText(value, maxCharacters, maxLines) {
  let remaining = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  const lines = [];

  while (remaining && lines.length < maxLines) {
    if (remaining.length <= maxCharacters) {
      lines.push(remaining);
      remaining = '';
      break;
    }

    const space = remaining.lastIndexOf(' ', maxCharacters);
    const splitAt = space > 0 ? space : maxCharacters;
    lines.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining && lines.length) {
    const lastLine = lines.at(-1);
    lines[lines.length - 1] = `${lastLine.slice(0, maxCharacters - 1).trimEnd()}…`;
  }
  return lines;
}

function textLines(lines, x, y, lineHeight) {
  return lines.map((line, index) => `<tspan x="${x}" y="${y + index * lineHeight}">${escapeXml(line)}</tspan>`).join('');
}

function baseSvg(content) {
  return Buffer.from(`
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#101421"/>
          <stop offset="0.55" stop-color="#171c2c"/>
          <stop offset="1" stop-color="#0b2840"/>
        </linearGradient>
        <radialGradient id="glow" cx="0.82" cy="0.2" r="0.75">
          <stop offset="0" stop-color="#3399ff" stop-opacity="0.38"/>
          <stop offset="1" stop-color="#3399ff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#background)"/>
      <rect width="1200" height="630" fill="url(#glow)"/>
      <path d="M0 518 C250 435 405 610 688 512 C905 438 1025 440 1200 482 L1200 630 L0 630 Z" fill="#3399ff" opacity="0.08"/>
      <g opacity="0.08" stroke="#ffffff">
        <path d="M720 0 V630 M800 0 V630 M880 0 V630 M960 0 V630 M1040 0 V630 M1120 0 V630"/>
        <path d="M680 80 H1200 M680 160 H1200 M680 240 H1200 M680 320 H1200 M680 400 H1200 M680 480 H1200"/>
      </g>
      ${content}
    </svg>
  `);
}

async function logoBuffer(size) {
  return sharp(logoPath).resize(size, size, { fit: 'contain' }).png().toBuffer();
}

async function renderDefaultOgImage() {
  return getCached('default', async () => {
    const svg = baseSvg(`
      <text x="86" y="180" fill="#ffffff" font-family="Arial, sans-serif" font-size="76" font-weight="700">Code anywhere.</text>
      <text x="86" y="266" fill="#66b3ff" font-family="Arial, sans-serif" font-size="76" font-weight="700">Build anything.</text>
      <text x="86" y="352" fill="#b8c2d8" font-family="Arial, sans-serif" font-size="29">Android code editor with Linux terminal and AI coding.</text>
      <g transform="translate(86 420)">
        <rect width="410" height="72" rx="36" fill="#3399ff"/>
        <text x="205" y="46" text-anchor="middle" fill="#07111f" font-family="Arial, sans-serif" font-size="27" font-weight="700">Open source · 250+ plugins</text>
      </g>
      <text x="1020" y="550" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-size="34" font-weight="700">Acode</text>
      <text x="1020" y="585" text-anchor="end" fill="#a8b3c7" font-family="Arial, sans-serif" font-size="22">acode.app</text>
    `);
    const logo = await logoBuffer(128);
    return sharp(svg)
      .composite([{ input: logo, left: 930, top: 90 }])
      .png()
      .toBuffer();
  });
}

function createPluginOgSvg({ name, author }) {
  const nameLines = wrapText(name, 20, 2);
  const authorText = truncate(author || 'Acode community', 44);
  return baseSvg(`
    <rect x="70" y="170" width="226" height="226" rx="42" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.12"/>
    <text x="350" y="125" fill="#66b3ff" font-family="Arial, sans-serif" font-size="27" font-weight="700" letter-spacing="3">ACODE PLUGIN</text>
    <text fill="#ffffff" font-family="Arial, sans-serif" font-size="62" font-weight="700">${textLines(nameLines, 350, 220, 75)}</text>
    <text x="350" y="395" fill="#a8b3c7" font-family="Arial, sans-serif" font-size="29">by ${escapeXml(authorText)}</text>
    <g transform="translate(350 448)">
      <rect width="336" height="64" rx="32" fill="#66b3ff"/>
      <text x="168" y="42" text-anchor="middle" fill="#07111f" font-family="Arial, sans-serif" font-size="25" font-weight="700">Explore on acode.app</text>
    </g>
    <text x="1090" y="555" text-anchor="end" fill="#ffffff" font-family="Arial, sans-serif" font-size="34" font-weight="700">Acode</text>
    <text x="1090" y="590" text-anchor="end" fill="#a8b3c7" font-family="Arial, sans-serif" font-size="22">Code anywhere. Build anything.</text>
  `);
}

async function renderPluginOgImage({ id, name, author, iconPath, version = 'latest' }) {
  const key = `plugin:${pluginRevision}:${id}:${name}:${author}:${version}:${iconPath || 'fallback'}`;
  return getCached(key, async () => {
    const svg = createPluginOgSvg({ name, author });

    const resolvedIcon = iconPath && fs.existsSync(iconPath) ? iconPath : logoPath;
    const icon = await sharp(resolvedIcon)
      .resize(174, 174, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return sharp(svg)
      .composite([{ input: icon, left: 96, top: 196 }])
      .png()
      .toBuffer();
  });
}

async function getCached(key, create) {
  if (cache.has(key)) {
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  const value = await create();
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  return value;
}

function clearOgImageCache() {
  cache.clear();
}

module.exports = {
  HEIGHT,
  WIDTH,
  clearOgImageCache,
  createPluginOgSvg,
  escapeXml,
  renderDefaultOgImage,
  renderPluginOgImage,
  wrapText,
};
