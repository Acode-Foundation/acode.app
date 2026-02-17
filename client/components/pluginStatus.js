import { capitalize, getLoggedInUser, hideLoading, showLoading } from 'lib/helpers';
import alert from './dialogs/alert';
import prompt from './dialogs/prompt';
import select from './dialogs/select';

/**
 *
 * @param {object} props
 * @param {string} props.status
 * @param {string} props.id
 * @param {'default'|'button'} [props.style]
 * @returns
 */
export default async function PluginStatus({ status, id, style = 'default' }) {
  if (!status) return null;
  const { isAdmin } = (await getLoggedInUser()) || {};

  if (style === 'button') {
    return (
      <button
        type='button'
        data-id={id}
        onclick={isAdmin ? changePluginStatus : undefined}
        title='Plugin status'
        className={`status-button ${status}`}
      >
        {capitalize(status)}
      </button>
    );
  }

  return (
    <span data-id={id} onclick={isAdmin ? changePluginStatus : undefined} title='Plugin status' className={`status-indicator ${status}`}>
      {status}
    </span>
  );
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
