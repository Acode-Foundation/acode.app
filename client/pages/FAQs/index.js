import './style.scss';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import Input from 'components/input';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser, hashString } from 'lib/helpers';
import Router from 'lib/Router';
import { marked } from 'marked';

export default async function FAQs({ mode, oldQ, a, qHash, oldCategory }) {
  const isUpdate = mode === 'update';
  const loggedInUser = await getLoggedInUser();
  const isAdmin = !!loggedInUser?.isAdmin;
  const form = Ref();
  const categoriesContainer = Ref();
  const searchCount = Reactive('');
  let searchTimeout;
  let currentSearch = '';

  const res = await fetch('/api/faqs?categories=1');
  const categories = await res.json();

  if (isUpdate) {
    form.on('ref', (el) => {
      setTimeout(() => el.scrollIntoView(), 0);
    });
  } else if (qHash) {
    setTimeout(() => {
      const el = document.getElementById(qHash);
      if (el) el.scrollIntoView();
      else {
        const details = document.querySelector(`#faqs-${qHash}`);
        if (details) {
          details.open = true;
          details.scrollIntoView();
        }
      }
    }, 200);
  }

  return (
    <section id='faqs'>
      <h1>Frequently Asked Questions</h1>
      <div className='faq-search'>
        <Input type='search' name='faq-search' placeholder='Search 150+ FAQs...' label='Search' oninput={handleSearch} />
        <span className='search-count'>{searchCount}</span>
      </div>
      {isAdmin ? <FAQForm /> : <div />}
      <div className='faq-categories' ref={categoriesContainer}>
        {categories.map(renderCategory)}
      </div>
    </section>
  );

  function handleSearch(e) {
    clearTimeout(searchTimeout);
    const term = e.target.value.trim().toLowerCase();
    searchTimeout = setTimeout(() => {
      currentSearch = term;
      if (!term) {
        searchCount.value = '';
        categoriesContainer.el.content = categories.map(renderCategory);
        return;
      }
      const filteredCategories = categories
        .map((cat) => ({
          ...cat,
          faqs: cat.faqs.filter((f) => f.q.toLowerCase().includes(term) || f.a.toLowerCase().includes(term)),
        }))
        .filter((cat) => cat.faqs.length > 0);
      const total = filteredCategories.reduce((sum, c) => sum + c.faqs.length, 0);
      searchCount.value = `${total} result${total !== 1 ? 's' : ''} found`;
      categoriesContainer.el.content = filteredCategories.map((cat) => renderCategory(cat, true));
    }, 300);
  }

  function renderCategory(cat, forceOpen) {
    const isOpen = forceOpen || !currentSearch;
    return (
      <details className='faq-category' open={isOpen}>
        <summary className='category-header'>
          <span className='category-name'>{cat.name}</span>
          <span className='category-count'>{cat.faqs.length}</span>
        </summary>
        <div className='category-faqs'>
          <p className='category-desc'>{cat.description}</p>
          {cat.faqs.map((faq) => (
            <FAQ q={faq.q} a={faq.a} categoryId={cat.id} />
          ))}
        </div>
      </details>
    );
  }

  function FAQForm() {
    if (!isAdmin) return <div />;

    const method = isUpdate ? 'put' : 'post';
    const mdPreview = Ref();
    const q = Ref();

    mdPreview.innerHTML = marked.parse(a || '');

    return (
      <details className='admin-form' open={isUpdate}>
        <summary>{isUpdate ? 'Update FAQ' : 'Add FAQ'}</summary>
        <AjaxForm ref={form} onerror={onerror} onloadend={onloadend} action='/api/faqs' method={method}>
          {isUpdate ? <Input name='old_q' required={true} hidden type='hidden' value={oldQ || ''} /> : ''}
          <Input inputRef={q} name='q' required={true} label='Question' placeholder='Question' value={oldQ || ''} />
          <Input
            name='a'
            required={true}
            onkeydown={onkeydown}
            oninput={oninput}
            label='Answer'
            type='textarea'
            placeholder='Answer (Markdown)'
            value={a || ''}
          />
          <div className='row'>
            <select name='category' className='category-select'>
              {categories.map((cat) => (
                <option value={cat.id} selected={cat.id === oldCategory}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
          <div className='preview' ref={mdPreview} />
          <div className='buttons'>
            <button type='submit'>Submit</button>
            {isUpdate ? (
              <button className='danger' type='button' onclick={() => Router.reload()}>
                Cancel
              </button>
            ) : (
              ''
            )}
          </div>
        </AjaxForm>
      </details>
    );

    function onerror(err) {
      alert('Error', err.message);
    }

    function onloadend() {
      if (method === 'put') {
        const url = `/faqs/${hashString(q.value)}`;
        if (window.location.pathname !== url) Router.loadUrl(url);
        else Router.reload();
        alert('Success', 'FAQ updated successfully');
      } else {
        Router.reload();
        alert('Success', 'FAQ added successfully');
      }
    }

    function oninput(e) {
      mdPreview.innerHTML = marked.parse(e.target.value);
    }

    function onkeydown(e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = e.target.selectionStart;
        const end = e.target.selectionEnd;
        e.target.value = `${e.target.value.substring(0, start)}  ${e.target.value.substring(end)}`;
        e.target.selectionStart = start + 1;
        e.target.selectionEnd = start + 1;
      }
    }
  }

  function FAQ({ q, a: ans, categoryId }) {
    const id = hashString(q);
    return (
      <div className='faq' id={`faqs-${id}`}>
        <a
          href={`/faqs/${id}`}
          onclick={(e) => {
            if (!e.target.closest('.icon-buttons')) return;
            e.preventDefault();
          }}
        >
          <h2 id={id}>{q}</h2>
        </a>
        <div className='faq-answer' innerHTML={marked.parse(ans)} />
        {isAdmin ? (
          <div className='icon-buttons'>
            <span onclick={() => editFaq(q, ans, categoryId)} title='Edit this FAQ' className='link icon create' />
            <span onclick={() => deleteFaq(q)} title='Delete this FAQ' className='link icon delete danger' />
          </div>
        ) : (
          ''
        )}
      </div>
    );
  }

  function editFaq(q, ans, categoryId) {
    Router.reload({ mode: 'update', oldQ: q, a: ans, oldCategory: categoryId });
  }

  async function deleteFaq(q) {
    try {
      const confirmation = await confirm('Warning', `Delete FAQ "${q.substring(0, 60)}..."?`);
      if (!confirmation) return;
      const faqRes = await fetch(`/api/faqs?q=${encodeURIComponent(q)}`, { method: 'delete' });
      if (!faqRes.ok) {
        const err = await faqRes.json();
        throw new Error(err.error || 'Delete failed');
      }
      Router.reload();
    } catch (error) {
      alert('Error', error.message);
    }
  }
}
