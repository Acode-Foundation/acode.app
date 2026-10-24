import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { SPONSOR_IMAGE_EXTENSION, decodeSponsorImage, saveSponsorImage } = require('../../server/lib/sponsorImage');

const pixel = { width: 2, height: 2, channels: 3, background: '#3499fe' };

async function dataUrl(type, buffer) {
  return `data:${type};base64,${buffer.toString('base64')}`;
}

async function image(format) {
  return sharp({ create: pixel })[format]().toBuffer();
}

it.each([
  ['png', 'image/png', 'png'],
  ['jpeg', 'image/jpeg', 'jpg'],
  ['webp', 'image/webp', 'webp'],
])('keeps %s logos as uploaded', async (format, type, extension) => {
  const buffer = await image(format);
  const decoded = await decodeSponsorImage(await dataUrl(type, buffer));
  expect(decoded.extension).toBe(extension);
  expect(decoded.buffer.equals(buffer)).toBe(true);
});

it('stores other images, including SVG, as PNG', async () => {
  const gif = await decodeSponsorImage(await dataUrl('image/gif', await image('gif')));
  const svg = await decodeSponsorImage(
    await dataUrl('image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><script>alert(1)</script></svg>')),
  );

  for (const decoded of [gif, svg]) {
    expect(decoded.extension).toBe('png');
    expect((await sharp(decoded.buffer).metadata()).format).toBe('png');
  }
});

it('rejects uploads that are not images, whatever type they claim', async () => {
  const html = Buffer.from('<script>alert(document.domain)</script>');
  for (const upload of [
    await dataUrl('text/html', html),
    await dataUrl('image/png', html),
    'data:image/png;base64,',
    'data:image/png,not-base64',
    'not a data url',
    null,
    { toString: () => 'data:image/png;base64,AAAA' },
  ]) {
    expect(await decodeSponsorImage(upload)).toBeNull();
  }
});

it.each(['png', 'jpeg'])('rejects a %s whose header reads fine but whose pixels are cut off', async (format) => {
  const full = await sharp({ create: { width: 64, height: 64, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 30 } } })
    [format]()
    .toBuffer();
  const truncated = full.subarray(0, Math.floor(full.length / 2));

  expect((await sharp(truncated).metadata()).format).toBe(format);
  expect(await decodeSponsorImage(await dataUrl(`image/${format}`, truncated))).toBeNull();
  expect(await decodeSponsorImage(await dataUrl(`image/${format}`, full))).not.toBeNull();
});

it('rejects images over the size limit', async () => {
  expect(await decodeSponsorImage(await dataUrl('image/png', Buffer.alloc(1024 * 1024 + 1)))).toBeNull();
});

it('writes stored logos under a random name with their real extension', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sponsor-images-'));
  try {
    const filename = await saveSponsorImage(await dataUrl('text/html', await image('png')), dir);
    expect(filename).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(fs.readdirSync(dir)).toEqual([filename]);
    expect(await saveSponsorImage(await dataUrl('text/html', Buffer.from('<p>hi</p>')), dir)).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([filename]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('serves only raster image extensions', () => {
  for (const name of ['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.gif', 'A.PNG']) expect(SPONSOR_IMAGE_EXTENSION.test(name)).toBe(true);
  for (const name of ['a.html', 'a.svg', 'a.png.html', 'a.js', 'png']) expect(SPONSOR_IMAGE_EXTENSION.test(name)).toBe(false);
});
