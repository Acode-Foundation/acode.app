import './style.scss';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import Input from 'components/input';
import Tabs from 'components/tabs';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { isIOSSource } from 'lib/appSource';
import { getLoggedInUser, hashString } from 'lib/helpers';
import { handleAnchorLinks, renderMarkdown } from 'lib/markdown';
import Router from 'lib/Router';

const platformLabels = { both: 'Both', android: 'Android', ios: 'iOS' };

export default async function FAQs({ mode, oldQ, a, qHash, oldCategory, oldPlatform = 'both' }) {
  const isUpdate = mode === 'update';
  const loggedInUser = await getLoggedInUser();
  const isAdmin = !!loggedInUser?.isAdmin;
  const form = Ref();
  const categoriesContainer = Ref();
  const searchCount = Reactive('');
  let searchTimeout;
  let currentSearch = '';
  const fromIOS = isIOSSource();
  let selectedPlatform = fromIOS ? 'ios' : '';
  // The website keeps all FAQs for instant platform switching; native apps use the API filter.
  const res = await fetch('/api/faqs?categories=1');
  const categories = await res.json();
  if (qHash) {
    const linkedFaq = categories.flatMap((category) => category.faqs).find((faq) => hashString(faq.q) === qHash);
    // An explicit FAQ link takes precedence over the default platform filter.
    if (['ios', 'android'].includes(linkedFaq?.platform)) selectedPlatform = linkedFaq.platform;
  }
  const platformFilters = (
    <div className='faq-platform-filters' role='group' aria-label='Filter FAQs by platform'>
      {['ios', 'android'].map((platform) => (
        <button type='button' data-platform={platform} aria-pressed={String(selectedPlatform === platform)} onclick={() => togglePlatform(platform)}>
          {platformLabels[platform]}
        </button>
      ))}
    </div>
  );

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

  const faqForm = isAdmin ? await FAQForm() : null;

  return (
    <section id='faqs'>
      <h1>Frequently Asked Questions</h1>
      <div className='faq-search'>
        <div className='faq-search-controls'>
          <Input type='search' name='faq-search' placeholder='Search FAQs…' label='Search FAQs' oninput={handleSearch} />
          {fromIOS ? null : platformFilters}
        </div>
        {fromIOS ? null : <span className='search-count'>{searchCount}</span>}
      </div>
      {faqForm}
      <div className='faq-categories' ref={categoriesContainer}>
        {filteredResults()}
      </div>
    </section>
  );

  function handleSearch(e) {
    clearTimeout(searchTimeout);
    currentSearch = e.target.value.trim().toLowerCase();
    searchTimeout = setTimeout(refreshResults, 300);
  }

  function togglePlatform(platform) {
    selectedPlatform = selectedPlatform === platform ? '' : platform;
    for (const button of platformFilters.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.platform === selectedPlatform));
    }
    clearTimeout(searchTimeout);
    refreshResults();
  }

  function refreshResults() {
    categoriesContainer.el.replaceChildren(...filteredResults());
  }

  function filteredResults() {
    const filtered = categories
      .map((category) => ({
        ...category,
        faqs: category.faqs.filter(
          (faq) =>
            (!selectedPlatform || !faq.platform || faq.platform === 'both' || faq.platform === selectedPlatform) &&
            `${faq.q}\n${faq.a}`.toLowerCase().includes(currentSearch),
        ),
      }))
      .filter((category) => category.faqs.length);
    const total = filtered.reduce((sum, category) => sum + category.faqs.length, 0);
    searchCount.value = selectedPlatform || currentSearch ? `${total} result${total !== 1 ? 's' : ''} found` : '';
    return total
      ? filtered.map((category) => renderCategory(category, !!currentSearch))
      : [
          <p className='faq-no-results' role='status'>
            No FAQs match your filters.
          </p>,
        ];
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
            <FAQ q={faq.q} a={faq.a} categoryId={cat.id} platform={faq.platform || 'both'} />
          ))}
        </div>
      </details>
    );
  }

  async function FAQForm() {
    const method = isUpdate ? 'put' : 'post';
    const q = Ref();
    const answer = <textarea name='a' required aria-label='Answer in Markdown' placeholder='Write your answer in Markdown…' value={a || ''} />;
    const preview = <div className='faq-answer faq-preview' role='tabpanel' id='faq-preview' aria-labelledby='faq-tab-preview' hidden />;
    handleAnchorLinks(preview);
    // Keep the textarea in the form when previewing so its value is submitted.
    const tabs = await Tabs({
      variant: 'underline',
      className: 'faq-editor-tabs',
      tabs: [
        { id: 'edit', label: 'Edit' },
        { id: 'preview', label: 'Preview' },
      ],
      onChange: showPanel,
    });
    const edit = (
      <div role='tabpanel' id='faq-edit' aria-labelledby='faq-tab-edit'>
        {answer}
      </div>
    );
    for (const tab of tabs.querySelectorAll('[role=tab]')) {
      tab.id = `faq-tab-${tab.dataset.tab}`;
      tab.setAttribute('aria-controls', `faq-${tab.dataset.tab}`);
      tab.tabIndex = tab.dataset.tab === 'edit' ? 0 : -1;
      tab.onkeydown = (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let next = tab.dataset.tab === 'edit' ? 'preview' : 'edit';
        if (event.key === 'Home') next = 'edit';
        if (event.key === 'End') next = 'preview';
        const target = tabs.querySelector(`[data-tab=${next}]`);
        target.click();
        target.focus();
      };
    }
    answer.oninvalid = () => tabs.querySelector('[data-tab=edit]').click();

    return (
      <details className='admin-form' open={isUpdate}>
        <summary>{isUpdate ? 'Edit FAQ' : 'Add FAQ'}</summary>
        <AjaxForm ref={form} onerror={onerror} onloadend={onloadend} action='/api/faqs' method={method}>
          {isUpdate ? <input name='old_q' type='hidden' value={oldQ || ''} /> : null}
          <div className='faq-options'>
            <label className='faq-field'>
              Category
              <select name='category' className='faq-select'>
                {categories.map((cat) => (
                  <option value={cat.id} selected={cat.id === oldCategory}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className='faq-platform-field'>
              <legend>Platform</legend>
              <div className='faq-platform-toggle'>
                {Object.entries(platformLabels).map(([value, label]) => (
                  <label>
                    <input type='radio' name='platform' value={value} checked={value === oldPlatform} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <Input inputRef={q} name='q' required={true} label='Question' placeholder='What would you like to explain?' value={oldQ || ''} />
          <div className='faq-answer-label'>
            Answer <span>Markdown supported</span>
          </div>
          <div className='faq-editor'>
            {tabs}
            {edit}
            {preview}
          </div>
          <div className='faq-form-actions'>
            {isUpdate ? (
              <button className='faq-cancel' type='button' onclick={() => Router.reload()}>
                Cancel
              </button>
            ) : null}
            <button type='submit'>{isUpdate ? 'Save changes' : 'Add FAQ'}</button>
          </div>
        </AjaxForm>
      </details>
    );

    function showPanel(id) {
      const isPreview = id === 'preview';
      if (isPreview)
        preview.innerHTML = answer.value.trim() ? renderAnswer(answer.value) : '<p class="faq-preview-empty">Nothing to preview yet.</p>';
      edit.hidden = isPreview;
      preview.hidden = !isPreview;
      for (const tab of tabs.querySelectorAll('[role=tab]')) tab.tabIndex = tab.dataset.tab === id ? 0 : -1;
    }

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
  }

  function FAQ({ q, a: ans, categoryId, platform }) {
    const id = hashString(q);
    const $answer = <div className='faq-answer' innerHTML={renderAnswer(ans)} />;
    handleAnchorLinks($answer);
    return (
      <div className='faq' id={`faqs-${id}`}>
        <a href={`/faqs/${id}`}>
          <h2 id={id}>{q}</h2>
        </a>
        {$answer}
        {isAdmin ? (
          <div className='faq-actions'>
            <span className='faq-platform'>{platformLabels[platform]}</span>
            <button type='button' onclick={() => editFaq(q, ans, categoryId, platform)} title='Edit this FAQ' aria-label={`Edit ${q}`}>
              <span className='icon create' aria-hidden='true' />
              Edit
            </button>
            <button type='button' onclick={() => deleteFaq(q)} title='Delete this FAQ' aria-label={`Delete ${q}`} className='faq-delete'>
              <span className='icon delete' aria-hidden='true' />
            </button>
          </div>
        ) : (
          ''
        )}
      </div>
    );
  }

  function editFaq(q, ans, categoryId, platform) {
    Router.reload({ mode: 'update', oldQ: q, a: ans, oldCategory: categoryId, oldPlatform: platform });
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

/** FAQ answers keep GitHub-style links for plain URLs. */
function renderAnswer(answer) {
  return renderMarkdown(answer || '', { linkBareUrls: true });
}
