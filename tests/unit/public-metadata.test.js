const fs = require('node:fs');
const path = require('node:path');
const Handlebars = require('handlebars');
const defaultOg = require('../../server/defaultOg.json');
const { getMetadata } = require('../../server/routeMetadata');
const { createProfileMetadata } = require('../../shared/metadataText');
const {
  MAX_PLUGIN_DESCRIPTION_LENGTH,
  createMetadataContext,
  createPluginDescription,
  getPublicOrigin,
  localizeStructuredData,
} = require('../../server/lib/publicMetadata');

describe('public metadata origins', () => {
  it.each([
    ['https://dev.acode.app', 'https://dev.acode.app'],
    ['https://acode.app/', 'https://acode.app'],
    ['https://dev.acode.app/a/path?ignored=true', 'https://dev.acode.app'],
  ])('normalizes %s to %s', (host, expected) => {
    expect(getPublicOrigin(host)).toBe(expected);
  });

  it.each(['invalid', 'ftp://acode.app', 'https://user:password@acode.app'])('falls back safely for invalid HOST value %s', (host) => {
    expect(getPublicOrigin(host)).toBe('https://acode.app');
  });

  it('builds development canonical and image URLs from the same origin', () => {
    const context = createMetadataContext(defaultOg, {
      canonicalPath: '/plugin/example.plugin',
      imagePath: '/og/plugin/example.plugin.png?v=1.0.0',
      origin: 'https://dev.acode.app',
    });

    expect(context.canonical_url).toBe('https://dev.acode.app/plugin/example.plugin');
    expect(context.image_url).toBe('https://dev.acode.app/og/plugin/example.plugin.png?v=1.0.0');
  });

  it('builds production URLs when production is the configured origin', () => {
    const context = createMetadataContext(defaultOg, {
      canonicalPath: '/plugins',
      origin: 'https://acode.app',
    });

    expect(context.canonical_url).toBe('https://acode.app/plugins');
    expect(context.image_url).toBe('https://acode.app/og/default.png');
  });
});

