import './style.scss';

import Ref from 'html-tag-js/ref';
import { hideLoading, showLoading } from 'lib/helpers';
import Router from 'lib/Router';

/**
 *
 * @param {object} param0
 * @param {string[]|string[][]} param0.docs
 * @param {string} param0.doc
 * @param {string} param0.base
 * @param {string} title
 * @param {() => (string|Promise<string>)} param0.load
 * @returns
 */
export default function Docs({
  docs, doc, base, load, title,
}) {
  if (!docs) return <div className='error'>No list provided</div>;
  if (!doc) return <div className='error'>No doc provided</div>;
  if (!base) return <div className='error'>No base provided</div>;
  if (!load) return <div className='error'>No load function provided</div>;

  const article = new Ref();
  const heading = new Ref();
  const nav = new Ref();

  if (!title) title = getTitle(doc);

  loadDoc(doc, title);
  return <section className='docs-container'>
    <input type='checkbox' id='doc-nav' checked={!(window.innerWidth < 600)} hidden />
    <label htmlFor='doc-nav' className='mask'></label>
    <nav ref={nav} className='side-nav'>
      <Links links={docs} currentDoc={doc} />
    </nav>
    <div className='doc-body'>
      <div className='doc-header'>
        <label htmlFor='doc-nav' className='icon menu'></label>
        <h1 ref={heading}></h1>
      </div>
      <article ref={article} className='doc'></article>
    </div>
  </section>;

  function Links({ links, parent, currentDoc }) {
    const ul = new Ref();

    links.forEach((link, i) => {
      if (Array.isArray(link)) return;

      const nextLink = links[i + 1];
      if (Array.isArray(nextLink)) {
        ul.append(
          <li>
            <details open={nextLink.map((l) => l.toLowerCase()).includes(currentDoc)} className='link'>
              <summary>{getTitle(link)}</summary>
              <Links links={nextLink} parent={link} currentDoc={currentDoc} />
            </details>
          </li>,
        );
        return;
      }

      const headingText = getHeadingText(parent, link);
      const href = `${base}/${link.toLowerCase()}?title=${headingText}`;
      ul.append(<li className={currentDoc === link.toLowerCase() ? 'active' : ''}><a onclick={onclick} href={href}>{getTitle(link)}</a></li>);

      /**
       * On link click
       * @param {MouseEvent} e
       */
      function onclick(e) {
        e.preventDefault();
        e.stopPropagation();
        loadDoc(link, headingText);
        nav.el.get('li.active').classList?.remove('active');
        nav.el.parentElement.classList?.add('active');
        const url = e.target.href;
        Router.setUrl(url);
      }
    });

    return <ul ref={ul}></ul>;
  }

  async function loadDoc(docName, headingText) {
    try {
      showLoading();
      const content = load(docName);
      if (content instanceof Promise) {
        article.innerHTML = await content;
      } else {
        article.innerHTML = content;
      }

      heading.textContent = headingText;
    } catch (error) {
      article.innerHTML = `<h1>404</h1> <p class="error" >${error.message}</p>`;
    } finally {
      article.el.parentElement.scrollTop = 0;
      hideLoading();
    }
  }

  function getTitle(docName) {
    if (!docName) return '';
    return docName.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }

  function getHeadingText(parent, docName) {
    return [getTitle(parent), getTitle(docName)].filter(Boolean).join(' - ');
  }
}
