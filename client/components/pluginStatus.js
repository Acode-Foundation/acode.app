import './pluginStatus.scss';
import { capitalize, getLoggedInUser } from 'lib/helpers';
import Router from 'lib/Router';

/** Display a plugin's status, with a shared moderation dialog for administrators. */
export default async function PluginStatus({ status, id, name = id, style = 'default' }) {
  if (!status) return null;
  const { isAdmin } = (await getLoggedInUser()) || {};
  const page = style === 'page';
  const label = <span />;
  const indicator = isAdmin && !page ? <button type='button'>{label}</button> : <span>{label}</span>;
  const announcement = <span className='plugin-status-announcement' role='status' aria-live='polite' />;
  const action = page && isAdmin && (
    <button type='button' className='plugin-status-fab'>
      <span className='icon check_circle' aria-hidden='true' />
      <span>Manage status</span>
    </button>
  );
  const root = (
    <span className='plugin-status-control'>
      {indicator}
      {action}
      {announcement}
    </span>
  );
  const trigger = page ? action : indicator;
  let currentStatus = status;
  let dialog;

  function renderStatus() {
    indicator.className = `${page ? 'plugin-status-badge' : 'status-indicator'} ${currentStatus}`;
    label.textContent = `${page ? 'Status: ' : ''}${capitalize(currentStatus)}`;
  }
  renderStatus();

  if (isAdmin) {
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-label', `Manage status for ${name}`);
    trigger.onclick = openDialog;
  }
  return root;

  function openDialog(event) {
    event.preventDefault();
    event.stopPropagation();
    if (dialog) return;

    let saving = false;
    let disposed = false;
    const statuses = { approve: 'approved', reject: 'rejected' };
    const reason = <textarea rows='3' placeholder='Explain what needs to change…' />;
    const reasonField = (
      <label className='plugin-status-reason'>
        Rejection reason <span className='muted'>(optional)</span>
        {reason}
        <small>Included in the email to the plugin author.</small>
      </label>
    );
    const error = <p className='plugin-status-error' role='alert' hidden />;
    const cancel = (
      <button type='button' onclick={() => dismiss()}>
        Cancel
      </button>
    );
    const submit = (
      <button type='submit' className='plugin-status-submit' disabled>
        Apply change
      </button>
    );
    const fields = (
      <fieldset>
        <legend>Change status</legend>
        {[
          ['approve', 'Approve', 'Make this plugin available in the store.'],
          ['reject', 'Reject', 'Hide this plugin from the store.'],
        ].map(([value, title, description]) => (
          <label className='plugin-status-choice'>
            <input type='radio' name='plugin-status' value={value} checked={statuses[value] === currentStatus} onchange={updateSelection} />
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
          </label>
        ))}
        {reasonField}
      </fieldset>
    );
    const modal = (
      <dialog className='plugin-status-dialog' aria-label={`Manage status for ${name}`}>
        <form onsubmit={save}>
          <h2>Manage status</h2>
          <p className='plugin-status-name'>{name}</p>
          <p className='plugin-status-current'>
            Current status: <strong>{capitalize(currentStatus)}</strong>
          </p>
          {fields}
          <p className='muted'>The author is notified when you apply a change.</p>
          {error}
          <div className='plugin-status-actions'>
            {cancel}
            {submit}
          </div>
        </form>
      </dialog>
    );
    const scroller = root.closest('#app');
    const previousOverflow = scroller?.style.overflow;
    dialog = modal;
    updateSelection();
    modal.addEventListener('cancel', (e) => {
      if (saving) e.preventDefault();
    });
    modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const first = fields.querySelector('input:checked') || fields.querySelector('input');
      const last = submit.disabled ? cancel : submit;
      if (saving || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
        e.preventDefault();
        if (!saving) (e.shiftKey ? last : first).focus();
      }
    });
    modal.addEventListener('click', (e) => {
      // A double-click on the opener can land its second click on the backdrop.
      if (e.target !== modal || e.detail > 1) return;
      const rect = modal.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dismiss();
    });
    modal.addEventListener('close', cleanup, { once: true });
    Router.on('navigate', cleanup);
    document.body.append(modal);
    if (scroller) scroller.style.overflow = 'hidden';
    modal.showModal();
    (fields.querySelector('input:checked') || fields.querySelector('input')).focus();

    function updateSelection() {
      const value = fields.querySelector('input:checked')?.value;
      reasonField.hidden = value !== 'reject';
      submit.disabled = saving || !value || statuses[value] === currentStatus;
      submit.dataset.action = value || '';
      submit.textContent = value ? `${capitalize(value)} plugin` : 'Apply change';
    }

    function dismiss() {
      if (!saving) modal.close();
    }

    function cleanup() {
      if (disposed) return;
      disposed = true;
      Router.off('navigate', cleanup);
      modal.remove();
      dialog = null;
      if (scroller) scroller.style.overflow = previousOverflow;
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    }

    async function save(e) {
      e.preventDefault();
      const value = fields.querySelector('input:checked')?.value;
      if (saving || !value || statuses[value] === currentStatus) return;
      saving = true;
      fields.disabled = cancel.disabled = submit.disabled = true;
      submit.textContent = 'Saving…';
      modal.setAttribute('aria-busy', 'true');
      error.hidden = true;
      try {
        const res = await fetch('/api/plugin', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: value, ...(value === 'reject' && { reason: reason.value.trim() }) }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Could not update the status. Please try again.');
        if (disposed) return;
        currentStatus = statuses[value];
        renderStatus();
        announcement.textContent = `${name} ${currentStatus}.`;
        modal.close();
      } catch (err) {
        if (disposed) return;
        error.textContent = err.message || 'Could not update the status. Please try again.';
        error.hidden = false;
      } finally {
        if (!disposed) {
          saving = false;
          fields.disabled = cancel.disabled = false;
          modal.removeAttribute('aria-busy');
          updateSelection();
        }
      }
    }
  }
}