describe('server-rendered metadata', () => {
  it.each(['index.hbs', 'landing.hbs'])('renders environment-based URLs in %s', (templateName) => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'server', templateName), 'utf8');
    const render = Handlebars.compile(source);
    const context = createMetadataContext(defaultOg, {
      canonicalPath: '/plugin/example.plugin',
      imagePath: '/og/plugin/example.plugin.png',
      origin: 'https://dev.acode.app',
    });
    const html = render({ ...context, title: 'Example', description: 'Example description', robots: 'index, follow' });

    expect(html).toContain('href="https://dev.acode.app/plugin/example.plugin"');
    expect(html).toContain('content="https://dev.acode.app/og/plugin/example.plugin.png"');
    expect(html).not.toContain('content="https://acode.app/og/');
  });

  it('uses the configured origin in home structured data', () => {
    const metadata = getMetadata('/', 'https://dev.acode.app');
    expect(metadata.schema.url).toBe('https://dev.acode.app');
    expect(metadata.schema.image).toBe('https://dev.acode.app/og/default.png');
    expect(metadata.orgSchema.logo).toBe('https://dev.acode.app/logo-512.png');
  });

  it('renders user-name profile metadata with the canonical profile URL and default image', () => {
    const profile = { id: 1, name: 'Ajit Kumar', role: 'user' };
    const metadata = createProfileMetadata(profile);
    const context = createMetadataContext(defaultOg, {
      canonicalPath: `/profile/${profile.id}`,
      origin: 'https://acode.app',
    });
    const source = fs.readFileSync(path.resolve(process.cwd(), 'server', 'index.hbs'), 'utf8');
    const html = Handlebars.compile(source)({ ...context, ...metadata, image_alt: metadata.title });

    expect(metadata).toEqual({
      title: 'Ajit Kumar — Acode',
      description: "View Ajit Kumar's profile and published plugins on Acode.",
      robots: 'index, follow',
    });
    expect(html).toContain('<title>Ajit Kumar — Acode</title>');
    expect(html).toContain('<link rel="canonical" href="https://acode.app/profile/1" />');
    expect(html).toContain('<meta property="og:title" content="Ajit Kumar — Acode" />');
    expect(html).toContain('<meta name="twitter:title" content="Ajit Kumar — Acode" />');
    expect(html).toContain('<meta property="og:image" content="https://acode.app/og/default.png" />');
    expect(html).toContain('<meta name="robots" content="index, follow" />');
  });

  it('marks retained deleted-user profiles as non-indexable', () => {
    const metadata = createProfileMetadata({ name: 'Deleted User', role: 'deleted' });
    const source = fs.readFileSync(path.resolve(process.cwd(), 'server', 'index.hbs'), 'utf8');
    const html = Handlebars.compile(source)({ ...createMetadataContext(defaultOg, { canonicalPath: '/profile/7' }), ...metadata });

    expect(metadata.robots).toBe('noindex, follow');
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
  });

  it('uses count-free plugins metadata when a live count is unavailable', () => {
    const metadata = getMetadata('/plugins');

    expect(metadata.title).toBe('Acode Plugins — Community Extensions');
    expect(metadata.description).toBe('Browse community plugins for Acode. Find language support, themes, AI assistants, build tools, and more.');
  });

  it('localizes landing-page structured data without changing external URLs', () => {
    const schema = {
      url: 'https://acode.app/example',
      publisher: { logo: 'https://acode.app/logo-512.png' },
      external: 'https://github.com/Acode-Foundation/Acode',
    };
    const localized = JSON.parse(localizeStructuredData(schema, 'https://dev.acode.app'));

    expect(localized.url).toBe('https://dev.acode.app/example');
    expect(localized.publisher.logo).toBe('https://dev.acode.app/logo-512.png');
    expect(localized.external).toBe(schema.external);
  });

  it('rewrites only exact Acode origins while preserving parsed URL components', () => {
    const schema = {
      root: 'https://acode.app',
      url: 'https://acode.app/plugin/example?tab=comments#latest',
      nested: ['https://acode.app/logo-512.png?v=2#image'],
    };
    const localized = JSON.parse(localizeStructuredData(schema, 'https://dev.acode.app'));

    expect(localized).toEqual({
      root: 'https://dev.acode.app',
      url: 'https://dev.acode.app/plugin/example?tab=comments#latest',
      nested: ['https://dev.acode.app/logo-512.png?v=2#image'],
    });
  });

  it.each([
    'https://acode.app.evil/plugin/example',
    'https://acode.app@evil.example/plugin/example',
    'https://user:password@acode.app/plugin/example',
    'http://acode.app/plugin/example',
    'https://github.com/Acode-Foundation/Acode',
    'not a valid URL',
  ])('does not rewrite an untrusted structured-data URL: %s', (url) => {
    const localized = JSON.parse(localizeStructuredData({ url }, 'https://dev.acode.app'));

    expect(localized.url).toBe(url);
  });
});

describe('plugin metadata descriptions', () => {
  it('normalizes markdown and truncates long descriptions at a word boundary', () => {
    const markdown = `# AcodeX Terminal\n\n> [!Warning]\n${'A useful terminal integration for Acode developers. '.repeat(20)}`;
    const description = createPluginDescription(markdown);

    expect(MAX_PLUGIN_DESCRIPTION_LENGTH).toBe(120);
    expect(description.length).toBeLessThanOrEqual(MAX_PLUGIN_DESCRIPTION_LENGTH);
    expect(description).not.toMatch(/[\n\r#]/);
    expect(description).not.toMatch(/\[!warning]/i);
    expect(description).toMatch(/…$/);

    const completeText = `AcodeX Terminal ${'A useful terminal integration for Acode developers. '.repeat(20)}`.trim();
    expect(completeText.startsWith(`${description.slice(0, -1)} `)).toBe(true);
  });

  it('uses a concise fallback for an empty plugin description', () => {
    expect(createPluginDescription('', 'Example is a plugin for Acode.')).toBe('Example is a plugin for Acode.');
  });

  it('keeps escaped apostrophes safely below validator thresholds', () => {
    const description = createPluginDescription(
      "AcodeX connects to Acode's built-in terminal backend and provides a fast developer workflow on Android. Extra words force truncation.",
    );
    const serialized = Handlebars.escapeExpression(description);

    expect(description.length).toBeLessThanOrEqual(120);
    expect(serialized).toContain('&#x27;');
    expect(serialized.length).toBeLessThanOrEqual(125);
  });
});
