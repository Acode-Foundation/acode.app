const path = require('node:path');
const createSharp = require('sharp');
const { acodeLogo } = require('../../shared/acodeLogo');
const { RETRY_MS, CACHE_BYTES, markTemporaryImage, isTemporaryImage } = require('./ogImageCachePolicy');
const { pluginRevision } = require('../../shared/ogImage.json');
const { formatMilestoneCount, normalizeMetadataText } = require('../../shared/metadataText');

const WIDTH = 1200;
const HEIGHT = 630;
// The response cache owns long-lived cards; keep only a few render variants here.
const CACHE_LIMIT = 8;
// Palette PNGs keep cards well under the ~300KB that some chat apps accept for link previews;
// the grain dithers away any banding in the gradients.
const OUTPUT = { palette: true, quality: 90, dither: 1 };
const cache = new Map();
const assetWarnings = new Map();
let cacheBytes = 0;
let pluginBackground;
const screenshotPath = path.resolve(__dirname, '../../client/res/acode-shot-panes.jpg');
const FONT = `font-family="Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif"`;

const COLORS = {
  background: '#08090c',
  text: '#f4f5f7',
  muted: '#9aa1ad',
  faint: '#5d6470',
  accent: '#3499fe',
};

// A queue timeout cannot cancel native work; bound each libvips pipeline too.
function sharp(...args) {
  return createSharp(...args).timeout({ seconds: 10 });
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Whole user-visible characters, so emoji and combined marks are never split in half.
function graphemes(value) {
  return Array.from(segmenter.segment(String(value ?? '')), ({ segment }) => segment);
}

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u;

// Wide (CJK, emoji) characters take a full em, capitals and narrow glyphs are weighted,
// and letter-spacing applies per character.
function characterWidth(character, size, tracking = 0) {
  if (WIDE.test(character)) return size + tracking;
  if (character === ' ') return 0.28 * size + tracking;
  if (/[iljI.,:;'|!]/.test(character)) return 0.3 * size + tracking;
  if (/[A-Z0-9MWmw@]/.test(character)) return 0.68 * size + tracking;
  return 0.57 * size + tracking;
}

/** Estimate rendered width without font metrics. */
function estimateWidth(value, size, tracking = 0) {
  let width = 0;
  for (const character of graphemes(value)) width += characterWidth(character, size, tracking);
  return width;
}

// The SVG renderer has no color emoji font and draws them as blank shapes, so they are left out.
function withoutEmoji(value) {
  return normalizeMetadataText(String(value ?? '').replace(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu, ' '));
}

/** Cut text to fit `maxWidth`, preferring a word boundary, and mark the cut with an ellipsis. */
function fitWidth(value, maxWidth, size, tracking = 0) {
  const text = withoutEmoji(value);
  const characters = graphemes(text);
  const widths = characters.map((character) => characterWidth(character, size, tracking));
  let width = widths.reduce((total, item) => total + item, 0);
  if (width <= maxWidth) return text;
  const ellipsis = characterWidth('…', size, tracking);
  let length = characters.length;
  while (length && width + ellipsis > maxWidth) {
    length -= 1;
    width -= widths[length];
  }
  const cut = characters.slice(0, length).join('').trimEnd();
  const space = cut.lastIndexOf(' ');
  return `${(space > cut.length / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function text(content, { x, y, size, color, weight = 400, tracking = 0, anchor = 'start' }) {
  return `<text x="${x}" y="${y}" fill="${color}" ${FONT} font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}" text-anchor="${anchor}">${escapeXml(content)}</text>`;
}

function warnAsset(asset, error) {
  const now = Date.now();
  if (assetWarnings.has(asset) && now - assetWarnings.get(asset) < RETRY_MS) return;
  assetWarnings.delete(asset);
  assetWarnings.set(asset, now);
  while (assetWarnings.size > 64) assetWarnings.delete(assetWarnings.keys().next().value);
  console.warn('OG asset unavailable; using fallback', { asset: path.basename(asset), reason: error.code || error.message });
}

function logoMarkup(x, y, height, opacity = 1) {
  return acodeLogo(x, y, (height * 543) / 409, height, opacity);
}

function svgDocument(content, defs = '') {
  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs>${defs}</defs>${content}</svg>`;
}

/**
 * Near-black canvas lit by soft, blurred beams of Acode blue, finished with a faint grain.
 * `beams` are [x, y, width, height, angle, color, opacity] tuples before blurring.
 */
async function atmosphere(beams) {
  const light = svgDocument(
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${COLORS.background}"/>${beams
      .map(
        ([x, y, width, height, angle, color, opacity]) =>
          `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${width / 2}" fill="${color}" fill-opacity="${opacity}" transform="rotate(${angle} ${x + width / 2} ${y + height / 2})"/>`,
      )
      .join('')}`,
  );
  const grain = svgDocument(
    `<rect width="${WIDTH}" height="${HEIGHT}" filter="url(#grain)" opacity="0.06"/>`,
    '<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>',
  );
  return sharp(await sharp(Buffer.from(light)).blur(70).png().toBuffer())
    .composite([{ input: Buffer.from(grain) }])
    .png()
    .toBuffer();
}

function brandLockup(centerX, y, size) {
  // Approximate wordmark width for a bold sans at this size; the pair is centered as one unit.
  const logoHeight = size * 0.9;
  const logoWidth = (logoHeight * 543) / 409;
  const wordWidth = size * 3.05;
  const gap = size * 0.32;
  const left = centerX - (logoWidth + gap + wordWidth) / 2;
  return `${logoMarkup(left, y, logoHeight)}${text('Acode', {
    x: Math.round(left + logoWidth + gap),
    y: Math.round(y + logoHeight * 0.86),
    size,
    color: COLORS.text,
    weight: 700,
    tracking: -0.5,
  })}`;
}

async function renderDefaultOgImage(pluginCount) {
  const countLabel = formatMilestoneCount(pluginCount);
  const pluginLabel = countLabel === null ? null : `${countLabel} ${pluginCount === 1 ? 'plugin' : 'plugins'}`;
  const subline = ['Open-source code editor for Android and iOS', pluginLabel].filter(Boolean).join('  ·  ');
  return getCached(`default:${subline}`, async () => {
    const background = await atmosphere([
      [700, -260, 180, 900, 38, COLORS.accent, 0.55],
      [930, -200, 120, 900, 38, '#1d4ed8', 0.5],
      [180, -320, 140, 760, -34, '#1e40af', 0.35],
      [420, 420, 520, 200, 0, COLORS.accent, 0.35],
    ]);

    // The product window rises from the bottom edge and melts into the canvas.
    const win = { x: 150, y: 352, width: 900, radius: 18 };
    const shotHeight = HEIGHT - win.y;
    let shot;
    let temporary = false;
    try {
      shot = await sharp(screenshotPath)
        .resize(win.width)
        .extract({ left: 0, top: 0, width: win.width, height: shotHeight })
        .composite([
          {
            input: Buffer.from(
              `<svg width="${win.width}" height="${shotHeight}"><rect width="${win.width}" height="${shotHeight + win.radius}" rx="${win.radius}"/></svg>`,
            ),
            blend: 'dest-in',
          },
        ])
        .png()
        .toBuffer();
    } catch (error) {
      warnAsset(screenshotPath, error);
      temporary = true;
      shot = await sharp(
        Buffer.from(
          `<svg width="${win.width}" height="${shotHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="18" fill="#111827"/>${acodeLogo(380, 60, 140, 105)}<text x="450" y="215" text-anchor="middle" fill="#dce6f2" font-family="sans-serif" font-size="24">Acode</text></svg>`,
        ),
      )
        .png()
        .toBuffer();
    }
    const glow = await sharp(
      Buffer.from(
        svgDocument(
          `<rect x="${win.x}" y="${win.y}" width="${win.width}" height="${shotHeight + 40}" rx="${win.radius}" fill="none" stroke="${COLORS.accent}" stroke-width="10" stroke-opacity="0.7"/>`,
        ),
      ),
    )
      .blur(18)
      .png()
      .toBuffer();
    const overlay = svgDocument(
      `
      <rect x="${win.x + 0.5}" y="${win.y + 0.5}" width="${win.width - 1}" height="${shotHeight + 40}" rx="${win.radius}" fill="none" stroke="#7cc0ff" stroke-opacity="0.7"/>
      <rect x="0" y="${HEIGHT - 190}" width="${WIDTH}" height="190" fill="url(#melt)"/>
      ${brandLockup(WIDTH / 2, 62, 40)}
      <text x="${WIDTH / 2}" y="236" fill="url(#headline)" ${FONT} font-size="100" font-weight="700" letter-spacing="-3.5" text-anchor="middle">Code anywhere.</text>
      ${text(subline, { x: WIDTH / 2, y: 296, size: 28, color: COLORS.muted, anchor: 'middle' })}
    `,
      `<linearGradient id="headline" x1="260" x2="940" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8f96a3"/><stop offset="0.3" stop-color="#ffffff"/><stop offset="0.7" stop-color="#ffffff"/><stop offset="1" stop-color="#8f96a3"/></linearGradient>
       <linearGradient id="melt" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${COLORS.background}" stop-opacity="0"/><stop offset="1" stop-color="${COLORS.background}" stop-opacity="0.96"/></linearGradient>`,
    );

    const image = await sharp(background)
      .composite([{ input: glow }, { input: shot, left: win.x, top: win.y }, { input: Buffer.from(overlay) }])
      .png(OUTPUT)
      .toBuffer();
    return temporary ? markTemporaryImage(image) : image;
  });
}

