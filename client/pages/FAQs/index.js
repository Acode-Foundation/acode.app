import './style.scss';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import Input from 'components/input';
import Tabs from 'components/tabs';
import Ref from 'html-tag-js/ref';
import { isIOSSource } from 'lib/appSource';
import { getLoggedInUser, hashString } from 'lib/helpers';
import { handleAnchorLinks, renderMarkdown } from 'lib/markdown';
import Router from 'lib/Router';
import { CHECKS, SIGNALS, WEIGHTS } from '../../../shared/verification';

const platformLabels = { both: 'Both', android: 'Android', ios: 'iOS' };

export default async function FAQs({ mode, oldQ, a, qHash, oldCategory, oldPlatform = 'both' }) {
  const isUpdate = mode === 'update';
  const loggedInUser = await getLoggedInUser();
  const isAdmin = !!loggedInUser?.isAdmin;
  const form = Ref();
  const fromIOS = isIOSSource();
  let selectedPlatform = fromIOS ? 'ios' : '';
  let selectedCategory = '';
  let currentSearch = '';
  let searchTimeout;

  // The website keeps all FAQs for instant platform switching; native apps use the API filter.
  const res = await fetch('/api/faqs?categories=1');
  const stored = await res.json().catch(() => []);
  const categories = [...(Array.isArray(stored) ? stored : []), verifiedCategory()];

  const linkedFaq = qHash && categories.flatMap((category) => category.faqs).find((faq) => hashString(faq.q) === qHash);
  // An explicit FAQ link takes precedence over the default platform filter.
  if (['ios', 'android'].includes(linkedFaq?.platform)) selectedPlatform = linkedFaq.platform;

  const searchInput = (
    <input type='search' name='faq-search' placeholder='Search questions' aria-label='Search FAQs' autocomplete='off' oninput={handleSearch} />
  );
  const status = <p className='faq-status' role='status' />;
  const list = <div className='faq-list' />;
  const chips = <nav className='faq-chips' aria-label='Topics' />;
  const platformFilters = (
    <div className='faq-platform-filters' role='group' aria-label='Filter by platform'>
      {['ios', 'android'].map((platform) => (
        <button type='button' data-platform={platform} aria-pressed={String(selectedPlatform === platform)} onclick={() => togglePlatform(platform)}>
          {platformLabels[platform]}
        </button>
      ))}
    </div>
  );

  const onKeydown = (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    searchInput.focus();
  };
  document.addEventListener('keydown', onKeydown);
  const offNavigate = () => {
    document.removeEventListener('keydown', onKeydown);
    Router.off('navigate', offNavigate);
  };
  Router.on('navigate', offNavigate);

  if (isUpdate) {
    form.on('ref', (el) => setTimeout(() => el.scrollIntoView(), 0));
  }

  const faqForm = isAdmin ? await FAQForm() : null;
  render();
  if (linkedFaq) {
    setTimeout(() => {
      const item = list.querySelector(`#faqs-${qHash}`);
      if (!item) return;
      item.open = true;
      item.scrollIntoView({ block: 'start' });
    }, 100);
  }

  return (
    <section id='faqs'>
      <div className='faq-hero'>
        <p className='faq-eyebrow'>Help center</p>
        <h1>How can we help?</h1>
        <p className='faq-lede'>Quick answers about the editor, terminal, plugins and publishing.</p>
        <div className='faq-toolbar'>
          <label className='faq-search'>
            <span className='icon search' aria-hidden='true' />
            {searchInput}
            <span className='faq-kbd' aria-hidden='true'>
              /
            </span>
          </label>
          {fromIOS ? null : platformFilters}
        </div>
      </div>
      {chips}
      {faqForm}
      {status}
      {list}
      <aside className='faq-help'>
        <div>
          <h2>Still stuck?</h2>
          <p>Ask the community or reach us directly.</p>
        </div>
        <nav>
          <a href='https://discord.gg/vVxVWYUAWD' target='_blank' rel='noreferrer'>
            Discord
          </a>
          <a href='https://t.me/foxdebug_acode' target='_blank' rel='noreferrer'>
            Telegram
          </a>
          <a href='https://github.com/acode-foundation/acode/issues' target='_blank' rel='noreferrer'>
            GitHub issues
          </a>
          <a href='/contact'>Contact us</a>
        </nav>
      </aside>
    </section>
  );

  function handleSearch(e) {
    clearTimeout(searchTimeout);
    currentSearch = e.target.value.trim().toLowerCase();
    searchTimeout = setTimeout(render, 200);
  }

  function togglePlatform(platform) {
    selectedPlatform = selectedPlatform === platform ? '' : platform;
    for (const button of platformFilters.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.platform === selectedPlatform));
    }
    render();
  }

  function selectCategory(id) {
    selectedCategory = selectedCategory === id ? '' : id;
    render();
  }

  function matches(faq) {
    const platformOk = !selectedPlatform || !faq.platform || faq.platform === 'both' || faq.platform === selectedPlatform;
    return platformOk && (!currentSearch || `${faq.q}\n${faq.a}`.toLowerCase().includes(currentSearch));
  }

  function render() {
    const visible = categories.map((category) => ({ ...category, faqs: category.faqs.filter(matches) }));
    // A search can empty the selected topic; fall back to all topics rather than showing nothing.
    if (selectedCategory && !visible.some((category) => category.id === selectedCategory && category.faqs.length)) selectedCategory = '';

    chips.replaceChildren(
      <button type='button' aria-pressed={String(!selectedCategory)} onclick={() => selectCategory('')}>
        All
      </button>,
      ...visible
        .filter((category) => category.faqs.length)
        .map((category) => (
          <button type='button' aria-pressed={String(selectedCategory === category.id)} onclick={() => selectCategory(category.id)}>
            {category.name}
            <span>{category.faqs.length}</span>
          </button>
        )),
    );

    const shown = visible.filter((category) => category.faqs.length && (!selectedCategory || category.id === selectedCategory));
    const total = shown.reduce((sum, category) => sum + category.faqs.length, 0);
    status.textContent = currentSearch || selectedPlatform ? `${total} result${total === 1 ? '' : 's'}` : '';

    if (!total) {
      list.replaceChildren(
        <div className='faq-no-results'>
          <p>No answers match “{currentSearch || 'these filters'}”.</p>
          <p className='muted'>Try fewer words, or ask in the community below.</p>
        </div>,
      );
      return;
    }
    list.replaceChildren(
      ...shown.map((category) => (
        <div className='faq-group' id={`topic-${category.id}`}>
          <div className='faq-group-head'>
            <h2>{category.name}</h2>
            {category.description && <p>{category.description}</p>}
          </div>
          {category.faqs.map((faq) => (
            <FAQ faq={faq} category={category} open={!!currentSearch && total <= 5} />
          ))}
        </div>
      )),
    );
  }

  function FAQ({ faq, category, open }) {
    const id = hashString(faq.q);
    const platform = faq.platform || 'both';
    const answer = <div className='faq-answer' innerHTML={renderAnswer(faq.a)} />;
    handleAnchorLinks(answer);
    const item = (
      <details className='faq-item' id={`faqs-${id}`} open={open}>
        <summary>
          <h3 id={id}>{faq.q}</h3>
          <span className='icon keyboard_arrow_down' aria-hidden='true' />
        </summary>
        {answer}
        <div className='faq-actions'>
          <button type='button' className='faq-copy' onclick={copyLink}>
            <span className='icon link' aria-hidden='true' />
            Copy link
          </button>
          {isAdmin && !category.builtin ? (
            <>
              <span className='faq-platform'>{platformLabels[platform]}</span>
              <button type='button' onclick={() => editFaq(faq.q, faq.a, category.id, platform)} title='Edit this FAQ' aria-label={`Edit ${faq.q}`}>
                <span className='icon create' aria-hidden='true' />
                Edit
              </button>
              <button type='button' onclick={() => deleteFaq(faq.q)} aria-label={`Delete ${faq.q}`} className='faq-delete'>
                <span className='icon delete' aria-hidden='true' />
              </button>
            </>
          ) : null}
        </div>
      </details>
    );
    return item;

    async function copyLink(e) {
      const button = e.currentTarget;
      try {
        await navigator.clipboard.writeText(`${location.origin}/faqs/${id}`);
        button.lastChild.textContent = 'Copied';
      } catch {
        button.lastChild.textContent = 'Copy failed';
      }
      setTimeout(() => {
        button.lastChild.textContent = 'Copy link';
      }, 1500);
    }
  }

  async function FAQForm() {
    const editable = categories.filter((category) => !category.builtin);
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
                {editable.map((cat) => (
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

/**
 * Built from the same rules the server scores with, so the explanation can't
 * drift from what actually earns the badge. Not editable from the admin form.
 */
function verifiedCategory() {
  const points = Object.entries(SIGNALS)
    .map(([key, { label, hint }]) => `- **${label}, up to ${WEIGHTS[key]} points.** ${hint}`)
    .join('\n');
  const checklist = Object.values(CHECKS)
    .map((check) => `- ${check}`)
    .join('\n');
  return {
    id: 'verified-developers',
    name: 'Verified developers',
    description: 'What the blue tick means and how to earn it.',
    builtin: true,
    faqs: [
      {
        q: 'What does the blue tick next to a developer mean?',
        a: 'It marks a plugin developer with a track record: plugins people actually use and rate well, kept up to date, and no security problems. Verified developers also rank a little higher in plugin search.',
      },
      {
        q: 'How do I get the verified badge?',
        a: `There's nothing to apply for. We regularly review the highest-ranked developers who meet all of these:\n\n${checklist}\n\nMeeting them makes you eligible, not automatically verified. Every badge is a human decision.`,
      },
      {
        q: 'How is my developer score calculated?',
        a: `Your score is out of 100 and is used to rank developers for review:\n\n${points}\n\nSecurity strikes take points away: an upload blocked by the security scanner or an update rejected in review costs 15 points for a year, and each rejected plugin costs 3.`,
      },
      {
        q: 'Will buying downloads or reviews help?',
        a: "No. Downloads are counted once per device and weighed by how many different users they come from, and votes from throwaway accounts don't count toward your rating. Inflated numbers are easy to spot, and they can cost you the badge for good. The fastest route is a plugin people recommend and replying to their reviews.",
      },
      {
        q: 'Can I lose the badge?',
        a: "Yes. We may remove it after a security issue, a long stretch without updates on plugins people depend on, or any attempt to game downloads or reviews. If you think we got it wrong, [contact us](/contact) and we'll take another look.",
      },
    ],
  };
}

/** FAQ answers keep GitHub-style links for plain URLs. */
function renderAnswer(answer) {
  return renderMarkdown(answer || '', { linkBareUrls: true });
}
