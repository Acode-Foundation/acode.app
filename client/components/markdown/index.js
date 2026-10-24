import './style.scss';
import 'highlight.js/styles/atom-one-dark.css';
import DOMPurify from 'dompurify';
import { Marked, Renderer } from 'marked';
import markedAlert from 'marked-alert';
import markedFootnote from 'marked-footnote';

// Readmes come from uploaded plugin zips, so the HTML must be sanitized before it is shown.
// Same options as the app, plus no forms: a readme on acode.app must not collect input.
const PURIFY_OPTIONS = { FORBID_TAGS: ['style', 'form'] };

/**
 * Renders plugin readmes and changelogs the way the Acode app's plugin page does
 * (markdown-it with GitHub alerts, heading anchors, task lists and footnotes),
 * so a readme looks the same on the website and in the app.
 * @param {object} props
 * @param {string} props.content Markdown source
 * @param {string} [props.className]
 * @returns {HTMLElement}
 */
export default function Markdown({ content, className = '' }) {
  const $md = <div className={`md ${className}`.trim()} innerHTML={renderMarkdown(content)} />;
  handleAnchorLinks($md);
  addCopyButtons($md);
  highlightCode($md);
  return $md;
}

/**
 * @param {string} content
 * @returns {string} sanitized HTML
 */
export function renderMarkdown(content) {
  if (!content) return '';
  return DOMPurify.sanitize(createParser().parse(content), PURIFY_OPTIONS);
}

function createParser() {
  // Heading ids must be unique per document, like markdown-it-anchor's.
  const slugs = new Set();

  return new Marked({ gfm: true }).use(markedAlert(), markedFootnote({ refMarkers: true, footnoteDivider: true }), {
    // markdown-it doesn't link bare URLs by default; <https://…> autolinks still work.
    tokenizer: {
      url() {
        return undefined;
      },
    },
    renderer: {
      heading({ tokens, depth }) {
        const id = uniqueSlug(slugify(plainText(tokens)), slugs);
        return `<h${depth} id="${id}" tabindex="-1">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      list(token) {
        const html = Renderer.prototype.list.call(this, token);
        return token.items.some((item) => item.task) ? html.replace(/^<(ul|ol)/, '<$1 class="contains-task-list"') : html;
      },
      listitem(item) {
        const html = Renderer.prototype.listitem.call(this, item);
        return item.task ? html.replace(/^<li>/, '<li class="task-list-item">') : html;
      },
      checkbox({ checked }) {
        return `<input class="task-list-item-checkbox"${checked ? ' checked=""' : ''} disabled="" type="checkbox"> `;
      },
    },
  });
}

/** Same slugs as the app's markdown-it-anchor setup. */
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function uniqueSlug(slug, slugs) {
  let unique = slug;
  for (let i = 1; slugs.has(unique); i++) unique = `${slug}-${i}`;
  slugs.add(unique);
  return unique;
}

/** Text and inline code of a heading, which is what markdown-it-anchor slugs. */
function plainText(tokens = []) {
  let text = '';
  for (const token of tokens) {
    if (token.type === 'image' || token.type === 'html') continue;
    if (token.tokens) text += plainText(token.tokens);
    else if (['text', 'codespan', 'escape'].includes(token.type)) text += token.text;
  }
  return text;
}

/** In-page links scroll to their heading or footnote instead of changing the URL. */
function handleAnchorLinks($md) {
  for (const link of $md.querySelectorAll("a[href^='#']")) {
    link.addEventListener('click', (e) => {
      const id = decodeHash(link.getAttribute('href').slice(1));
      const target = $md.querySelector(`[name="${CSS.escape(id)}"]`) || $md.querySelector(`#${CSS.escape(id)}`);
      if (!target) return;

      e.preventDefault();
      target.style.scrollMarginTop = `${document.querySelector('header')?.offsetHeight || 0}px`;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function decodeHash(hash) {
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

function addCopyButtons($md) {
  for (const pre of $md.querySelectorAll('pre')) {
    const copyButton = (
      <button type='button' className='copy-button'>
        Copy
      </button>
    );
    copyButton.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.textContent || pre.textContent;
      try {
        await navigator.clipboard.writeText(code);
        copyButton.textContent = 'Copied!';
      } catch {
        copyButton.textContent = 'Failed to copy';
      }
      setTimeout(() => {
        copyButton.textContent = 'Copy';
      }, 2000);
    });
    pre.append(copyButton);
  }
}

function highlightCode($md) {
  // Like the app, only code blocks that name their language are highlighted.
  const codeBlocks = $md.querySelectorAll("pre code[class*='language-']");
  if (!codeBlocks.length) return;

  // Syntax highlighting should not hold the plugin content behind its large
  // language bundle. Keep the readable code visible while it loads.
  import('highlight.js')
    .then(({ default: highlighter }) => {
      for (const code of codeBlocks) highlighter.highlightElement(code);
    })
    .catch((error) => console.error('Failed to load syntax highlighting:', error));
}