function initials(name) {
  const letters = normalizeMetadataText(name)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => graphemes(word).find((character) => /[\p{L}\p{N}]/u.test(character)))
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return letters || 'A';
}

/**
 * Small Acode mark for a card's bottom-right corner. The logo keeps a fixed gap before the
 * wordmark, so an off estimate of the word's width shifts the pair, never the spacing inside it.
 */
function footerMark() {
  const size = 26;
  const logoHeight = 27;
  const logoWidth = (logoHeight * 543) / 409;
  const wordLeft = Math.round(WIDTH - 60 - estimateWidth('Acode', size, -0.3) * 1.04);
  return `${logoMarkup(wordLeft - 10 - logoWidth, 548, logoHeight)}${text('Acode', {
    x: wordLeft,
    y: 571,
    size,
    color: COLORS.text,
    weight: 700,
    tracking: -0.3,
  })}`;
}

// Longer names step down through these sizes before they are cut, so they stay on one line.
const TITLE_SIZES = [68, 58, 50, 44];
const TITLE_MAX_WIDTH = WIDTH - 160;
const TITLE_TRACKING = -2;
const TILE = 196;
const TILE_TOP = 112;
const ICON = 140;

const STAT_ICONS = {
  version: '<path d="M20 13 13 20a2 2 0 0 1-3 0l-7-7V3h10l7 7a2 2 0 0 1 0 3Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  downloads: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  rating: '<path d="M7 10v11H3V10h4Zm0 0 4-8a3 3 0 0 1 3 3v4h5a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7"/>',
};

