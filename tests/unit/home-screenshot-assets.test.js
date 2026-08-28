import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const assets = path.resolve(import.meta.dirname, '../../client/res');

describe('homepage screenshot assets', () => {
  it.each([
    ['editor', 'jpg'],
    ['terminal', 'jpg'],
    ['sftp', 'png'],
    ['commands', 'png'],
    ['search', 'png'],
    ['formatter', 'png'],
    ['plugins', 'png'],
    ['themes', 'png'],
  ])('keeps %s at the same dimensions in both image formats', async (name, fallback) => {
    for (const extension of [fallback, 'webp']) {
      const metadata = await sharp(path.join(assets, `acode-shot-${name}.${extension}`)).metadata();
      expect({ width: metadata.width, height: metadata.height }).toEqual({ width: 720, height: 1387 });
    }
  });
});
