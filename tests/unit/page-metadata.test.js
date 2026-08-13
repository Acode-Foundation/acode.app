import { applyPageMetadata, resolvePluginMetadata, resolveRouteMetadata } from '../../client/lib/pageMetadata';
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