function statWidth(value) {
  return Math.ceil(estimateWidth(value, 24) + 62);
}

function statChip(value, icon, x) {
  const width = statWidth(value);
  return `<g transform="translate(${x} 52)">
    <rect width="${width}" height="48" rx="14" fill="#ffffff" fill-opacity="0.045"/>
    <rect x="0.5" y="0.5" width="${width - 1}" height="47" rx="13.5" fill="none" stroke="#ffffff" stroke-opacity="0.13"/>
    <svg x="14" y="13" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9ccfff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${STAT_ICONS[icon]}</svg>
    ${text(value, { x: 47, y: 32, size: 24, color: '#dce6f2', weight: 500 })}
  </g>`;
}

function createPluginOgSvg({ name, author, version, downloads = 0, rating = null }) {
  const titleSize = TITLE_SIZES.find((size) => estimateWidth(withoutEmoji(name), size, TITLE_TRACKING) <= TITLE_MAX_WIDTH) ?? TITLE_SIZES.at(-1);
  const title = fitWidth(name, TITLE_MAX_WIDTH, titleSize, TITLE_TRACKING);
  // Leave room for the Acode mark on the right of the footer.
  const authorName = fitWidth(author || 'Acode community', 640, 26);
  const tileLeft = (WIDTH - TILE) / 2;
  const total = Number(downloads);
  const downloadLabel = (Number.isSafeInteger(total) && total >= 0 ? total : 0).toLocaleString('en-US');
  const ratingLabel = rating === null ? '—' : `${rating}%`;
  const ratingLeft = WIDTH - 60 - statWidth(ratingLabel);
  return Buffer.from(
    svgDocument(`
      ${statChip(version ? fitWidth(version, 240, 24) : '—', 'version', 60)}
      ${statChip(downloadLabel, 'downloads', ratingLeft - 14 - statWidth(downloadLabel))}
      ${statChip(ratingLabel, 'rating', ratingLeft)}
      <rect x="${tileLeft}" y="${TILE_TOP}" width="${TILE}" height="${TILE}" rx="46" fill="#ffffff" fill-opacity="0.07"/>
      <rect x="${tileLeft + 0.5}" y="${TILE_TOP + 0.5}" width="${TILE - 1}" height="${TILE - 1}" rx="46" fill="none" stroke="#ffffff" stroke-opacity="0.16"/>
      ${text(title, { x: WIDTH / 2, y: 420, size: titleSize, color: COLORS.text, weight: 700, tracking: TITLE_TRACKING, anchor: 'middle' })}
      <path d="M60 520H1140" stroke="#ffffff" stroke-opacity="0.08"/>
      <circle cx="82" cy="562" r="22" fill="${COLORS.accent}" fill-opacity="0.18"/>
      <circle cx="82" cy="562" r="21.5" fill="none" stroke="${COLORS.accent}" stroke-opacity="0.45"/>
      ${text(initials(author || 'Acode'), { x: 82, y: 569, size: 18, color: '#cfe6ff', weight: 700, anchor: 'middle' })}
      ${text(authorName, { x: 118, y: 571, size: 26, color: COLORS.text })}
      ${footerMark()}
    `),
  );
}

