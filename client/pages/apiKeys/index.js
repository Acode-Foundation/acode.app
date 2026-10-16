import './style.scss';
import confirm from 'components/dialogs/confirm';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser, hideLoading, showLoading, withRedirect } from 'lib/helpers';
import moment from 'moment';

const DEFAULT_LIFETIME = 30;

// How each permission is used. Add an entry when adding a scope on the server.
const SCOPE_DOCS = {
  'plugin:publish': {
    title: 'Publish plugin updates',
    guide: 'https://docs.acode.app/docs/getting-started/publish-from-ci',
    endpoint: 'PUT /api/plugin',
    details:
      'Multipart upload with the zip in the plugin field and optional changelogs. Only works for the plugins chosen on the key. Updates to published plugins are scanned like website uploads; price changes need the website.',
    example: (origin) =>
      [`curl --fail-with-body -X PUT ${origin}/api/plugin \\`, '  -H "Authorization: Bearer $ACODE_API_KEY" \\', '  -F "plugin=@plugin.zip"'].join(
        '\n',
      ),
  },
  'plugin:create': {
    title: 'Submit new plugins',
    guide: 'https://docs.acode.app/docs/getting-started/publish-from-ci',
    endpoint: 'POST /api/plugin',
    details:
      'Multipart upload with the zip in the plugin field. New plugins wait for admin review like website submissions, and paid plugins must be submitted from the website. If the key can also publish updates, the new plugin is added to it.',
    example: (origin) =>
      [`curl --fail-with-body -X POST ${origin}/api/plugin \\`, '  -H "Authorization: Bearer $ACODE_API_KEY" \\', '  -F "plugin=@plugin.zip"'].join(
        '\n',
      ),
  },
};

