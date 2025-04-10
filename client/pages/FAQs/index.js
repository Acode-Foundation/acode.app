import './style.scss';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import Input from 'components/input';
import Ref from 'html-tag-js/ref';
import Router from 'lib/Router';
import { getLoggedInUser, hashString } from 'lib/helpers';
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
      <h1>FAQs</h1>
      <FAQForm />
      <FAQsContainer />
    </section>
  );

  function FAQsContainer() {
    return faqs.map(({ q, a: ans }) => <FAQ q={q} a={ans} />);
  }

  function FAQForm() {
    if (!isAdmin) return <div />;

    const method = isUpdate ? 'put' : 'post';
    const mdPreview = Ref();
    const q = Ref();

    mdPreview.innerHTML = marked.parse(a || '');

    return (
      <details open={isUpdate} style={{ margin: '20px 0' }}>
        <summary style={{ margin: '20px 0' }}>{isUpdate ? 'Update' : 'Add'} FAQ</summary>
        <AjaxForm ref={form} onerror={onerror} onloadend={onloadend} action='/api/faqs' method={method}>
          {isUpdate ? <Input name='old_q' required={true} hidden type='hidden' value={oldQ || ''} /> : ''}
          <Input ref={q} name='q' required={true} label='Question' placeholder='Question' value={oldQ || ''} />
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

  function FAQ({ q, a: ans }) {
    const id = hashString(q);
    return (
      <div className='faq'>
        <a href={`/faqs/${id}`} style={{ textDecoration: 'none' }}>
          <h2 id={id} style={{ textAlign: 'left' }}>
            {q}
          </h2>
        </a>
        <p innerHTML={marked.parse(ans)} />
        {isAdmin ? (
          <div className='icon-buttons'>
            <span onclick={() => editFaq(q, ans)} title='Edit this FAQ' className='link icon create' />
            <span onclick={() => deleteFaq(q)} title='Delete this FAQ' className='link icon delete danger' />
          </div>
        ) : (
          ''
        )}
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
