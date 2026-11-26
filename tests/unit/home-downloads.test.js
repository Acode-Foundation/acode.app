// @vitest-environment jsdom
import fs from 'node:fs';
import vm from 'node:vm';
import { transformFromAstSync, transformSync, types } from '@babel/core';
import tag from 'html-tag-js';

import { APP_STORE_URL, PLAY_STORE_CAMPAIGN_URL, TESTFLIGHT_URL } from '../../shared/appLinks';

// Render the real download components without starting the homepage's network requests.
const names = new Set([
  'FDROID_URL',
  'GITHUB_URL',
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
    APP_STORE_URL,
    PLAY_STORE_CAMPAIGN_URL,
    TESTFLIGHT_URL,
  });
  return { ...components, hero: components.HeroDownload({ platform: components.detectPlatform() }) };
}

it.each([
  ['iPhone', 0, false],
  ['iPad', 0, false],
  ['Macintosh', 5, false],
  ['Macintosh', 0, true],
])('leads with the App Store for iOS visitors (%s, touch=%s, source=%s)', (...device) => {
  const { hero } = renderDownloads(...device);
  const button = hero.querySelector('a.home-btn');
  expect(button.href).toBe(APP_STORE_URL);
  expect(button.textContent).toContain('Download on the App Store');
  expect(hero.textContent).not.toMatch(/coming soon/i);
  expect(hero.querySelector('[data-scroll-download]')).toBeNull();
  expect(hero.textContent).not.toContain('Also on');
  const betaLink = hero.querySelector('a.home-beta-link');
  expect(betaLink.href).toBe('https://testflight.apple.com/join/qttCCWSb');
  expect(betaLink.textContent).toContain('Try the beta via TestFlight');
});

it.each(['Android', 'Macintosh', 'Windows'])('keeps Google Play as the primary download for %s', (userAgent) => {
  const { hero } = renderDownloads(userAgent);
  expect(hero.querySelector('a.home-btn').href).toContain('https://play.google.com/store/apps/details?id=com.foxdebug.acodefree');
  expect(hero.querySelector('[data-scroll-download]').getAttribute('href')).toBe('#download');
  expect(hero.querySelector('.home-beta-link')).toBeNull();
});

it('links every store card, including the App Store', () => {
  const { DownloadOption, STORES } = renderDownloads('iPhone');
  for (const store of [STORES.appStore, STORES.play, STORES.fdroid, STORES.github]) {
    const card = DownloadOption({ store, recommended: store === STORES.appStore });
    expect(card.tagName).toBe('A');
    expect(card.getAttribute('href')).toBe(store.href);
    expect(card.textContent).not.toMatch(/soon|your device/i);
  }
});
