const sharp = require('sharp');
const { pluginRevision } = require('../../shared/ogImage.json');
const { isTemporaryImage } = require('../../server/lib/ogImageCachePolicy');
const {
  clearOgImageCache,
  createPluginOgSvg,
  escapeXml,
  renderDefaultOgImage,
  renderPluginOgImage,
  renderPluginsOgImage,
} = require('../../server/lib/ogImage');

describe('Open Graph image rendering', () => {
  beforeEach(() => clearOgImageCache());
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['default', () => renderDefaultOgImage()],
    [
      'plugin fallback',
      () =>
        renderPluginOgImage({
          id: 'example.plugin',
          name: 'Example <Plugin>',
          author: 'A & B',
          version: '1.0.0',
        }),
    ],
  ])('creates a valid 1200x630 PNG for %s cards', async (_name, render) => {
    const image = await render();
    const metadata = await sharp(image).metadata();

    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
  });

  it('uses the Acode logo for missing, corrupt or directory plugin icons', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acode-og-icon-'));
    try {
      const corrupt = path.join(directory, 'corrupt.png');
      fs.writeFileSync(corrupt, 'not a PNG');
      const input = { id: 'test.plugin', name: 'Test', author: 'Author', version: '1.0.0' };
      const fallback = await renderPluginOgImage(input);
      for (const iconPath of [path.join(directory, 'missing.png'), corrupt, directory]) {
        const image = await renderPluginOgImage({ ...input, iconPath });
        expect(image.equals(fallback)).toBe(true);
        expect(isTemporaryImage(image)).toBe(true);
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('retries repaired icons after a minute and rate-limits fallback warnings across cards', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acode-og-repair-'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const iconPath = path.join(directory, 'icon.png');
      fs.writeFileSync(iconPath, 'corrupt');
      const input = { id: 'test.plugin', name: 'Test', iconPath };
      const fallback = await renderPluginOgImage(input);
      await renderPluginOgImage({ ...input, id: 'other.plugin' });
      expect(warn).toHaveBeenCalledTimes(1);
      await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff6600' } })
        .png()
        .toFile(iconPath);
      expect(await renderPluginOgImage(input)).toBe(fallback);
      now += 60000;
      const repaired = await renderPluginOgImage(input);
      expect(repaired.equals(fallback)).toBe(false);
      expect(isTemporaryImage(repaired)).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('renders all card types when external assets are unavailable, including permission errors', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const filename = path.resolve(__dirname, '../../server/lib/ogImage.js');
    const module = { exports: {} };
    const warn = vi.fn();
    const dependencies = {
      'node:path': path,
      sharp: (input, ...args) => {
        if (typeof input === 'string') throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
        return sharp(input, ...args);
      },
      '../../shared/acodeLogo': require('../../shared/acodeLogo'),
      '../../shared/ogImage.json': require('../../shared/ogImage.json'),
      '../../shared/metadataText': require('../../shared/metadataText'),
      './ogImageCachePolicy': require('../../server/lib/ogImageCachePolicy'),
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module,
      Buffer,
      __dirname: path.dirname(filename),
      console: { warn },
      require(name) {
        if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
        return dependencies[name];
      },
    });
    const renderer = module.exports;
    for (const image of [
      await renderer.renderDefaultOgImage(),
      await renderer.renderPluginOgImage({ id: 'test.plugin', name: 'Test', iconPath: '/denied/icon.png' }),
      await renderer.renderPluginsOgImage({ iconPaths: ['/denied/icon.png'] }),
    ]) {
      const metadata = await sharp(image).metadata();
      expect([metadata.width, metadata.height]).toEqual([1200, 630]);
      expect(isTemporaryImage(image)).toBe(true);
    }
    expect(warn).toHaveBeenCalledTimes(2); // Screenshot and icon, not every store tile.
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ reason: 'EACCES' }));
  });

  it('keeps the store card count-free while page metadata can update live', async () => {
    const first = await renderPluginsOgImage({ count: 99 });
    expect(await renderPluginsOgImage({ count: 1000 })).toBe(first);
  });

  it('renders the plugin store card with and without icons, under the chat-preview size budget', async () => {
    const path = require('node:path');
    const icon = path.resolve(__dirname, '../../client/res/logo.svg');
    for (const iconPaths of [[], [icon, '/missing/icon.png']]) {
      const image = await renderPluginsOgImage({ count: 287, iconPaths });
      const metadata = await sharp(image).metadata();
      expect([metadata.width, metadata.height]).toEqual([1200, 630]);
      expect(image.length).toBeLessThan(300 * 1024);
    }
  });

  it('keeps a plugin card with a detailed image and long labels within the chat-preview budget', async () => {
    const path = require('node:path');
    const image = await renderPluginOgImage({
      id: 'example.plugin',
      name: 'A detailed plugin for developers and designers',
      author: 'Example Developer Community',
      iconPath: path.resolve(__dirname, '../../client/res/acode-shot-panes.jpg'),
      version: '123.456.789',
      downloads: 423121,
      rating: 98,
    });
    expect(image.length).toBeLessThan(300 * 1024);
  });

  it.each([
    [null, '0'],
    ['12345', '12,345'],
    [Number.NaN, '0'],
  ])('normalizes %s downloads in the exported SVG renderer', (downloads, label) => {
    expect(createPluginOgSvg({ name: 'Example', downloads }).toString()).toContain(`>${label}</text>`);
  });

  it('escapes text embedded in the generated SVG', () => {
    expect(escapeXml('<Acode & "friends">')).toBe('&lt;Acode &amp; &quot;friends&quot;&gt;');
  });

  it('renders the plugin name and author without a fake call-to-action button', () => {
    const svg = createPluginOgSvg({ name: 'AcodeX - Terminal', author: 'Raunak Raj' }).toString();

    expect(svg).toContain('>AcodeX - Terminal</text>');
    expect(svg).toContain('>Raunak Raj</text>');
    expect(svg).toContain('>RR</text>');
    expect(svg).not.toContain('Explore on acode.app');
    expect(pluginRevision).toBe('5');
  });

  const titleOf = (svg) => svg.match(/font-size="(\d+)" font-weight="700" letter-spacing="-2" text-anchor="middle">([^<]*)<\/text>/);

  it('shrinks long plugin names and cuts them at a word boundary', () => {
    const [, size, title] = titleOf(createPluginOgSvg({ name: 'Pixforge - Image Toolkit for Designers and Developers', author: 'A' }).toString());

    expect(Number(size)).toBeLessThan(68);
    expect(title).toMatch(/^Pixforge - Image Toolkit[\w -]*\w…$/);
  });

  it('keeps wide-character names inside the canvas', () => {
    const name = '代码编辑器插件'.repeat(6);
    const [, size, title] = titleOf(createPluginOgSvg({ name, author: 'A' }).toString());

    expect(Number(size)).toBe(44);
    expect(title.endsWith('…')).toBe(true);
    // Each wide character renders about one em less the -2px tracking, so the cut title fits the 1,040px text area.
    const characters = Array.from(title).length;
    expect((characters - 1) * Number(size) - 2 * characters).toBeLessThanOrEqual(1040);
  });

  it('keeps emoji, which the renderer cannot draw, out of initials and names', () => {
    const svg = createPluginOgSvg({ name: 'Rocket 🚀 Tools', author: '😀 Émile Zola' }).toString();

    expect(svg).toContain('>ÉZ</text>');
    expect(svg).toContain('>Émile Zola</text>');
    expect(svg).toContain('>Rocket Tools</text>');
    expect(svg).not.toMatch(/\p{Extended_Pictographic}|�/u);
  });

  it('returns a cached image for the same plugin version', async () => {
    const input = { id: 'example.plugin', name: 'Example', author: 'Author', version: '1.0.0' };
    const first = await renderPluginOgImage(input);
    const second = await renderPluginOgImage(input);
    expect(second).toBe(first);
  });

  it('shows the release, downloads and approval rating, including unrated plugins', () => {
    const svg = createPluginOgSvg({ name: 'Test', version: '2.3.4', downloads: 12345, rating: 96 }).toString();
    expect(svg).toContain('transform="translate(60 52)"');
    expect(svg).toContain('>2.3.4</text>');
    expect(svg).toContain('>12,345</text>');
    expect(svg).toContain('>96%</text>');
    expect(svg.match(/viewBox="0 0 24 24"/g)).toHaveLength(3);
    const unrated = createPluginOgSvg({ name: 'New', downloads: 0 }).toString();
    expect(unrated).toContain('>0</text>');
    expect(unrated).toContain('>—</text>');
  });

  it('refreshes cached plugin images when displayed stats change', async () => {
    const input = { id: 'test.plugin', name: 'Test', version: '1.0.0', downloads: 12, rating: 80 };
    const first = await renderPluginOgImage(input);
    for (const change of [{ version: '1.0.1' }, { downloads: 13 }, { rating: 81 }]) {
      expect((await renderPluginOgImage({ ...input, ...change })).equals(first)).toBe(false);
    }
  });

  it('refreshes the default image at the same plugin milestones used by page metadata', async () => {
    const first = await renderDefaultOgImage(287);
    expect(await renderDefaultOgImage(499)).toBe(first);
    const next = await renderDefaultOgImage(500);
    expect(next.equals(first)).toBe(false);
    expect(await renderDefaultOgImage(999)).toBe(next);
    expect((await renderDefaultOgImage(1000)).equals(next)).toBe(false);
  });

  it('uses a count-free fallback without confusing zero plugins with an unavailable count', async () => {
    const fallback = await renderDefaultOgImage();
    expect(await renderDefaultOgImage(null)).toBe(fallback);
    expect(await renderDefaultOgImage(-1)).toBe(fallback);
    expect((await renderDefaultOgImage(0)).equals(fallback)).toBe(false);
    expect((await renderDefaultOgImage(1)).equals(await renderDefaultOgImage(2))).toBe(false);
  });
});

it('still renders the default card when a store icon is absent', async () => {
  const { icons } = require('../../client/res/icons/selection.json');
  const icon = icons.find(({ properties }) => properties.name === 'app-store');
  const originalName = icon.properties.name;
  try {
    icon.properties.name = 'temporarily-missing';
    clearOgImageCache();
    expect((await sharp(await renderDefaultOgImage()).metadata()).width).toBe(1200);
  } finally {
    icon.properties.name = originalName;
    clearOgImageCache();
  }
});
