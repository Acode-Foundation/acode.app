import './style.scss';
import 'highlight.js/styles/atom-one-dark.css';
import { handleAnchorLinks, renderMarkdown } from 'lib/markdown';

/**
 * Plugin readme or changelog, rendered and styled like the Acode app's plugin page.
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

function addCopyButtons($md) {
  for (const pre of $md.querySelectorAll('pre')) {
    const copyButton = (
      <button type='button' className='copy-button'>
        Copy
      </button>
    );
    copyButton.addEventListener('click', async () => {
      // The button sits inside the <pre>, so leave its label out of raw HTML blocks.
      const code =
        pre.querySelector('code')?.textContent ??
        Array.from(pre.childNodes)
          .filter((node) => node !== copyButton)
          .map((node) => node.textContent)
          .join('');
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
