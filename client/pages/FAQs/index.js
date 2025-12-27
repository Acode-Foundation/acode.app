import './style.scss';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import Input from 'components/input';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser, hashString } from 'lib/helpers';
import Router from 'lib/Router';
import { marked } from 'marked';

export default async function FAQs({ mode, oldQ, a, qHash }) {
  const isUpdate = mode === 'update';
  const loggedInUser = await getLoggedInUser();
  const res = await fetch('/api/faqs');
  const faqs = await res.json();
  const isAdmin = !!loggedInUser?.isAdmin;
  const form = Ref();

  if (isUpdate) {
    form.on('ref', (el) => {
      setTimeout(() => {
        el.scrollIntoView();
      }, 0);
    });
  } else if (qHash) {
    setTimeout(() => {
      const el = document.getElementById(qHash);
      el.scrollIntoView();
    }, 0);
  }

  return (
    <section id='faqs'>
      <div className='faqs-header'>
        <h1>Frequently Asked Questions</h1>
        <p className='header-subtitle'>Find answers to common questions about Acode</p>
      </div>
      <FAQForm />
      <div className='faqs-container'>
        <FAQsContainer />
      </div>
    </section>
  );

  function FAQsContainer() {
    return faqs.map(({ q, a: ans }, index) => <FAQ q={q} a={ans} index={index} />);
  }

  function FAQForm() {
    if (!isAdmin) return <div />;

    const method = isUpdate ? 'put' : 'post';
    const mdPreview = Ref();
    const q = Ref();

    mdPreview.innerHTML = marked.parse(a || '');

    return (
      <details open={isUpdate} className='faq-form-container'>
        <summary className='form-toggle'>
          <span className='icon add' />
          {isUpdate ? 'Update FAQ' : 'Add New FAQ'}
        </summary>
        <AjaxForm ref={form} onerror={onerror} onloadend={onloadend} action='/api/faqs' method={method}>
          {isUpdate ? <Input name='old_q' required={true} hidden type='hidden' value={oldQ || ''} /> : ''}
          <Input ref={q} name='q' required={true} label='Question' placeholder='Enter your question' value={oldQ || ''} />
          <Input
            name='a'
            required={true}
            onkeydown={onkeydown}
            oninput={oninput}
            label='Answer'
            type='textarea'
            placeholder='Answer (Markdown supported)'
            value={a || ''}
          />
          <div className='preview' ref={mdPreview} />
          <div className='buttons'>
            <button type='submit' className='btn-primary'>
              <span className='icon done' />
              Submit
            </button>
            {isUpdate ? (
              <button className='btn-danger' type='button' onclick={() => Router.reload()}>
                <span className='icon clear' />
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

  function FAQ({ q, a: ans, index }) {
    const id = hashString(q);
    return (
      <div className='faq-card'>
        <div className='faq-number'>{String(index + 1).padStart(2, '0')}</div>
        <div className='faq-content'>
          <a href={`/faqs/${id}`} className='faq-link'>
            <h2 id={id}>{q}</h2>
          </a>
          <div className='faq-answer' innerHTML={marked.parse(ans)} />
          {isAdmin && (
            <div className='faq-actions'>
              <button type='button' onclick={() => editFaq(q, ans)} title='Edit this FAQ' className='action-btn btn-edit'>
                <span className='icon create' />
                Edit
              </button>
              <button type='button' onclick={() => deleteFaq(q)} title='Delete this FAQ' className='action-btn btn-delete'>
                <span className='icon delete' />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  function editFaq(q, ans) {
    Router.reload({ mode: 'update', oldQ: q, a: ans });
  }

  async function deleteFaq(q) {
    try {
      const confirmation = await confirm('Warning', `Delete FAQ "${q}"?`);
      if (!confirmation) return;
      const faqRes = await fetch(`/api/faqs/${q}`, { method: 'delete' });
      if (faqRes.error) throw new Error(faqRes.error);
      Router.reload();
    } catch (error) {
      alert('Error', error.message);
    }
  }
}
