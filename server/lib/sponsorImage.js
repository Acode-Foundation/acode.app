const crypto = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const SPONSOR_IMAGES_DIR = path.resolve(__dirname, '../../data/sponsors');
// The website and the app both cap logos at about 500KB.
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_INPUT_PIXELS = 25_000_000;
/** Formats stored as uploaded, keyed by sharp's format name. */
const KEPT_FORMATS = { png: 'png', jpeg: 'jpg', webp: 'webp' };
/**
 * Extensions the image route serves: what uploads are stored as, plus raster
 * types saved before uploads were checked. Never SVG or HTML, which can run script.
 */
const SPONSOR_IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;

/**
 * Turn an uploaded data URL into a stored sponsor logo. PNG, JPEG and WebP are
 * kept as they are; any other image sharp can decode (GIF, SVG, …) is stored as
 * PNG. Anything that isn't an image is rejected.
 * @param {string} dataUrl `data:<type>;base64,<data>`
 * @param {string} [dir]
 * @returns {Promise<string | null>} the stored file name, or null if there is no usable image
 */
async function saveSponsorImage(dataUrl, dir = SPONSOR_IMAGES_DIR) {
  const image = await decodeSponsorImage(dataUrl);
  if (!image) return null;

  const filename = `${crypto.randomUUID()}.${image.extension}`;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), image.buffer);
  return filename;
}

/**
 * @param {string} dataUrl
 * @returns {Promise<{ buffer: Buffer, extension: string } | null>}
 */
async function decodeSponsorImage(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:[\w.+-]+\/[\w.+-]+(?:;[\w.+=-]+)*;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl.trim());
  if (!match) return null;

  const input = Buffer.from(match[1], 'base64');
  if (!input.length || input.length > MAX_IMAGE_BYTES) return null;

  try {
    const { format } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    const extension = KEPT_FORMATS[format];
    if (extension) {
      // metadata() reads only the header; decode every pixel so a truncated file isn't kept.
      await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).stats();
      return { buffer: input, extension };
    }
    return { buffer: await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).png().toBuffer(), extension: 'png' };
  } catch {
    return null;
  }
}

module.exports = { SPONSOR_IMAGES_DIR, SPONSOR_IMAGE_EXTENSION, decodeSponsorImage, saveSponsorImage };
