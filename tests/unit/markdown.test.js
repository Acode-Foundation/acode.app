// @vitest-environment jsdom
import { handleAnchorLinks, renderMarkdown } from '../../client/lib/markdown';

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

it('links bare URLs when asked, still sanitizing the result', () => {
  const $root = document.createElement('div');
  $root.innerHTML = renderMarkdown('See https://example.com and <https://acode.app>.\n\n<img src=x onerror="alert(1)">', { linkBareUrls: true });

  expect([...$root.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://example.com', 'https://acode.app']);
  expect($root.querySelector('[onerror]')).toBeNull();
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

describe('in-page links', () => {
  let scrolled;
  let routed;
  const onBodyClick = () => routed++;

  beforeEach(() => {
    scrolled = [];
    routed = 0;
    // jsdom has neither; the browser provides both.
    globalThis.CSS = { escape: (value) => value.replace(/[^\w-]/g, '\\$&') };
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolled.push(this);
    };
    document.body.addEventListener('click', onBodyClick);
  });

  afterEach(() => {
    document.body.removeEventListener('click', onBodyClick);
    document.body.innerHTML = '';
  });

  function mount(markdown) {
    const $root = render(markdown);
    handleAnchorLinks($root);
    document.body.append($root);
    return $root;
  }

  function click(link) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    return event;
  }

  it('keeps footnote links inside their own document when ids repeat on the page', () => {
    const first = mount('First[^1].\n\n[^1]: First note.');
    const second = mount('Second[^1].\n\n[^1]: Second note.');
    const event = click(second.querySelector('sup a'));

    expect(scrolled).toHaveLength(1);
    expect(second.contains(scrolled[0])).toBe(true);
    expect(first.contains(scrolled[0])).toBe(false);
    expect(scrolled[0].textContent).toContain('Second note.');
    expect(event.defaultPrevented).toBe(true);
    expect(routed).toBe(0);
  });

  it('scrolls a bare # link to the start of its document', () => {
    const $root = mount('# Title\n\n[Back to top](#)');
    click($root.querySelector('a'));
    expect(scrolled).toEqual([$root]);
    expect(routed).toBe(0);
  });

  it('covers content rendered into the same element later', () => {
    const $root = mount('Nothing yet.');
    $root.innerHTML = renderMarkdown('## Later\n\n[Jump](#later)');
    click($root.querySelector('a'));
    expect(scrolled).toEqual([$root.querySelector('#later')]);
  });

  it('leaves links it cannot resolve, and other links, to the page', () => {
    const $root = mount('[Missing](#nowhere) and [Elsewhere](/plugins)');
    const [missing, elsewhere] = $root.querySelectorAll('a');
    expect(click(missing).defaultPrevented).toBe(false);
    elsewhere.addEventListener('click', (e) => e.preventDefault());
    click(elsewhere);
    expect(scrolled).toEqual([]);
    expect(routed).toBe(2);
  });
});
