// @vitest-environment jsdom
import fs from 'node:fs';
import vm from 'node:vm';
import { transformFromAstSync, transformSync, types } from '@babel/core';
import tag from 'html-tag-js';
import { safeSponsorWebsite } from '../../shared/sponsorWebsite';

const cards = ['sponsors', 'home'].map((page) => {
  const { ast } = transformSync(fs.readFileSync(`client/pages/${page}/index.js`, 'utf8'), {
    ast: true,
    code: false,
    configFile: false,
    babelrc: false,
    plugins: ['html-tag-js/jsx/syntax-parser.js'],
  });
  const declarations = ast.program.body.filter((node) => ['renderSponsorCard', 'ensureAbsoluteUrl'].includes(node.id?.name));
  const { code } = transformFromAstSync(types.file(types.program(declarations)), undefined, {
    configFile: false,
    babelrc: false,
    plugins: ['html-tag-js/jsx/jsx-to-tag.js'],
  });
  return [page, vm.runInNewContext(`${code}\nrenderSponsorCard`, { tag, safeSponsorWebsite })];
});

it.each([
  ['example.com/path', 'https://example.com/path'],
  ['example.com:8080/path', 'https://example.com:8080/path'],
  ['localhost:8080/path', 'https://localhost:8080/path'],
  ['LOCALHOST:8080/path', 'https://localhost:8080/path'],
  ['127.0.0.1:8080/path', 'https://127.0.0.1:8080/path'],
  ['[::1]:8080/path', 'https://[::1]:8080/path'],
  ['example.com:99999/path', ''],
  ['example.com:8080@attacker.test/path', ''],
  ['javascript:8080/path', ''],
  ['data:8080/path', ''],
  ['example.:8080/path', ''],
  ['.example:8080/path', 'https://.example:8080/path'],
  [' HTTPS://EXAMPLE.COM/path ', 'https://example.com/path'],
  ['http://example.com:8080/path', 'http://example.com:8080/path'],
  ['//example.com/path', 'https://example.com/path'],
  ['https://acode.app@evil.example', ''],
  ['http://user:password@evil.example', ''],
  ['//acode.app@evil.example', ''],
  ['acode.app@evil.example', ''],
  ['https://%61code.app@evil.example', ''],
  ['https://:password@evil.example', ''],
  ['https://example.com/@user?email=user@example.com', 'https://example.com/@user?email=user@example.com'],
  ['javascript:alert(1)', ''],
  ['java\tscript:alert(1)', ''],
  ['java\nscript:alert(1)', ''],
  ['data:text/html,test', ''],
  ['https://', ''],
  ['https:\\example.com', ''],
  [null, ''],
])('normalizes only safe HTTP sponsor websites (%s)', (value, expected) => {
  expect(safeSponsorWebsite(value)).toBe(expected);
});

it('handles repeated-dot input without a host-port match', () => {
  const value = '!.'.repeat(32768);
  expect(safeSponsorWebsite(value)).toBe(new URL(`https://${value}`).href);
});

it.each(cards)('never renders unsafe stored website links on %s cards', (_page, render) => {
  for (const website of [
    'javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,test',
    'https://acode.app@evil.example',
    '//user:password@evil.example',
  ]) {
    const card = render({ id: 1, name: 'Sponsor', tier: 'gold', website });
    expect(card.matches('a')).toBe(false);
    expect(card.querySelector('a')).toBeNull();
  }
  const card = render({ id: 1, name: 'Sponsor', tier: 'gold', website: 'example.com:8080/path' });
  const links = card.matches('a') ? [card] : [...card.querySelectorAll('a')];
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) expect(link.getAttribute('href')).toBe('https://example.com:8080/path');
});
