const sharp = require('sharp');
const { pluginRevision } = require('../../shared/ogImage.json');
const { clearOgImageCache, createPluginOgSvg, escapeXml, renderDefaultOgImage, renderPluginOgImage, wrapText } = require('../../server/lib/ogImage');

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

  it('escapes text embedded in the generated SVG', () => {
    expect(escapeXml('<Acode & "friends">')).toBe('&lt;Acode &amp; &quot;friends&quot;&gt;');
  });

  it('renders the plugin CTA with padded geometry and high-contrast colors', () => {
    const svg = createPluginOgSvg({ name: 'AcodeX - Terminal', author: 'Raunak Raj' }).toString();

    expect(svg).toContain('<rect width="336" height="64" rx="32" fill="#66b3ff"/>');
    expect(svg).toContain('<text x="168" y="42" text-anchor="middle" fill="#07111f"');
    expect(pluginRevision).toBe('2');
  });

  it('bounds long plugin names even when they have no spaces', () => {
    const lines = wrapText('VeryLongPluginNameWithoutSpacesAndAdditionalText', 20, 2);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.length <= 20)).toBe(true);
    expect(lines.at(-1)).toMatch(/…$/);
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