async function renderIcon(iconPath, size, radius, fallbackSize = size) {
  if (iconPath) {
    try {
      const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}"/></svg>`);
      const icon = await sharp(iconPath)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
      return { icon, size, temporary: false };
    } catch (error) {
      warnAsset(iconPath, error);
    }
  }
  const icon = await sharp(Buffer.from(acodeLogo(0, 0, fallbackSize, fallbackSize)))
    .png()
    .toBuffer();
  return { icon, size: fallbackSize, temporary: Boolean(iconPath) };
}

async function renderPluginOgImage({ id, name, author, iconPath, version, downloads = 0, rating = null, updatedAt = 'latest' }) {
  const key = JSON.stringify(['plugin', pluginRevision, id, name, author, version, downloads, rating, updatedAt, iconPath || 'fallback']);
  return getCached(key, async () => {
    // Share the promise too, so concurrent cold cards only draw this background once.
    pluginBackground ??= atmosphere([
      [640, -220, 200, 900, 36, COLORS.accent, 0.5],
      [880, -160, 120, 900, 36, '#1d4ed8', 0.45],
      [120, 260, 160, 700, -40, '#1e40af', 0.3],
    ]).catch((error) => {
      pluginBackground = undefined;
      throw error;
    });
    const background = await pluginBackground;
    const { icon, size, temporary } = await renderIcon(iconPath, ICON, 32, 104);

    const image = await sharp(background)
      .composite([
        { input: createPluginOgSvg({ name, author, version, downloads, rating }) },
        { input: icon, left: Math.round((WIDTH - size) / 2), top: Math.round(TILE_TOP + (TILE - size) / 2) },
      ])
      .png(OUTPUT)
      .toBuffer();
    return temporary ? markTemporaryImage(image) : image;
  });
}

const STORE_TILE = 148;
const STORE_GAP = 24;
const STORE_ICON = 92;

// Two staggered rows of icons, centered; the outer tiles fade into the dark like a shelf in shadow.
function storeSlots() {
  const rowWidth = (count) => count * STORE_TILE + (count - 1) * STORE_GAP;
  const rows = [
    { count: 6, top: 334 },
    { count: 5, top: 334 + STORE_TILE + STORE_GAP },
  ];
  return rows.flatMap(({ count, top }) => {
    const left = (WIDTH - rowWidth(count)) / 2;
    return Array.from({ length: count }, (_, index) => ({ x: Math.round(left + index * (STORE_TILE + STORE_GAP)), y: top }));
  });
}

