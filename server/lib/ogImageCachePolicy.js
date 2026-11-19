const OG_CACHE_MS = 2 * 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const CACHE_BYTES = 24 * 1024 * 1024;
const temporaryImages = new WeakSet();

function markTemporaryImage(image) {
  temporaryImages.add(image);
  return image;
}

function isTemporaryImage(image) {
  return temporaryImages.has(image);
}

module.exports = { OG_CACHE_MS, RETRY_MS, CACHE_BYTES, markTemporaryImage, isTemporaryImage };
