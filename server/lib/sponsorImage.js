const crypto = require('node:crypto');
const fs = require('node:fs');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { fileInDir } = require('./pluginScanner');

const SPONSOR_IMAGES_DIR = path.resolve(__dirname, '../../data/sponsors');
// The website and the app both cap logos at about 500KB.
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_INPUT_PIXELS = 25_000_000;
/** Formats stored as uploaded, keyed by sharp's format name. */
const KEPT_FORMATS = { png: 'png', jpeg: 'jpg', webp: 'webp' };
/**
 * Extensions the image route serves, with the type it serves them as. Uploads
 * are now stored as png, jpg or webp; the rest are raster types that earlier
 * uploads were saved as (the extension was the upload's MIME subtype). Never SVG
 * or HTML, which can run script.
 */
const SERVED_TYPES = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pjpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  'x-ms-bmp': 'image/bmp',
  ico: 'image/x-icon',
  'x-icon': 'image/x-icon',
  'vnd.microsoft.icon': 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
};
// Longest first, so `.vnd.microsoft.icon` isn't read as an unknown `.icon`.
const SERVED_EXTENSIONS = Object.keys(SERVED_TYPES).sort((a, b) => b.length - a.length);
const IMAGE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  // Opening a logo directly must never run anything, whatever its bytes are.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};

/**
 * The content type the image route serves `filename` as, or null if it doesn't serve it.
 * @param {string} filename
 * @returns {string | null}
 */
function sponsorImageType(filename) {
  if (typeof filename !== 'string') return null;
  const name = filename.toLowerCase();
  const extension = SERVED_EXTENSIONS.find((ext) => name.endsWith(`.${ext}`) && name.length > ext.length + 1);
  return extension ? SERVED_TYPES[extension] : null;
}

/**
 * Route handler for `/sponsor/image/:filename`.
 * @param {string} [dir]
 * @returns {import('express').RequestHandler}
 */
function sendSponsorImage(dir = SPONSOR_IMAGES_DIR) {
  return (req, res) => {
    const type = sponsorImageType(req.params.filename);
    const file = type ? resolveImage(dir, req.params.filename) : null;
    if (!file) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }
    res.sendFile(file, { headers: { ...IMAGE_HEADERS, 'Content-Type': type } });
  };
}

function resolveImage(dir, filename) {
  try {
    const file = fileInDir(dir, filename);
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

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

module.exports = { SPONSOR_IMAGES_DIR, decodeSponsorImage, saveSponsorImage, sendSponsorImage, sponsorImageType };
