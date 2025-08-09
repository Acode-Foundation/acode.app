import './style.scss';
import AdSense from 'components/adsense';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import prompt from 'components/dialogs/prompt';
import select from 'components/dialogs/select';
import { calcRating, capitalize, getLoggedInUser, hideLoading, showLoading } from 'lib/helpers';
import Router from 'lib/Router';

export default function Plugins({ user, orderBy, status, name }) {
  const el = <div className='plugins' data-msg='loading...' />;

  (async () => {
    try {
      showLoading();
      let url = '/api/plugin';

      if (user) {
        url += `?user=${user}`;
      } else if (status !== undefined) {
        url += `?status=${status}`;
      } else if (name) {
        url += `?name=${name}`;
      } else if (orderBy) {
        url += `?orderBy=${orderBy}`;
      }

      const res = await fetch(url);
      const { isAdmin, id: userId } = (await getLoggedInUser()) || {};
      const plugins = await res.json();
      const adsPosition = [2, 15, 28];

      el.setAttribute('data-msg', 'No plugins found. :(');
      for (let i = 0; i < plugins.length; i++) {
        const plugin = plugins[i];
        if (adsPosition.includes(i) || (i > 33 && Math.random() < 0.1)) {
          el.append(<AdSense className='plugin' style={{ position: 'relative' }} />);
        }
        el.append(<Plugin {...plugin} isAdmin={isAdmin} userId={userId} />);
      }
    } catch (error) {
      el.append(
        <div className='error'>
          <h2>{error.error}</h2>
        </div>,
      );
    } finally {
      hideLoading();
    }
  })();

  return el;
}

function Plugin({
  name,
  id,
  version,
  downloads,
  status,
  isAdmin,
  userId,
  user_id: pluginUser,
  votes_up: upVotes,
  votes_down: downVotes,
  comment_count: comments,
}) {
  return (
    <a href={`/plugin/${id}`} className='plugin'>
      <div className='plugin-icon' style={{ backgroundImage: `url(/plugin-icon/${id})` }} />
      <div className='plugin-info'>
        <h2>{name}</h2>
        <div className='info'>
          <div title='Downloads counter'>
            {downloads.toLocaleString()} <span className='icon download' />
          </div>
          {Boolean(status) && (
            <span data-id={id} onclick={isAdmin ? changePluginStatus : undefined} title='Plugin status' className={`status-indicator ${status}`}>
              {status}
            </span>
          )}
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
 * @returns
 */
async function deletePlugin(e, id) {
  e.preventDefault();
  e.stopPropagation();

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

/**
 *
 * @param {MouseEvent} e
 * @returns
 */
async function changePluginStatus(e) {
  e.preventDefault();
  e.stopPropagation();
  try {
    const { target } = e;
    const { id } = target.dataset;
    const status = await select('Change plugin status', ['approve', 'reject']);
    if (!status) return;

    let reason;
    if (status === 'reject') {
      reason = await prompt('Reason', { type: 'textarea' });
    }
    showLoading();
    const res = await fetch('/api/plugin', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status, id, reason }),
    });
    const data = await res.json();
    if (data.error) {
      alert('Error', data.error);
      return;
    }

    const pluginRes = await fetch(`/api/plugin/${id}`);
    const pluginData = await pluginRes.json();
    target.textContent = capitalize(pluginData.status);
    target.className = pluginData.status;
  } catch (error) {
    alert('Error', error.message);
  } finally {
    hideLoading();
  }
}

function Actions({ user, pluginsUser, id, isAdmin }) {
  const $el = <small className='icon-buttons' />;
  const $delete = <span title='delete plugin' className='link icon delete danger' onclick={(e) => deletePlugin(e, id)} />;

  if (user && user === pluginsUser) {
    $el.append(<span title='edit plugin' className='link icon create' onclick={(e) => edit(e, id)} />, $delete);
  } else if (isAdmin) {
    $el.append($delete);
  }

  return $el;
}
