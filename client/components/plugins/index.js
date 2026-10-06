import './style.scss';
import AdSense from 'components/adsense';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import select from 'components/dialogs/select';
import PluginStatus from 'components/pluginStatus';
import { calcRating, getLoggedInUser, hideLoading, showLoading, since } from 'lib/helpers';
import Router from 'lib/Router';
import EditorType from '../editorType';

const PAGE_SIZE = 30;
const AD_POSITIONS = [2, 15, 28];

export default async function Plugins({ user, orderBy, status, name, editor, owned, price }) {
  const el = <div className='plugins' data-msg='loading...' />;
  const loadMore = (
    <button type='button' className='load-more' onclick={() => loadPage(page + 1)}>
      Load more
    </button>
  );
  // Fetch the next page as the button nears the viewport; the button stays as a manual fallback.
  const observer = 'IntersectionObserver' in window && new IntersectionObserver(onIntersect, { rootMargin: '600px 0px' });
  const params = new URLSearchParams();
  let page = 1;
  let count = 0;
  let wasConnected = false;

  if (user) {
    params.set('user', user);
  }

  if (status !== undefined) {
    params.set('status', status);
  }

  if (name) {
    params.set('name', name);
  }

  if (editor) {
    params.set('supported_editor', editor);
  }

  if (orderBy) {
    params.set('orderBy', orderBy);
  }

  if (owned) {
    params.set('owned', owned);
  }

  if (price) {
    params.set('price', price);
  }

  params.set('limit', PAGE_SIZE);

  try {
    showLoading();
    await loadPage(1);
  } finally {
    hideLoading();
  }

  return el;

  /** @param {IntersectionObserverEntry[]} entries */
  function onIntersect([entry]) {
    if (el.isConnected) {
      wasConnected = true;
    } else if (wasConnected) {
      // The list was replaced or the page changed, so stop watching the detached button.
      observer.disconnect();
      return;
    }

    if (entry.isIntersecting && !loadMore.disabled) loadPage(page + 1);
  }

  async function loadPage(nextPage) {
    loadMore.disabled = true;
    loadMore.textContent = 'Loading...';

    try {
      params.set('page', nextPage);
      const res = await fetch(`/api/plugin?${params}`);
      const { isAdmin, id: userId } = (await getLoggedInUser()) || {};
      const plugins = await res.json();
      if (plugins.error) throw new Error(plugins.error);

      page = nextPage;
      loadMore.remove();
      el.setAttribute('data-msg', 'No plugins found. :(');
      for (const plugin of plugins) {
        // Ads are placed by position in the whole list, so later pages keep the same rhythm.
        if (AD_POSITIONS.includes(count) || (count > 33 && Math.random() < 0.1)) {
          el.append(<AdSense className='plugin' style={{ position: 'relative' }} />);
        }
        el.append(<Plugin {...plugin} isAdmin={isAdmin} userId={userId} />);
        count++;
      }

      // A short page means there is nothing left to fetch.
      if (plugins.length === PAGE_SIZE) {
        el.append(loadMore);
        if (observer) {
          // Re-observing reports the current state, so a page that doesn't fill the screen keeps loading.
          observer.unobserve(loadMore);
          observer.observe(loadMore);
        }
      } else if (observer) {
        observer.disconnect();
      }
    } catch (error) {
      if (count) {
        // Keep the button so a failed "load more" can be retried.
        alert('Error', error.message);
      } else {
        el.append(
          <div className='error'>
            <h2>{error.message}</h2>
          </div>,
        );
      }
    } finally {
      loadMore.disabled = false;
      loadMore.textContent = 'Load more';
    }
  }
}

function Plugin({
  id,
  name,
  price,
  owned,
  status_text,
  userId,
  version,
  isAdmin,
  downloads,
  currencySymbol,
  votes_up: upVotes,
  user_id: pluginUser,
  votes_down: downVotes,
  comment_count: comments,
  supported_editor: editorType,
  package_updated_at: updatedAt,
}) {
  return (
    <a href={`/plugin/${id}`} className='plugin'>
      <EditorType type={editorType} />
      {Boolean(price) &&
        (owned ? (
          <span className='badge owned'>
            <span className='icon check_circle' />
            Owned
          </span>
        ) : (
          <span className='badge price'>
            {currencySymbol}
            {price}
          </span>
        ))}
      <div className='plugin-icon' style={{ backgroundImage: `url(/plugin-icon/${id})` }} />
      <div className='plugin-info'>
        <h2 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</h2>
        <div className='info'>
          <div title='Downloads counter'>
            {Number(downloads).toLocaleString()} <span className='icon download' />
          </div>
          <PluginStatus status={status_text} id={id} name={name} />
          <div>{calcRating(upVotes, downVotes)}</div>
          {comments > 0 && (
            <div>
              {comments} <span className='icon chat_bubble' />
            </div>
          )}
        </div>
        <p>
          {id}&nbsp;•&nbsp;
          <small>
            <strong>{version}</strong>
          </small>
        </p>
        <small>{updatedAt ? `Updated ${since(updatedAt)}` : ' '}</small>
        <Actions id={id} isAdmin={isAdmin} user={userId} pluginsUser={pluginUser} />
      </div>
    </a>
  );
}

/**
 *
 * @param {MouseEvent} e
 * @param {string} id
 */
function edit(e, id) {
  e.preventDefault();
  e.stopPropagation();
  Router.loadUrl(`/publish?mode=update&id=${id}`);
}

/**
 *
 * @param {MouseEvent} e
 * @param {string} id
 */
function onDelete(e, id) {
  e.preventDefault();
  e.stopPropagation();
  deletePlugin(id);
}

/**
 * Ask for confirmation and delete a plugin, reloading the page on success.
 * @param {string} id
 */
export async function deletePlugin(id) {
  const loggedInUser = await getLoggedInUser();
  let mode = 'soft';
  if (loggedInUser.isAdmin) {
    mode = await select('Delete mode', ['soft', 'hard']);
    if (!mode) {
      return;
    }
  }

  const confirmation = await confirm('Delete plugin', 'Are you sure you want to delete this plugin?');
  if (!confirmation) {
    return;
  }

  try {
    showLoading();
    const res = await fetch(`/api/plugin/${id}?mode=${mode}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (data.error) {
      alert('Error', data.error);
      return;
    }

    Router.reload();
  } catch (error) {
    alert('Error', error.message);
  } finally {
    hideLoading();
  }
}

function Actions({ user, pluginsUser, id, isAdmin }) {
  const $el = <small className='icon-buttons' />;
  const $delete = <span title='delete plugin' className='link icon delete danger' onclick={(e) => onDelete(e, id)} />;

  if (user && user === pluginsUser) {
    $el.append(<span title='edit plugin' className='link icon create' onclick={(e) => edit(e, id)} />, $delete);
  } else if (isAdmin) {
    $el.append($delete);
  }

  return $el;
}
