// @vitest-environment jsdom

import { suppressAdIntents } from '../../client/lib/cookieConsent';

let stop;
afterEach(() => {
  stop?.();
  document.body.replaceChildren();
});

it('excludes plugin cards, headers and titles while keeping descriptions and display ads eligible', () => {
  document.body.innerHTML = `
    <a class="plugin"><h2>Terminal Pro</h2><p>acode.terminal.pro · 1.1.3</p></a>
    <div class="plugin-head"><strong>Terminal Pro</strong></div>
    <h1>Plugins</h1><div role="heading">Featured</div><span class="title">Popular</span>
    <div class="page-title">Details</div><div class="plugin-title">Plugin name</div>
    <article><h3>Installation</h3><p id="description">Plugin description</p></article>
    <div data-acode-ad><h2>Ad heading</h2><a class="plugin">Ad link</a></div>
    <ins class="adsbygoogle"><h3>Ad title</h3></ins>`;

  stop = suppressAdIntents(document.body);

  expect(document.querySelectorAll('.google-anno-skip')).toHaveLength(9);
  expect(document.querySelector('a.plugin').classList.contains('google-anno-skip')).toBe(true);
  expect(document.querySelector('#description').closest('.google-anno-skip')).toBeNull();
  expect(document.querySelector('[data-acode-ad] .google-anno-skip')).toBeNull();
  expect(document.querySelector('.adsbygoogle .google-anno-skip')).toBeNull();
  expect(document.body.classList.contains('google-anno-skip')).toBe(false);
});

it('protects newly loaded cards and headings after navigation, and disconnects cleanly', async () => {
  stop = suppressAdIntents(document.body);
  const section = document.createElement('section');
  section.innerHTML = '<a class="plugin"><h2>New plugin</h2></a><h4>Details</h4><h5>Options</h5><h6>Notes</h6>';
  const heading = document.createElement('h1');
  document.body.append(section, heading);
  await Promise.resolve();

  expect(section.querySelectorAll('.google-anno-skip')).toHaveLength(5);
  expect(heading.classList.contains('google-anno-skip')).toBe(true);

  stop();
  const unobserved = document.createElement('h2');
  document.body.append(unobserved);
  await Promise.resolve();
  expect(unobserved.classList.contains('google-anno-skip')).toBe(false);
});
