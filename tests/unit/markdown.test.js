// @vitest-environment jsdom
import { renderMarkdown } from '../../client/lib/markdown';

function render(markdown) {
  const $root = document.createElement('div');
  $root.innerHTML = renderMarkdown(markdown);
  return $root;
}

it('renders nothing for empty content', () => {
  expect(renderMarkdown('')).toBe('');
  expect(renderMarkdown(undefined)).toBe('');
});

it('gives headings the same unique ids as the app', () => {
  const $root = render('# Hello **World** `x`\n\n## Usage\n\n## Usage\n\n### A & B ![logo](logo.png)');
  const headings = [...$root.querySelectorAll('h1, h2, h3')];

  expect(headings.map((h) => h.id)).toEqual(['hello-world-x', 'usage', 'usage-1', 'a-b']);
  expect(headings.every((h) => h.getAttribute('tabindex') === '-1')).toBe(true);
  expect($root.querySelector('h1').innerHTML).toBe('Hello <strong>World</strong> <code>x</code>');
});

it('marks checked and unchecked tasks like the app', () => {
  const $root = render('- [x] Done\n- [ ] Todo\n\nBetween lists.\n\n- Plain item');
  const [taskList, plainList] = $root.querySelectorAll('ul');
  const boxes = taskList.querySelectorAll('li.task-list-item > input.task-list-item-checkbox[type="checkbox"][disabled]');

  expect(taskList.classList.contains('contains-task-list')).toBe(true);
  expect([...boxes].map((box) => box.hasAttribute('checked'))).toEqual([true, false]);
  expect(plainList.classList.contains('contains-task-list')).toBe(false);
  expect(plainList.querySelector('li').className).toBe('');
});

it('links footnote references and back references after sanitizing', () => {
  const $root = render('Text[^1].\n\n[^1]: The note.');
  const ref = $root.querySelector('sup a[href^="#"]');
  const note = $root.querySelector(ref.getAttribute('href'));

  expect(ref.textContent).toBe('[1]');
  expect(note.textContent).toContain('The note.');
  expect($root.querySelector(note.querySelector('a[href^="#"]').getAttribute('href'))).toBe(ref);
  expect($root.querySelector('.footnotes .sr-only')).not.toBeNull();
});

it('renders GitHub alerts', () => {
  const $root = render('> [!WARNING]\n> Careful.');
  const alert = $root.querySelector('.markdown-alert.markdown-alert-warning');

  expect(alert.querySelector('.markdown-alert-title').textContent).toBe('Warning');
  expect(alert.querySelector('svg.octicon')).not.toBeNull();
  expect(alert.textContent).toContain('Careful.');
});

it('links <url> autolinks but leaves bare URLs as text, like markdown-it', () => {
  const $root = render('See https://example.com and <https://acode.app>.');

  expect([...$root.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://acode.app']);
  expect($root.textContent).toContain('https://example.com');
});

it('keeps readme HTML but drops scripts, handlers, styles and forms', () => {
  const $root = render(
    [
      '<details><summary>More</summary>Hidden</details>',
      '<p align="center"><img src="logo.png" width="64" onerror="alert(1)"></p>',
      '<script>alert(1)</script>',
      '<a href="javascript:alert(1)">bad link</a>',
      '<svg onload="alert(1)"></svg>',
      '<iframe src="https://example.com"></iframe>',
      '<style>body { display: none }</style>',
      '<form action="https://example.com"><input name="q"></form>',
    ].join('\n'),
  );

  expect($root.querySelector('details summary').textContent).toBe('More');
  expect($root.querySelector('img').getAttribute('src')).toBe('logo.png');
  expect($root.querySelector('script, iframe, style, form')).toBeNull();
  expect($root.querySelector('[onerror], [onload]')).toBeNull();
  expect($root.querySelector('a').hasAttribute('href')).toBe(false);
});