export default async function ApiKeys() {
  // New keys are shown on this page. If an earlier page in this session loaded the
  // ad SDK, reload so the server serves this page without third-party ad code.
  if (document.querySelector('script[src*="adsbygoogle"]')) {
    window.location.replace('/api-keys');
    return null;
  }

  let user;
  let data;
  try {
    showLoading();
    user = await getLoggedInUser();
    if (user) data = await request('/api/api-keys', 'GET');
  } catch (error) {
    return (
      <section id='api-keys'>
        <p className='status error'>{error.message}</p>
      </section>
    );
  } finally {
    hideLoading();
  }

  if (!user) {
    window.location.href = withRedirect('/login', '/api-keys');
    return null;
  }

  const pluginNames = new Map(data.plugins.map((plugin) => [plugin.id, plugin.name]));
  const scopeLabels = new Map(data.scopes.map((scope) => [scope.id, scope.label]));
  const pluginScopes = new Set(data.scopes.filter((scope) => scope.resource === 'plugin').map((scope) => scope.id));
  const needsPlugins = (scopes) => scopes.some((scope) => pluginScopes.has(scope));
  const canCreate = data.plugins.length > 0;
  const status = Reactive('');
  const selectedCount = Reactive(pluginSummary(data.plugins.length, data.plugins.length));
  const expiryHint = Reactive(expiresOn(DEFAULT_LIFETIME));

  const keyList = Ref();
  const statusLine = Ref();
  const newToken = Ref();
  const createPanel = Ref();
  const newKeyButton = Ref();
  const nameInput = Ref();
  const lifetimeSelect = Ref();
  const scopeList = Ref();
  const pluginList = Ref();
  const pluginSearch = Ref();
  const pluginField = Ref();
  const pluginPicker = Ref();
  const selectAllButton = Ref();
  const detailsStep = Ref();
  const detailsFooter = Ref();
  const confirmStep = Ref();
  const codeInput = Ref();
  const sendButton = Ref();
  const createButton = Ref();
  const resendButton = Ref();

  keyList.onref = () => renderKeys();
  pluginField.onref = () => updateScopes();

  return (
    <section id='api-keys'>
      <div className='page-head'>
        <div className='page-title'>
          <span className='title-icon icon vpn_key' aria-hidden='true' />
          <div>
            <h1>API keys</h1>
            <p>Let scripts and automation use your account with only the permissions you grant.</p>
          </div>
        </div>
        {canCreate && (
          <button type='button' className='btn btn--primary' ref={newKeyButton} onclick={openCreate}>
            <span className='icon add' aria-hidden='true' /> New key
          </button>
        )}
      </div>

      <div className='card token-card' ref={newToken} hidden />

      {canCreate && (
        <div className='card create-card' ref={createPanel} hidden>
          <div className='card-head'>
            <h2>New API key</h2>
            <button type='button' className='btn btn--icon' aria-label='Close' onclick={closeCreate}>
              <span className='icon clear' aria-hidden='true' />
            </button>
          </div>

          <div className='create-body' ref={detailsStep}>
            <label className='field'>
              <span className='field-label'>Name</span>
              <input ref={nameInput} type='text' maxLength={data.limits.maxNameLength} placeholder='e.g. Release workflow' autocomplete='off' />
              <span className='field-hint'>Something that tells you where this key is used.</span>
            </label>

            <label className='field'>
              <span className='field-label'>Expiration</span>
              <select ref={lifetimeSelect} onchange={updateExpiry}>
                {data.lifetimeDays.map((days) => (
                  <option value={days} selected={days === DEFAULT_LIFETIME}>
                    {lifetimeLabel(days)}
                  </option>
                ))}
              </select>
              <span className='field-hint'>{expiryHint}</span>
            </label>

            <div className='field'>
              <span className='field-label'>Permissions</span>
              <div className='option-list' ref={scopeList}>
                {data.scopes.map((scope) => (
                  <label className='option'>
                    <input type='checkbox' value={scope.id} checked={scope.default} onchange={updateScopes} />
                    <span className='option-text'>
                      <span>{scope.description}</span>
                      <code>{scope.id}</code>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className='field' ref={pluginField}>
              <span className='field-label'>Plugins</span>
              <details className='picker' ref={pluginPicker}>
                <summary>
                  <span className='picker-summary'>{selectedCount}</span>
                  <span className='picker-action'>
                    Choose plugins <span className='icon keyboard_arrow_down chevron' aria-hidden='true' />
                  </span>
                </summary>
                <div className='picker-body'>
                  <div className='picker-tools'>
                    {data.plugins.length > 6 && (
                      <input ref={pluginSearch} className='plugin-search' type='search' placeholder='Filter plugins' oninput={filterPlugins} />
                    )}
                    <button type='button' className='btn btn--link' ref={selectAllButton} onclick={toggleAll}>
                      Clear
                    </button>
                  </div>
                  <div className='option-list plugin-list' ref={pluginList}>
                    {data.plugins.map((plugin) => (
                      <label className='option' dataset={{ search: `${plugin.name} ${plugin.id}`.toLowerCase() }}>
                        <input type='checkbox' value={plugin.id} checked onchange={updateSelection} />
                        <span className='option-text'>
                          <span>{plugin.name}</span>
                          <code>{plugin.id}</code>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </details>
              <span className='field-hint'>Plugin permissions only apply to these plugins. Plugins you add later aren't included.</span>
            </div>
          </div>

          <div className='confirm-step' ref={confirmStep} hidden>
            <span className='confirm-icon icon mail' aria-hidden='true' />
            <div>
              <h3>Check your email</h3>
              <p>
                We sent a six-digit code to <strong>{user.email}</strong>. It expires in 10 minutes and only approves the settings above.
              </p>
              <div className='code-row'>
                <input
                  ref={codeInput}
                  type='text'
                  inputMode='numeric'
                  autocomplete='one-time-code'
                  maxLength={6}
                  placeholder='000000'
                  onkeydown={(e) => {
                    if (e.key === 'Enter') createKey();
                  }}
                />
                <button type='button' className='btn btn--primary' ref={createButton} onclick={createKey}>
                  Create key
                </button>
              </div>
              <div className='confirm-links'>
                <button type='button' className='btn btn--link' ref={resendButton} onclick={sendCode}>
                  Resend code
                </button>
                <button type='button' className='btn btn--link' onclick={editDetails}>
                  Edit settings
                </button>
              </div>
            </div>
          </div>

          <div className='card-foot'>
            <p className='status' ref={statusLine}>
              {status}
            </p>
            <div className='actions' ref={detailsFooter}>
              <button type='button' className='btn btn--ghost' onclick={closeCreate}>
                Cancel
              </button>
              <button type='button' className='btn btn--primary' ref={sendButton} onclick={sendCode}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      <div className='card keys-card'>
        <div className='card-head'>
          <h2>Your keys</h2>
          <span className='card-meta'>Up to {data.limits.maxActiveKeys} active</span>
        </div>
        <div ref={keyList} />
      </div>

      <details className='card usage-card'>
        <summary>
          Using a key
          <span className='icon keyboard_arrow_down chevron' aria-hidden='true' />
        </summary>
        <p>
          Send the key in the <code>Authorization</code> header. Keys are never accepted from cookies or URLs, and each request only succeeds if the
          key has the permission for it.
        </p>
        <CodeBlock code='Authorization: Bearer acode_…' />
        <h3 className='usage-title'>Permissions</h3>
        <div className='scope-docs'>
          {data.scopes.map((scope) => {
            const doc = SCOPE_DOCS[scope.id];
            return (
              <div className='scope-doc'>
                <div className='scope-doc-head'>
                  <strong>{doc?.title || scope.description}</strong>
                  <code>{scope.id}</code>
                </div>
                {doc && (
                  <>
                    <p>
                      <code>{doc.endpoint}</code> {doc.details}
                      {doc.guide && (
                        <>
                          {' '}
                          <a href={doc.guide} target='_blank' rel='noopener'>
                            Publishing guide
                          </a>
                        </>
                      )}
                    </p>
                    <CodeBlock code={doc.example(window.location.origin)} />
                  </>
                )}
              </div>
            );
          })}
        </div>
        <ul className='notes'>
          <li>Keep keys in your password manager or CI secret storage. Never commit them or print them in logs.</li>
          <li>
            Keys start with <code>acode_</code> so secret scanners can catch leaks. If one leaks, revoke it here right away.
          </li>
          <li>Keys can't change your account, payments or other keys.</li>
        </ul>
      </details>
    </section>
  );

  function renderKeys() {
    if (!data.keys.length) {
      keyList.el.content = (
        <div className='empty'>
          <span className='icon vpn_key' aria-hidden='true' />
          <strong>No API keys yet</strong>
          {canCreate ? (
            <p>Create one to give a script or automation limited access to your account.</p>
          ) : (
            <p>
              The available permissions work with plugins you've published. <a href='/publish'>Publish a plugin</a> to create a key.
            </p>
          )}
        </div>
      );
      return;
    }
    keyList.el.content = <ul className='key-list'>{data.keys.map(KeyRow)}</ul>;
  }

  function KeyRow(key) {
    let state = 'active';
    if (key.expired) state = 'expired';
    else if (moment(key.expiresAt).diff(moment(), 'days') < 7) state = 'soon';

    return (
      <li className={`key key--${state}`}>
        <div className='key-main'>
          <div className='key-title'>
            <strong>{key.name}</strong>
            <code>{key.prefix}…</code>
          </div>
          <div className='key-scopes'>{key.scopes.map((scope) => scopeLabels.get(scope) || scope).join(' · ')}</div>
          {key.pluginIds.length > 0 && (
            <div className='key-plugins' title={key.pluginIds.map((id) => pluginNames.get(id) || id).join(', ')}>
              <span className='icon extension' aria-hidden='true' />
              {describePlugins(key.pluginIds)}
            </div>
          )}
          <div className='key-meta'>
            <span className={`pill pill--${state}`}>
              {key.expired ? 'Expired' : 'Expires'} {moment(key.expiresAt).fromNow()}
            </span>
            <span>Last used {key.lastUsedAt ? moment(key.lastUsedAt).fromNow() : 'never'}</span>
            <span>Created {formatDate(key.createdAt)}</span>
          </div>
        </div>
        <button type='button' className='btn btn--danger' onclick={(e) => revokeKey(key, e.currentTarget)}>
          {key.expired ? 'Remove' : 'Revoke'}
        </button>
      </li>
    );
  }

  function describePlugins(ids) {
    if (data.plugins.length > 1 && data.plugins.every((plugin) => ids.includes(plugin.id))) return 'All plugins';
    const names = ids.map((id) => pluginNames.get(id) || id);
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  }

  function openCreate() {
    createPanel.el.hidden = false;
    newKeyButton.el.hidden = true;
    nameInput.el.focus();
  }

  function closeCreate() {
    resetForm();
    createPanel.el.hidden = true;
    newKeyButton.el.hidden = false;
  }

  function readSpec() {
    const scopes = checkedValues(scopeList.el);
    return {
      name: nameInput.el.value.trim(),
      lifetimeDays: selectedLifetime(),
      scopes,
      pluginIds: needsPlugins(scopes) ? checkedValues(pluginList.el) : [],
    };
  }

  // Plugins are only asked for when a selected permission works on plugins.
  function updateScopes() {
    pluginField.el.hidden = !needsPlugins(checkedValues(scopeList.el));
  }

  async function sendCode() {
    const spec = readSpec();
    const missing = missingField(spec, needsPlugins(spec.scopes));
    if (missing) {
      setStatus(missing, 'error');
      return;
    }

    setBusy(true);
    setStatus('');
    try {
      await request('/api/api-keys/confirmation-code', 'POST', spec);
      showConfirmStep();
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createKey() {
    const code = codeInput.el.value.trim();
    if (!/^\d{6}$/.test(code)) {
      setStatus('Enter the six-digit code from the email.', 'error');
      return;
    }

    setBusy(true);
    setStatus('');
    try {
      const { key, token } = await request('/api/api-keys', 'POST', { ...readSpec(), code });
      data.keys = [key, ...data.keys];
      renderKeys();
      closeCreate();
      showToken(key, token);
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(key, button) {
    const action = key.expired ? 'Remove' : 'Revoke';
    if (!(await confirm(`${action} "${key.name}"?`, 'Anything using this key will stop working immediately. This cannot be undone.'))) return;
    button.disabled = true;
    try {
      await request(`/api/api-keys/${key.id}`, 'DELETE');
      data.keys = data.keys.filter((item) => item.id !== key.id);
      renderKeys();
    } catch (error) {
      button.disabled = false;
      keyList.el.prepend(<p className='status error'>{error.message}</p>);
    }
  }

  // While a code is pending the settings are locked, so the code always matches what was emailed.
  function showConfirmStep() {
    setLocked(true);
    codeInput.el.value = '';
    codeInput.el.focus();
  }

  function editDetails() {
    setLocked(false);
    setStatus('');
  }

  function setLocked(locked) {
    for (const input of detailsStep.el.querySelectorAll('input, select')) input.disabled = locked;
    selectAllButton.el.disabled = locked;
    if (locked) pluginPicker.el.open = false;
    pluginPicker.el.classList.toggle('locked', locked);
    detailsStep.el.classList.toggle('locked', locked);
    detailsFooter.el.hidden = locked;
    confirmStep.el.hidden = !locked;
  }

  function resetForm() {
    editDetails();
    nameInput.el.value = '';
    codeInput.el.value = '';
    if (pluginSearch.el) pluginSearch.el.value = '';
    filterPlugins();
    for (const input of pluginList.el.querySelectorAll('input')) input.checked = true;
    pluginPicker.el.open = false;
    for (const input of scopeList.el.querySelectorAll('input')) {
      input.checked = data.scopes.find((scope) => scope.id === input.value)?.default === true;
    }
    updateScopes();
    lifetimeSelect.el.value = String(DEFAULT_LIFETIME);
    updateExpiry();
    updateSelection();
  }

  function showToken(key, token) {
    const copyLabel = Reactive('Copy');
    const tokenField = <input type='text' readOnly value={token} spellcheck={false} onfocus={(e) => e.target.select()} />;
    newToken.el.content = (
      <>
        <div className='token-head'>
          <span className='icon check_circle' aria-hidden='true' />
          <div>
            <h2>"{key.name}" is ready</h2>
            <p>Copy it now and store it somewhere safe. You won't be able to see it again.</p>
          </div>
        </div>
        <div className='token-row'>
          {tokenField}
          <button type='button' className='btn btn--primary' onclick={copy}>
            <span className='icon content_copy' aria-hidden='true' /> {copyLabel}
          </button>
        </div>
        <div className='token-foot'>
          <span>Expires {formatDate(key.expiresAt)}</span>
          <button type='button' className='btn btn--ghost' onclick={dismiss}>
            Done
          </button>
        </div>
      </>
    );
    newToken.el.hidden = false;
    newToken.el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    async function copy() {
      if (await copyText(token)) copyLabel.value = 'Copied';
      else tokenField.select();
    }

    function dismiss() {
      newToken.el.hidden = true;
      // Don't leave the secret in the page once the user is done with it.
      newToken.el.content = '';
    }
  }

  function selectedLifetime() {
    return Number(lifetimeSelect.el.value) || DEFAULT_LIFETIME;
  }

  function updateExpiry() {
    expiryHint.value = expiresOn(selectedLifetime());
  }

  function updateSelection() {
    const inputs = [...pluginList.el.querySelectorAll('input')];
    const checked = inputs.filter((input) => input.checked).length;
    selectedCount.value = pluginSummary(checked, inputs.length);
    selectAllButton.el.textContent = checked === inputs.length ? 'Clear' : 'Select all';
  }

  function toggleAll() {
    const inputs = [...pluginList.el.querySelectorAll('input')];
    const select = !inputs.every((input) => input.checked);
    for (const input of inputs) input.checked = select;
    updateSelection();
  }

  function filterPlugins() {
    const query = (pluginSearch.el?.value || '').trim().toLowerCase();
    for (const option of pluginList.el.querySelectorAll('.option')) {
      option.hidden = Boolean(query) && !option.dataset.search.includes(query);
    }
  }

  function setBusy(busy) {
    for (const button of [sendButton.el, createButton.el, resendButton.el]) button.disabled = busy;
  }

  function setStatus(message, type = '') {
    status.value = message;
    statusLine.el.classList.toggle('error', type === 'error');
  }
}

function CodeBlock({ code }) {
  const copyLabel = Reactive('Copy');
  return (
    <div className='code-block'>
      <pre>{code}</pre>
      <button type='button' className='btn btn--link' onclick={copy}>
        <span className='icon content_copy' aria-hidden='true' /> {copyLabel}
      </button>
    </div>
  );

  async function copy() {
    if (await copyText(code)) copyLabel.value = 'Copied';
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function missingField(spec, pluginScoped) {
  if (!spec.name) return 'Give the key a name.';
  if (!spec.scopes.length) return 'Select at least one permission.';
  if (pluginScoped && !spec.pluginIds.length) return 'Select at least one plugin.';
  return '';
}

function pluginSummary(checked, total) {
  if (checked === total) return total === 1 ? 'Your plugin' : `All ${total} of your plugins`;
  if (!checked) return 'No plugins selected';
  return `${checked} of ${total} plugins`;
}

function checkedValues(container) {
  return [...container.querySelectorAll('input[type=checkbox]:checked')].map((input) => input.value);
}

function lifetimeLabel(days) {
  return days === 365 ? '1 year' : `${days} days`;
}

function expiresOn(days) {
  return `Expires on ${moment().add(days, 'days').format('D MMM YYYY')}.`;
}

function formatDate(date) {
  return moment(date).format('D MMM YYYY');
}

async function request(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : { 'X-Requested-With': 'XMLHttpRequest' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Unable to complete the request.');
  return result;
}
