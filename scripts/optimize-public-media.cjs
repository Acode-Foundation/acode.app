// Run from any directory with Node and ffmpeg installed. Originals are never modified.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const sharp = require('sharp');

const resources = path.resolve(__dirname, '../client/res');
const output = path.join(resources, 'optimized');

async function main() {
  await fs.mkdir(output, { recursive: true });
  if (!process.argv.includes('--images-only')) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'acode-encode-'));
    try {
      for (const [height, bitrate, audio, budget] of [
        [480, '400k', '64k', 1800000],
        [720, '800k', '96k', 3500000],
      ]) {
        const passlog = path.join(temporary, String(height));
        const options = [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          path.join(resources, 'acode-demo.mp4'),
          '-vf',
          `scale=-2:${height},fps=30`,
          '-c:v',
          'libx264',
          '-preset',
          'slow',
          '-b:v',
          bitrate,
          '-pix_fmt',
          'yuv420p',
          '-g',
          '60',
          '-passlogfile',
          passlog,
        ];
        const destination = path.join(output, `acode-demo-${height}.mp4`);
        for (const args of [
          [...options, '-pass', '1', '-an', '-f', 'null', '/dev/null'],
          [...options, '-pass', '2', '-c:a', 'aac', '-b:a', audio, '-movflags', '+faststart', destination],
        ]) {
          const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
          if (result.error || result.status !== 0) throw result.error || new Error(`ffmpeg failed for ${height}p`);
        }
        const { size } = await fs.stat(destination);
        if (size > budget) throw new Error(`${height}p exceeds its ${budget}-byte budget: ${size}`);
        console.log(`${height}p: ${size} bytes`);
      }
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  const poster = path.join(resources, 'acode-feature-clean.png');
  for (const width of [480, 800, 1024]) {
    await sharp(poster)
      .resize({ width })
      .webp({ quality: 80, effort: 6 })
      .toFile(path.join(output, `acode-poster-${width}.webp`));
  }
  // Generate only the screenshots shown by the current feature galleries.
  for (const key of ['editor', 'commands', 'formatter', 'panes', 'agent', 'plugins', 'themes']) {
    const name = `acode-shot-${key}.webp`;
    const source = path.join(resources, name);
    const { width } = await sharp(source).metadata();
    for (const size of width > 1000 ? [640, 1280] : [360, 720]) {
      await sharp(source)
        .resize({ width: size, withoutEnlargement: true })
        .webp({ quality: 82, effort: 6 })
        .toFile(path.join(output, name.replace('.webp', `-${size}.webp`)));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
