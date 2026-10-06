import './style.scss';
import Input from 'components/input';
import Plugins from 'components/plugins';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser, withRedirect } from 'lib/helpers';
import Router from 'lib/Router';

const SORTS = [
  { value: 'popular', label: 'Popular' },
  { value: 'trending', label: 'Trending' },
  { value: 'downloads', label: 'Most downloaded' },
  { value: 'rating', label: 'Top rated' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name (A–Z)' },
];

const EDITORS = [
  { value: '', label: 'Any' },
  { value: 'cm', label: 'CodeMirror' },
  { value: 'ace', label: 'Ace' },
  { value: 'all', label: 'Universal' },
];

const PRICES = [
  { value: '', label: 'Any' },
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
];

const OWNED = { value: 'owned', label: 'Purchased' };

const STATUSES = [
  { value: '', label: 'Any' },
  { value: 'approved', label: 'Approved', code: 1 },
  { value: 'pending', label: 'Pending', code: 0 },
  { value: 'rejected', label: 'Rejected', code: 2 },
  { value: 'deleted', label: 'Deleted', code: 3 },
];

const EDITOR_TITLES = { cm: 'CodeMirror', ace: 'Ace', all: 'Universal' };

export default async function PluginList({ filter, orderBy, editor, price, status, q }) {
  const loggedInUser = await getLoggedInUser();
  if (price === OWNED.value && !loggedInUser) {
    // Purchases belong to an account, so sign in first instead of silently showing every plugin.
    Router.loadUrl(withRedirect('/login', encodeURIComponent(`${location.pathname}${location.search}`)));
    return 'Redirecting...';
  }

  const title = Ref();
  const plugins = Ref();
  const reset = Ref();
  const prices = loggedInUser ? [...PRICES, OWNED] : PRICES;
  const state = {
    q: q || '',
    sort: pick(SORTS, orderBy) || 'popular',
    editor: pick(EDITORS, editor) || '',
    price: pick(prices, price) || '',
    status: loggedInUser?.isAdmin ? pick(STATUSES, status) || '' : '',
  };
  let searchTimeout;
  let renderId = 0;

  // Links shared before the filters were split up used a single `filter` param.
  if (['cm', 'ace', 'all'].includes(filter)) state.editor = filter;
  else if (filter === 'both') state.editor = 'all';
  else if (loggedInUser?.isAdmin && pick(STATUSES, filter)) state.status = filter;

  plugins.onref = () => renderPlugins();

  // A pending search must not rewrite the URL of the page the visitor navigated to.
  const cancelSearch = () => {
    clearTimeout(searchTimeout);
    Router.off('navigate', cancelSearch);
  };
  Router.on('navigate', cancelSearch);

  return (
    <section id='plugins'>
      <div className='plugins-browse'>
        <h1 ref={title}>Plugins</h1>
        <div className='plugins-toolbar'>
          <div className='plugins-toolbar__search'>
            <Input
              oninput={(e) => {
                clearTimeout(searchTimeout);
                // Typing refines the same view, so don't leave a history entry per keystroke.
                searchTimeout = setTimeout(() => update({ q: e.target.value.trim() }, { replace: true }), 400);
              }}
              type='search'
              name='search'
              value={state.q}
              placeholder='e.g. lint, git, markdown...'
              label='Search'
            />
          </div>
          <div className='plugins-toolbar__filters'>
            <FilterSelect label='Sort' options={SORTS} value={state.sort} onchange={(value) => update({ sort: value })} />
            <FilterSelect label='Editor' options={EDITORS} value={state.editor} onchange={(value) => update({ editor: value })} />
            <FilterSelect label='Price' options={prices} value={state.price} onchange={(value) => update({ price: value })} />
            {loggedInUser?.isAdmin && (
              <FilterSelect label='Status' options={STATUSES} value={state.status} onchange={(value) => update({ status: value })} />
            )}
            <button ref={reset} type='button' className='plugins-toolbar__reset' onclick={resetFilters}>
              Reset
            </button>
          </div>
        </div>
      </div>
      <div ref={plugins} className='plugins-container' />
    </section>
  );

  function update(changes, { replace = false } = {}) {
    const changed = Object.entries(changes).some(([key, value]) => state[key] !== value);
    if (!changed) return;
    Object.assign(state, changes);
    updateUrl(replace);
    renderPlugins();
  }

  function resetFilters() {
    for (const select of document.querySelectorAll('#plugins .plugins-select select')) {
      select.value = select.name === 'sort' ? 'popular' : '';
    }
    update({ sort: 'popular', editor: '', price: '', status: '' });
  }

  function updateUrl(replace) {
    const params = [
      ['q', state.q],
      ['orderBy', state.sort === 'popular' ? '' : state.sort],
      ['editor', state.editor],
      ['price', state.price],
      ['status', state.status],
    ]
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
    const url = `/plugins${params.length ? `?${params.join('&')}` : ''}`;
    if (replace) window.history.replaceState(window.history.state, document.title, url);
    else Router.setUrl(url);
  }

  function renderPlugins() {
    const filtered = state.editor || state.price || state.status;
    reset.el.hidden = !filtered && state.sort === 'popular';
    title.textContent = describe();

    const id = ++renderId;
    const list = (
      <Plugins
        name={state.q || undefined}
        orderBy={state.sort === 'popular' ? undefined : state.sort}
        editor={state.editor || undefined}
        price={state.price === 'owned' ? undefined : state.price || undefined}
        owned={state.price === 'owned' ? 'true' : undefined}
        status={STATUSES.find((item) => item.value === state.status)?.code}
      />
    );
    // A slower earlier request must not replace the results of a newer one.
    list.then((el) => {
      if (id === renderId) plugins.el.content = el;
    });
  }

  function describe() {
    const words = [
      label(STATUSES, state.status),
      state.price === 'owned' ? 'Purchased' : label(PRICES, state.price),
      EDITOR_TITLES[state.editor],
      'plugins',
    ];
    let text = words.filter((word) => word && word !== 'Any').join(' ');
    // Only the first word is capitalized; editor names keep their own casing.
    text =
      text.charAt(0).toUpperCase() +
      text.slice(1).replace(/\b(Approved|Pending|Rejected|Deleted|Purchased|Free|Paid|Universal|Plugins)\b/g, (word) => word.toLowerCase());
    if (state.q) text += ` matching “${state.q}”`;
    return text;
  }
}

function FilterSelect({ label, options, value, onchange }) {
  const name = label.toLowerCase();
  return (
    <label className='plugins-select'>
      <span>{label}</span>
      <select name={name} onchange={(e) => onchange(e.target.value)}>
        {options.map((option) => (
          <option value={option.value} selected={option.value === value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function pick(options, value) {
  return options.find((option) => option.value && option.value === value)?.value;
}

function label(options, value) {
  return options.find((option) => option.value === value)?.label || '';
}
