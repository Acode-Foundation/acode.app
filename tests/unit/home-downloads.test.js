// @vitest-environment jsdom
import fs from 'node:fs';
import vm from 'node:vm';
import { transformFromAstSync, transformSync, types } from '@babel/core';
import tag from 'html-tag-js';

// Render the real download components without starting the homepage's network requests.
const names = new Set([
  'PLAY_URL',
  'FDROID_URL',
  'GITHUB_URL',
  'APP_STORE_URL',
  'TESTFLIGHT_URL',
  'STORES',
  'detectPlatform',
  'HeroDownload',
  'StoreButton',
  'DownloadOption',
  'BetaLink',
  'ChevronIcon',
]);
const { ast } = transformSync(fs.readFileSync('client/pages/home/index.js', 'utf8'), {
  ast: true,
  code: false,
  configFile: false,
  babelrc: false,
  plugins: ['html-tag-js/jsx/syntax-parser.js'],
});
const declarations = ast.program.body.filter((node) => names.has(node.id?.name || node.declarations?.[0]?.id.name));
const { code } = transformFromAstSync(types.file(types.program(declarations)), undefined, {
  configFile: false,
  babelrc: false,
  plugins: ['html-tag-js/jsx/jsx-to-tag.js'],
});

function renderDownloads(userAgent, maxTouchPoints = 0, iosSource = false) {
  const components = vm.runInNewContext(`${code}\n({ detectPlatform, HeroDownload, DownloadOption, STORES })`, {
    tag,
    navigator: { userAgent, maxTouchPoints },
    isIOSSource: () => iosSource,
  });
  return { ...components, hero: components.HeroDownload({ platform: components.detectPlatform() }) };
}

it.each([
  ['iPhone', 0, false],
  ['iPad', 0, false],
  ['Macintosh', 5, false],
  ['Macintosh', 0, true],
])('offers the TestFlight beta for iOS visitors (%s, touch=%s, source=%s)', (...device) => {
  const { hero } = renderDownloads(...device);
  const button = hero.querySelector('.home-btn');
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(button.textContent).toContain('App Store');
  expect(button.textContent).toContain('Coming soon');
  const betaLink = button.nextElementSibling;
  expect(betaLink.href).toBe('https://testflight.apple.com/join/qttCCWSb');
  expect(betaLink.textContent).toContain('Try the beta via TestFlight');
});

it.each(['Android', 'Macintosh', 'Windows'])('keeps Google Play as the primary download for %s', (userAgent) => {
  const { hero } = renderDownloads(userAgent);
  expect(hero.querySelector('a.home-btn').href).toContain('https://play.google.com/store/apps/details?id=com.foxdebug.acodefree');
  expect(hero.querySelector('[data-scroll-download]').getAttribute('href')).toBe('#download');
  expect(hero.querySelector('.home-beta-link')).toBeNull();
});

it('places Try Beta inside the App Store card while keeping other store cards linked', () => {
  const { DownloadOption, STORES } = renderDownloads('iPhone');
  const card = DownloadOption({ store: STORES.appStore, recommended: true });
  expect(card.tagName).toBe('DIV');
  expect(card.querySelector('.home-soon').textContent).toBe('Soon');
  const betaLink = card.querySelector('a.home-beta-link');
  expect(betaLink.textContent.trim()).toBe('Try Beta');
  expect(betaLink.href).toBe('https://testflight.apple.com/join/qttCCWSb');
  for (const store of [STORES.play, STORES.fdroid, STORES.github]) {
    const otherCard = DownloadOption({ store });
    expect(otherCard.tagName).toBe('A');
    expect(otherCard.getAttribute('href')).toBe(store.href);
    expect(otherCard.querySelector('.home-beta-link')).toBeNull();
  }
});
