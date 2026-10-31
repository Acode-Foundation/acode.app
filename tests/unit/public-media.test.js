const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const resources = path.resolve(__dirname, '../../client/res');

it.each([
  [480, 1800000],
  [720, 3500000],
])('keeps %sp playback within budget with metadata before media data', (height, budget) => {
  const data = fs.readFileSync(path.join(resources, `optimized/acode-demo-${height}.mp4`));
  expect(data.length).toBeLessThanOrEqual(budget);
  const atoms = [];
  for (let offset = 0; offset + 8 <= data.length; ) {
    const length = data.readUInt32BE(offset);
    atoms.push(data.toString('ascii', offset + 4, offset + 8));
    if (length < 8) break;
    offset += length;
  }
  expect(atoms).toContain('moov');
  expect(atoms.indexOf('moov')).toBeLessThan(atoms.indexOf('mdat'));
});

it.each([480, 800, 1024])('keeps the %sp poster responsive and small', async (width) => {
  const file = path.join(resources, `optimized/acode-poster-${width}.webp`);
  const image = await sharp(file).metadata();
  expect(image.width).toBe(width);
  expect(image.format).toBe('webp');
  expect(fs.statSync(file).size).toBeLessThan(width <= 480 ? 35000 : 70000);
});

it('preserves the originals behind each generated screenshot preview', async () => {
  const previews = fs.readdirSync(path.join(resources, 'optimized')).filter((name) => /^acode-shot-.*-(360|640)\.webp$/.test(name));
  expect(previews.length).toBeGreaterThan(0);
  for (const name of previews) {
    const source = path.join(resources, name.replace(/-(360|640)\.webp$/, '.webp'));
    const original = await sharp(source).metadata();
    const width = original.width > 1000 ? 640 : 360;
    const preview = path.join(resources, 'optimized', name);
    expect((await sharp(preview).metadata()).width).toBe(width);
    expect(fs.statSync(preview).size).toBeLessThan(fs.statSync(source).size);
  }
});
