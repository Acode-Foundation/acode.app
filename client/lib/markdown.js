import DOMPurify from 'dompurify';
import { Marked, Renderer } from 'marked';
import markedAlert from 'marked-alert';
import markedFootnote from 'marked-footnote';

// Readmes come from uploaded plugin zips, so the HTML must be sanitized before it is shown.
// Same options as the app, plus no forms: a readme on acode.app must not collect input.
const PURIFY_OPTIONS = { FORBID_TAGS: ['style', 'form'] };

/**
 * Renders markdown the way the Acode app's plugin page does (markdown-it with
 * GitHub alerts, heading anchors, task lists and footnotes), so a readme looks
 * the same on the website and in the app.
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
