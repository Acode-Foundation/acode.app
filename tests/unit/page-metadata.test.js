import {
  applyPageMetadata,
  applyProfileMetadata,
  applyRouteMetadata,
  beginProfileMetadataRequest,
  resolvePluginMetadata,
  resolveProfileMetadata,
  resolveRouteMetadata,
} from '../../client/lib/pageMetadata';
import publicMetadata from '../../server/lib/publicMetadata';

const { MAX_PLUGIN_DESCRIPTION_LENGTH, createPluginDescription } = publicMetadata;

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }
}

class FakeDocument {
  constructor() {
    this.elements = [];
    this.title = '';
    this.head = { append: (element) => this.elements.push(element) };
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  querySelector(selector) {
    const match = /^(meta|link)\[(name|property|rel)="([^"]+)"\]$/.exec(selector);
    if (!match) return null;
    const [, tagName, attribute, value] = match;
    return this.elements.find((element) => element.tagName === tagName && element.getAttribute(attribute) === value) || null;
  }
}

function content(documentRef, selector) {
  return documentRef.querySelector(selector)?.getAttribute('content');
}

describe('route metadata', () => {
  const origin = 'https://acode.app';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses a reached plugin milestone across plugins page metadata', () => {
    const documentRef = new FakeDocument();
    const metadata = resolveRouteMetadata('/plugins', origin, 287);

    applyPageMetadata(metadata, documentRef);

    expect(metadata.title).toBe('Acode Plugins — 100+ Community Extensions');
    expect(metadata.description).toBe(
      'Browse 100+ community plugins for Acode. Find language support, themes, AI assistants, build tools, and more.',
    );
    expect(content(documentRef, 'meta[property="og:title"]')).toBe(metadata.title);
    expect(content(documentRef, 'meta[name="twitter:description"]')).toBe(metadata.description);
  });

  it.each([
    [99, '99'],
    [100, '100+'],
    [499, '100+'],
    [500, '500+'],
    [999, '500+'],
    [1_000, '1K+'],
    [6_789, '5K+'],
    [12_345, '10K+'],
  ])('formats plugin count %i as the reached %s milestone', (count, milestone) => {
    expect(resolveRouteMetadata('/plugins', origin, count).title).toBe(`Acode Plugins — ${milestone} Community Extensions`);
  });

  it.each([undefined, -1, 1.5, Number.NaN, '287'])('uses count-free plugins metadata for invalid count %s', (count) => {
    const metadata = resolveRouteMetadata('/plugins', origin, count);

    expect(metadata.title).toBe('Acode Plugins — Community Extensions');
    expect(metadata.description).toBe('Browse community plugins for Acode. Find language support, themes, AI assistants, build tools, and more.');
    expect(`${metadata.title} ${metadata.description}`).not.toMatch(/250\+|\{\{count\}\}/);
  });

  it('coalesces plugin count requests and ignores their result after navigation', async () => {
    const documentRef = new FakeDocument();
    const location = { origin, pathname: '/plugins' };
    let resolveResponse;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );
    vi.stubGlobal('window', { location });
    vi.stubGlobal('document', documentRef);
    vi.stubGlobal('fetch', fetchMock);

    const firstPluginsUpdate = applyRouteMetadata('/plugins');
    const secondPluginsUpdate = applyRouteMetadata('/plugins');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    location.pathname = '/sponsors';
    await applyRouteMetadata('/sponsors');
    const sponsorsTitle = documentRef.title;

    resolveResponse({ ok: true, json: async () => ({ count: 287 }) });
    await Promise.all([firstPluginsUpdate, secondPluginsUpdate]);

    expect(documentRef.title).toBe(sponsorsTitle);
    expect(documentRef.title).toBe(resolveRouteMetadata('/sponsors', origin).title);
  });

  it('resolves plugin sections without carrying the section into the canonical URL', () => {
    const metadata = resolveRouteMetadata('/plugin/example.plugin/comments', origin);
    expect(metadata.title).toBe('Acode Plugin — Acode');
    expect(metadata.canonicalUrl).toBe('https://acode.app/plugin/example.plugin');
    expect(metadata.imageUrl).toBe('https://acode.app/og/default.png');
  });

  it('updates plugin metadata after data loads and safely resets it on home navigation', () => {
    const documentRef = new FakeDocument();
    const pluginMetadata = resolvePluginMetadata(
      {
        id: 'example.plugin',
        name: 'Example Plugin',
        description: '**A useful** [plugin](https://example.com) for Acode.',
        version: '1.2.3',
      },
      origin,
    );

    applyPageMetadata(pluginMetadata, documentRef);
    expect(documentRef.title).toBe('Example Plugin — Acode Plugin');
    expect(content(documentRef, 'meta[property="og:image"]')).toContain('/og/plugin/example.plugin.png?v=1.2.3&r=2');
    expect(content(documentRef, 'meta[name="twitter:card"]')).toBe('summary_large_image');

    const homeMetadata = resolveRouteMetadata('/', origin);
    applyPageMetadata(homeMetadata, documentRef);
    expect(documentRef.title).toBe(homeMetadata.title);
    expect(content(documentRef, 'meta[property="og:title"]')).toBe(homeMetadata.title);
    expect(content(documentRef, 'meta[property="og:image"]')).toBe('https://acode.app/og/default.png');
    expect(documentRef.querySelector('link[rel="canonical"]').getAttribute('href')).toBe('https://acode.app/');
  });

  it('applies complete user-name metadata after a profile loads', () => {
    const documentRef = new FakeDocument();
    const metadata = resolveProfileMetadata({ id: 1, name: 'Ajit Kumar' }, origin);

    applyPageMetadata(metadata, documentRef);

    expect(metadata).toMatchObject({
      title: 'Ajit Kumar — Acode',
      description: "View Ajit Kumar's profile and published plugins on Acode.",
      robots: 'index, follow',
      canonicalUrl: 'https://acode.app/profile/1',
      imageUrl: 'https://acode.app/og/default.png',
    });
    expect(documentRef.title).toBe(metadata.title);
    expect(documentRef.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(metadata.canonicalUrl);
    expect(content(documentRef, 'meta[property="og:title"]')).toBe(metadata.title);
    expect(content(documentRef, 'meta[property="og:description"]')).toBe(metadata.description);
    expect(content(documentRef, 'meta[name="twitter:title"]')).toBe(metadata.title);
    expect(content(documentRef, 'meta[name="twitter:description"]')).toBe(metadata.description);
  });

  it('updates robots metadata when navigating into and away from a deleted profile', async () => {
    const documentRef = new FakeDocument();
    const location = { origin, pathname: '/profile/7' };
    vi.stubGlobal('window', { location });
    vi.stubGlobal('document', documentRef);

    const request = beginProfileMetadataRequest();
    expect(applyProfileMetadata({ id: 7, name: 'Deleted User', role: 'deleted' }, request)).toBe(true);
    expect(content(documentRef, 'meta[name="robots"]')).toBe('noindex, follow');

    location.pathname = '/sponsors';
    await applyRouteMetadata(location.pathname);

    expect(content(documentRef, 'meta[name="robots"]')).toBe('index, follow');
  });

  it('does not overwrite newer route metadata when a profile load finishes after navigation', () => {
    const documentRef = new FakeDocument();
    const location = { origin, pathname: '/profile/1' };
    vi.stubGlobal('window', { location });
    vi.stubGlobal('document', documentRef);
    const request = beginProfileMetadataRequest();

    location.pathname = '/sponsors';
    const sponsorsMetadata = resolveRouteMetadata(location.pathname, origin);
    applyPageMetadata(sponsorsMetadata, documentRef);

    expect(applyProfileMetadata({ id: 1, name: 'Ajit Kumar' }, request)).toBe(false);
    expect(documentRef.title).toBe(sponsorsMetadata.title);
    expect(documentRef.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(sponsorsMetadata.canonicalUrl);
    expect(content(documentRef, 'meta[name="robots"]')).toBe('index, follow');
    expect(content(documentRef, 'meta[property="og:title"]')).toBe(sponsorsMetadata.title);
    expect(content(documentRef, 'meta[name="twitter:title"]')).toBe(sponsorsMetadata.title);
  });

  it('rejects an older profile response after navigating away and back to the same path', () => {
    const documentRef = new FakeDocument();
    const location = { origin, pathname: '/profile/1' };
    vi.stubGlobal('window', { location });
    vi.stubGlobal('document', documentRef);

    const firstRequest = beginProfileMetadataRequest();
    location.pathname = '/sponsors';
    location.pathname = '/profile/1';
    const latestRequest = beginProfileMetadataRequest();

    expect(applyProfileMetadata({ id: 1, name: 'Current Name', role: 'user' }, latestRequest)).toBe(true);
    const currentMetadata = resolveProfileMetadata({ id: 1, name: 'Current Name', role: 'user' }, origin);

    expect(applyProfileMetadata({ id: 1, name: 'Deleted User', role: 'deleted' }, firstRequest)).toBe(false);
    expect(documentRef.title).toBe(currentMetadata.title);
    expect(documentRef.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(currentMetadata.canonicalUrl);
    expect(content(documentRef, 'meta[name="robots"]')).toBe('index, follow');
    expect(content(documentRef, 'meta[property="og:title"]')).toBe(currentMetadata.title);
    expect(content(documentRef, 'meta[name="twitter:title"]')).toBe(currentMetadata.title);
  });

  it('uses the same bounded plugin summary during SSR and SPA navigation', () => {
    const plugin = {
      id: 'example.plugin',
      name: 'Example Plugin',
      description: `# Example\n\n[!TIP]\n${"Acode's developer-friendly plugin workflow works across Android projects. ".repeat(8)}`,
      version: '2.0.0',
    };
    const clientDescription = resolvePluginMetadata(plugin, origin).description;
    const serverDescription = createPluginDescription(plugin.description, `${plugin.name} is a plugin for Acode.`);

    expect(clientDescription).toBe(serverDescription);
    expect(clientDescription.length).toBeLessThanOrEqual(MAX_PLUGIN_DESCRIPTION_LENGTH);
    expect(clientDescription).not.toMatch(/[\n\r#]/);
    expect(clientDescription).toMatch(/…$/);
  });

  it.each([
    ['short descriptions', 'A small plugin for Acode.', 'A small plugin for Acode.'],
    ['empty descriptions', '', 'Example Plugin is a plugin for Acode.'],
  ])('preserves %s consistently', (_case, description, expected) => {
    const plugin = { id: 'example.plugin', name: 'Example Plugin', description, version: '1.0.0' };

    expect(resolvePluginMetadata(plugin, origin).description).toBe(expected);
    expect(createPluginDescription(description, `${plugin.name} is a plugin for Acode.`)).toBe(expected);
  });

  it('sets complete image metadata', () => {
    const documentRef = new FakeDocument();
    applyPageMetadata(resolveRouteMetadata('/sponsors', origin), documentRef);

    expect(content(documentRef, 'meta[property="og:image:secure_url"]')).toBe('https://acode.app/og/default.png');
    expect(content(documentRef, 'meta[property="og:image:type"]')).toBe('image/png');
    expect(content(documentRef, 'meta[property="og:image:width"]')).toBe('1200');
    expect(content(documentRef, 'meta[property="og:image:height"]')).toBe('630');
    expect(content(documentRef, 'meta[name="twitter:image:alt"]')).toContain('Acode');
  });
});
