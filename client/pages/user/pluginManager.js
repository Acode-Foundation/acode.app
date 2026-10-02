import { deletePlugin } from 'components/plugins';
import { formatCompactNumber, formatExactNumber } from 'lib/formatNumber';
import { since } from 'lib/helpers';

const SEARCH_THRESHOLD = 5;
const STATUS = {
  0: { label: 'In review', className: 'pending', order: 1 },
  1: { label: 'Live', className: 'live', order: 2 },
  2: { label: 'Rejected', className: 'rejected', order: 0 },
};

/**
 * List of a developer's plugins with quick actions (update, view, delete).
 * @param {object} props
 * @param {Array<object>} props.plugins Plugins from `/api/user/dashboard`
 * @param {boolean} props.isSelf Whether the logged in user owns these plugins
 */
export default function PluginManager({ plugins, isSelf }) {
  // Plugins that need attention (rejected, in review) first, then by name.
  const statusOrder = (plugin) => (STATUS[plugin.status] || STATUS[1]).order;
  const sorted = [...plugins].sort((a, b) => statusOrder(a) - statusOrder(b) || a.name.localeCompare(b.name));
  const $list = <div className='manage-grid' />;
  const $empty = <p className='manage-empty' />;
  $empty.hidden = true;

  renderRows(sorted);

  return (
    <div className='plugin-manager'>
      <div className='manage-toolbar'>
        {plugins.length >= SEARCH_THRESHOLD && (
          <label className='manage-search'>
            <span className='icon search' />
            <input type='search' placeholder={`Search ${plugins.length} plugins`} aria-label='Search plugins' oninput={onSearch} />
          </label>
        )}
        {isSelf && plugins.length > 0 && (
          <a className='action action--primary' href='/publish'>
            <span className='icon add' />
            New plugin
          </a>
        )}
      </div>
      {plugins.length ? (
        [$list, $empty]
      ) : (
        <div className='panel dash-empty'>
          <span className='icon extension' />
          <h3>{isSelf ? 'Publish your first plugin' : 'No published plugins'}</h3>
          <p>Earn from paid plugins and from every download of your free plugins.</p>
          {isSelf && (
            <div className='dash-empty-actions'>
              <a className='action action--primary' href='/publish'>
                <span className='icon publish' />
                Publish plugin
              </a>
              <a className='action' href='https://docs.acode.app' target='_blank' rel='noopener'>
                Read the docs
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );

  /**
   * @param {InputEvent} e
   */
  function onSearch(e) {
    const query = e.target.value.trim().toLowerCase();
    const matches = query ? sorted.filter((p) => p.name.toLowerCase().includes(query) || p.id.toLowerCase().includes(query)) : sorted;
    renderRows(matches);
    $empty.hidden = Boolean(matches.length);
    $empty.textContent = `No plugins match "${e.target.value.trim()}".`;
  }

  function renderRows(rows) {
    $list.replaceChildren(...rows.map((plugin) => <Card plugin={plugin} isSelf={isSelf} />));
  }
}

function Card({ plugin, isSelf }) {
  const status = STATUS[plugin.status] || STATUS[1];
  const votes = plugin.votesUp + plugin.votesDown;
  const rating = votes ? `${Math.round((plugin.votesUp / votes) * 100)}%` : '–';
  const meta = [plugin.version && `v${plugin.version}`, plugin.updatedAt && `Updated ${since(plugin.updatedAt)}`].filter(Boolean);

  return (
    <div className={`manage-card manage-card--${status.className}`}>
      <div className='manage-card-top'>
        <span className={`status-chip status-chip--${status.className}`}>{status.label}</span>
        {plugin.price > 0 && <span className='pill pill--paid'>&#8377;{plugin.price}</span>}
      </div>
      <a className='manage-card-body' href={`/plugin/${plugin.id}`} title='Open plugin page'>
        <img src={`/plugin-icon/${plugin.id}`} alt='' loading='lazy' />
        <strong className='manage-card-name'>{plugin.name}</strong>
        <span className='manage-card-id'>{plugin.id}</span>
        <span className='manage-card-meta'>{meta.join(' · ')}</span>
      </a>
      <div className='manage-card-stats'>
        <div title={`${formatExactNumber(plugin.recent)} downloads in the last 30 days`}>
          <strong>{formatCompactNumber(plugin.recent)}</strong>
          <small>30 days</small>
        </div>
        <div title={`${formatExactNumber(plugin.downloads)} downloads in total`}>
          <strong>{formatCompactNumber(plugin.downloads)}</strong>
          <small>Total</small>
        </div>
        <div title={votes ? `${plugin.votesUp} up, ${plugin.votesDown} down` : 'No votes yet'}>
          <strong>{rating}</strong>
          <small>Positive</small>
        </div>
      </div>
      {plugin.status === 2 && plugin.statusMessage && (
        <p className='manage-note'>
          <span className='icon warning' />
          {plugin.statusMessage}
        </p>
      )}
      <div className='manage-card-actions'>
        {isSelf && (
          <a className='action action--small action--primary' href={`/publish?mode=update&id=${plugin.id}`}>
            <span className='icon publish' />
            {plugin.status === 2 ? 'Fix & resubmit' : 'Update'}
          </a>
        )}
        <button
          type='button'
          className='icon-action icon-action--danger'
          title={`Delete ${plugin.name}`}
          aria-label={`Delete ${plugin.name}`}
          onclick={() => deletePlugin(plugin.id)}
        >
          <span className='icon delete' />
        </button>
      </div>
    </div>
  );
}
