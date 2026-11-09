const sharp = require('sharp');
const { pluginRevision } = require('../../shared/ogImage.json');
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

  it('escapes text embedded in the generated SVG', () => {
    expect(escapeXml('<Acode & "friends">')).toBe('&lt;Acode &amp; &quot;friends&quot;&gt;');
  });

  it('renders the plugin name and author without a fake call-to-action button', () => {
    const svg = createPluginOgSvg({ name: 'AcodeX - Terminal', author: 'Raunak Raj' }).toString();

    expect(svg).toContain('>AcodeX - Terminal</text>');
    expect(svg).toContain('>Raunak Raj</text>');
    expect(svg).toContain('>RR</text>');
    expect(svg).not.toContain('Explore on acode.app');
    expect(pluginRevision).toBe('4');
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