/** Share card for the plugin store: a headline over a shelf of the most popular plugin icons. */
async function renderPluginsOgImage({ iconPaths = [] } = {}) {
  // Evergreen text stays consistent with live page metadata throughout the image TTL.
  const subline = 'Extend Acode with community plugins';
  const icons = iconPaths.filter(Boolean);
  return getCached(`plugins:${subline}:${icons.join('|')}`, async () => {
    const background = await atmosphere([
      [660, -240, 200, 900, 34, COLORS.accent, 0.5],
      [900, -180, 130, 900, 34, '#1d4ed8', 0.45],
      [220, -260, 150, 820, -34, '#1e40af', 0.35],
    ]);
    const slots = storeSlots();
    const tiles = slots
      .map(
        ({ x, y }) =>
          `<rect x="${x}" y="${y}" width="${STORE_TILE}" height="${STORE_TILE}" rx="36" fill="#ffffff" fill-opacity="0.06"/><rect x="${x + 0.5}" y="${y + 0.5}" width="${STORE_TILE - 1}" height="${STORE_TILE - 1}" rx="36" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>`,
      )
      .join('');
    const iconLayers = await Promise.all(
      slots.map(async ({ x, y }, index) => {
        const source = icons.length ? icons[index % icons.length] : null;
        const { icon, size, temporary } = await renderIcon(source, STORE_ICON, 22, 72);
        return { input: icon, left: x + (STORE_TILE - size) / 2, top: y + (STORE_TILE - size) / 2, temporary };
      }),
    );
    const shade = svgDocument(
      `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shelf)"/><rect y="${HEIGHT - 150}" width="${WIDTH}" height="150" fill="url(#floor)"/>
      ${brandLockup(WIDTH / 2, 62, 40)}
      <text x="${WIDTH / 2}" y="228" fill="url(#headline)" ${FONT} font-size="100" font-weight="700" letter-spacing="-3.5" text-anchor="middle">Plugins</text>
      ${text(subline, { x: WIDTH / 2, y: 284, size: 28, color: COLORS.muted, anchor: 'middle' })}`,
      `<linearGradient id="headline" x1="400" x2="800" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8f96a3"/><stop offset="0.35" stop-color="#ffffff"/><stop offset="0.65" stop-color="#ffffff"/><stop offset="1" stop-color="#8f96a3"/></linearGradient>
       <radialGradient id="shelf" cx="600" cy="460" r="560" gradientUnits="userSpaceOnUse"><stop offset="0.45" stop-color="${COLORS.background}" stop-opacity="0"/><stop offset="1" stop-color="${COLORS.background}" stop-opacity="0.94"/></radialGradient>
       <linearGradient id="floor" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${COLORS.background}" stop-opacity="0"/><stop offset="1" stop-color="${COLORS.background}" stop-opacity="0.9"/></linearGradient>`,
    );

    const image = await sharp(background)
      .composite([{ input: Buffer.from(svgDocument(tiles)) }, ...iconLayers.map(place), { input: Buffer.from(shade) }])
      .png(OUTPUT)
      .toBuffer();
    return iconLayers.some(({ temporary }) => temporary) ? markTemporaryImage(image) : image;
  });
}

function place({ input, left, top }) {
  return { input, left: Math.round(left), top: Math.round(top) };
}

function removeCached(key) {
  const entry = cache.get(key);
  if (entry) cacheBytes -= entry.image.length;
  cache.delete(key);
}

async function getCached(key, create) {
  const entry = cache.get(key);
  if (entry) {
    if (!isTemporaryImage(entry.image) || Date.now() - entry.createdAt < RETRY_MS) {
      cache.delete(key);
      cache.set(key, entry);
      return entry.image;
    }
    removeCached(key);
  }

  const image = await create();
  removeCached(key);
  if (image.length <= CACHE_BYTES) {
    cache.set(key, { image, createdAt: Date.now() });
    cacheBytes += image.length;
    while (cache.size > CACHE_LIMIT || cacheBytes > CACHE_BYTES) removeCached(cache.keys().next().value);
  }
  return image;
}

function clearOgImageCache() {
  cache.clear();
  cacheBytes = 0;
  assetWarnings.clear();
  pluginBackground = undefined;
}

module.exports = {
  HEIGHT,
  WIDTH,
  clearOgImageCache,
  createPluginOgSvg,
  escapeXml,
  renderDefaultOgImage,
  renderPluginOgImage,
  renderPluginsOgImage,
};
