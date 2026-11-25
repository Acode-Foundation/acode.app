import './style.scss';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import Plugins from 'components/plugins';
import Tabs from 'components/tabs';
import Ref from 'html-tag-js/ref';
import { isIOSSource } from 'lib/appSource';
import { getLoggedInUser, gravatar, hideLoading, showLoading } from 'lib/helpers';
import { applyProfileMetadata, beginProfileMetadataRequest } from 'lib/pageMetadata';
import Router from 'lib/Router';
import { PAYMENT_METHOD_ICONS, PAYMENT_METHOD_LABELS, PAYMENT_METHOD_LIMIT } from '../../../shared/paymentMethods';
import DeveloperDashboard from './dashboard';
import PluginManager from './pluginManager';

export default async function User({ userId }) {
  const profileMetadataRequest = beginProfileMetadataRequest();
  const loggedInUser = await getLoggedInUser();
  /** @type {import('lib/helpers').User} */
  let user = null;

  if (userId) {
    try {
      const res = await fetch(`/api/user/${userId}`);
      user = await res.json();

      if (user.error) {
        throw new Error(user.error);
      }
    } catch (error) {
      return <div className='error'>{error.message}</div>;
    }
  } else {
    user = loggedInUser;
  }

  if (!user) {
    Router.loadUrl('/login?redirect=/profile');
    return 'Redirecting...';
  }

  applyProfileMetadata(user, profileMetadataRequest);

  const isSelf = loggedInUser && loggedInUser.id === user.id;
  const shouldShowSensitiveInfo = Boolean(isSelf || loggedInUser?.isAdmin);
  const paymentMethods = Ref();
  const paymentMethodsList = (
    <div ref={paymentMethods} className='payment-methods'>
      {isSelf && (
        <a href='/add-payment-method' className='add-payment-method' hidden>
          <span className='icon add' aria-hidden='true' />
          <span>Add payment method</span>
        </a>
      )}
      {isSelf && (
        <p className='payment-methods-hint' hidden>
          You have added the maximum of {PAYMENT_METHOD_LIMIT} payment methods. Delete one to add another.
        </p>
      )}
    </div>
  );

  if (shouldShowSensitiveInfo) {
    renderPaymentMethods();
  }

  const stats = shouldShowSensitiveInfo ? await fetchDashboard() : null;
  const isDeveloper = Boolean(stats && (stats.totals.plugins > 0 || stats.totals.lifetimeEarnings > 0 || stats.totals.lifetimeEarnings === null));
  const params = new URLSearchParams(window.location.search);
  const linked = params.get('linked');
  const linkedLabel = { github: 'GitHub', google: 'Google', apple: 'Apple' }[linked];
  if (isSelf && typeof linkedLabel === 'string' && user[`${linked}_id`]) {
    alert(
      `${linkedLabel} account linked`,
      `You can now sign in to Acode with ${linkedLabel}.`,
      () => {
        const url = new URL(window.location.href);
        url.searchParams.delete('linked');
        history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
      },
      false,
      { icon: linked, variant: 'success' },
    );
  }

  const linkError = params.get('error');
  if (linkError) {
    alert('Error', linkError, () => {
      params.delete('error');
      const newSearch = params.toString();
      Router.loadUrl(`${location.pathname}${newSearch ? `?${newSearch}` : ''}`);
    });
  }

  return (
    <section id='user'>
      <div className='profile'>
        <img src={user.avatar_url || gravatar(user.github)} alt={user.name || ''} className='profile-image' />
        <div className='profile-info'>
          <h1>
            <div className='user-name'>
              {user.name}
              <VerifyButton />
              <div className='extra-info'>
                {isSelf && user.role === 'admin' && (
                  <a className='tag' href='/admin'>
                    Admin
                  </a>
                )}
                {Boolean(user.acode_pro) && !isIOSSource() && (
                  <a className='tag pro-tag' href='/pro'>
                    Pro
                  </a>
                )}
              </div>
            </div>
          </h1>
          <div className='socials'>
            {user.website && (
              <a href={user.website} target='_blank' rel='noopener' title={user.website}>
                <span className='icon earth' />
                <span className='label'>{user.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
              </a>
            )}
            {user.github && (
              <a href={`https://github.com/${user.github}`} target='_blank' rel='noopener' title='GitHub'>
                <span className='icon github' />
                <span className='label'>{user.github}</span>
              </a>
            )}
            {user.x && (
              <a href={`https://x.com/@${user.x}`} target='_blank' rel='noopener' title='X'>
                <span className='icon x' />
                <span className='label'>{user.x}</span>
              </a>
            )}
            {user.linkedin && (
              <a href={`https://linkedin.com/in/${user.linkedin}`} target='_blank' rel='noopener' title='LinkedIn'>
                <span className='icon linkedin' />
                <span className='label'>{user.linkedin}</span>
              </a>
            )}
          </div>
        </div>
        {isSelf && (
          <div className='profile-actions'>
            <a className='action action--primary' href='/publish'>
              <span className='icon publish' />
              Publish plugin
            </a>
            <a className='action' href='/profile/edit' data-google-vignette='false'>
              <span className='icon create' />
              Edit profile
            </a>
          </div>
        )}
      </div>
      <ProfileContent />
    </section>
  );

  /**
   * Tabs below the profile card. Developers land on their dashboard, everyone
   * else on the plugins they own. The active tab is kept in `?tab=`.
   */
  function ProfileContent() {
    const tabs = [
      {
        id: 'dashboard',
        label: 'Dashboard',
        icon: 'dashboard',
        visible: isDeveloper,
        content: () => (
          <DeveloperDashboard
            user={user}
            isSelf={isSelf}
            stats={stats}
            paymentMethods={paymentMethodsList}
            onManagePlugins={() => selectTab('plugins')}
          />
        ),
      },
      {
        id: 'plugins',
        label: isSelf ? 'My plugins' : 'Plugins',
        icon: 'extension',
        content: () => {
          const list = stats ? <PluginManager plugins={stats.plugins} isSelf={isSelf} /> : Plugins({ user: user.id });
          if (isDeveloper) return list;
          // Without the dashboard tab, payment methods still need a home.
          return (
            <div className='plugins-tab'>
              {list}
              <PaymentMethodsPanel />
            </div>
          );
        },
      },
      { id: 'owned', label: 'Owned', icon: 'shopping_bag', visible: isSelf, content: () => Plugins({ owned: true }) },
    ];

    if (!shouldShowSensitiveInfo) {
      return <Plugins user={user.id} />;
    }

    // Buyers mostly come here for their purchases, so put those first.
    if (!isDeveloper) tabs.reverse();

    const visibleTabs = tabs.filter((tab) => tab.visible !== false);
    if (visibleTabs.length === 1) {
      return visibleTabs[0].content();
    }

    const requested = params.get('tab');
    const defaultActive = visibleTabs.some((tab) => tab.id === requested) ? requested : visibleTabs[0].id;

    return <Tabs className='profile-tabs' defaultActive={defaultActive} tabs={tabs} onChange={rememberTab} />;
  }

  function PaymentMethodsPanel() {
    return (
      <div className='panel payment-methods-panel'>
        <div className='panel-head'>
          <h3>Payment methods</h3>
          <span className='panel-meta'>
            <a href={`/earnings?user=${user.id}`}>Earnings</a>
          </span>
        </div>
        {isSelf && <p className='panel-hint'>Add a payment method to get paid for your plugins.</p>}
        {paymentMethodsList}
      </div>
    );
  }

  /**
   * @param {string} tabId
   */
  function selectTab(tabId) {
    document.querySelector(`#user .profile-tabs .tab-btn[data-tab="${tabId}"]`)?.click();
    document.querySelector('#user .profile-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Keep the active tab in the url so reloads and shared links land on it.
   * @param {string} tabId
   */
  function rememberTab(tabId) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabId);
    history.replaceState(history.state, document.title, `${url.pathname}${url.search}`);
  }

  async function fetchDashboard() {
    try {
      const res = await fetch(`/api/user/dashboard?user=${user.id}`);
      const json = await res.json();
      return json.error ? null : json;
    } catch {
      return null;
    }
  }

  function PaymentMethod(method) {
    const { id, type, available, is_default: isDefault } = method;
    const label = PAYMENT_METHOD_LABELS[type];
    const detail = paymentMethodDetail(method);
    const name = [label, detail].filter(Boolean).join(', ');

    return (
      <div className='payment-method' title={name} data-default={isDefault ? 'default' : ''} data-available={String(available)}>
        <span className={`icon ${PAYMENT_METHOD_ICONS[type]}`} role='img' aria-label={label} />
        <div className='info'>
          <span className='detail'>{detail || label}</span>
          {(isDefault || !available) && (
            <div className='badges'>
              {isDefault ? <span className='default-pill'>Default</span> : null}
              {!available && <span className='unavailable-pill'>Unavailable</span>}
            </div>
          )}
          {isSelf && available && !isDefault && (
            <button type='button' className='set-default' aria-label={`Set ${name} as default`} onclick={(e) => setDefault(e.currentTarget, id)}>
              Set as default
            </button>
          )}
        </div>
        <div className='actions'>
          {isSelf && (
            <button
              type='button'
              className='icon delete'
              aria-label={`Delete ${name}`}
              title={isDefault ? 'Set another payment method as default to delete this one' : 'Delete'}
              disabled={Boolean(isDefault)}
              onclick={(e) => deletePaymentMethod(e.currentTarget, id, name)}
            />
          )}
        </div>
      </div>
    );
  }

  /**
   * Short description that tells payment methods of the same type apart
   */
  function paymentMethodDetail(method) {
    switch (method.type) {
      case 'paypal':
        return method.paypal_email;
      case 'wallet':
        return [method.wallet_type, method.wallet_address].filter(Boolean).join(' · ');
      default:
        return [method.bank_name, method.bank_account_number].filter(Boolean).join(' · ');
    }
  }

  async function deletePaymentMethod(button, id, name) {
    const confirmation = await confirm('Delete payment method?', `${name} will be removed from your account. This cannot be undone.`, {
      okLabel: 'Delete',
    });
    if (confirmation) await changePaymentMethod(button, `/api/user/payment-method/${id}`, 'DELETE');
  }

  async function setDefault(button, id) {
    await changePaymentMethod(button, `/api/user/payment-method/update-default/${id}`, 'PATCH');
  }

  /**
   * Send a change and show the updated list.
   * @param {HTMLButtonElement} button Button clicked
   * @param {string} url
   * @param {'DELETE' | 'PATCH'} method
   */
  async function changePaymentMethod(button, url, method) {
    button.disabled = true;
    showLoading();
    try {
      const res = await fetch(url, { method });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      await renderPaymentMethods();
    } catch (error) {
      button.disabled = false;
      alert('Error', error.message);
    } finally {
      hideLoading();
    }
  }

  async function renderPaymentMethods() {
    const { el } = paymentMethods;
    const addButton = el.querySelector('.add-payment-method');
    const limitHint = el.querySelector('.payment-methods-hint');
    const clear = () => {
      for (const $el of el.querySelectorAll('.payment-method, .payment-methods-error')) $el.remove();
    };

    showLoading();
    try {
      const url = `/api/user/payment-methods?user=${user.id}`;
      const rows = await fetch(url).then((res) => res.json());
      if (rows.error) throw new Error(rows.error);
      clear();

      for (const row of rows) {
        el.insertBefore(<PaymentMethod {...row} />, addButton);
      }

      if (isSelf) {
        const limitReached = rows.length >= PAYMENT_METHOD_LIMIT;
        addButton.hidden = limitReached;
        limitHint.hidden = !limitReached;
      }
    } catch (error) {
      console.error('Failed to load payment methods:', error);
      clear();
      el.insertBefore(<p className='payment-methods-error'>Could not load payment methods. Reload the page to try again.</p>, addButton);
    } finally {
      hideLoading();
    }
  }

  /**
   * Verify or revoke user verification
   * @param {string} userId User id
   * @param {boolean} revoke Revoke verification or verify
   * @param {HTMLElement} button Button clicked
   */
  async function verifyUser(userId, revoke = false, button = null) {
    try {
      const confirmation = await confirm('WARNING', `Are you sure you want to ${revoke ? 'revoke verification of' : 'verify'} this user?`);
      if (!confirmation) return;
      const res = (
        await fetch(`/api/user/verify${revoke ? '/revoke' : ''}/${userId}`, {
          method: 'PATCH',
        })
      ).json();
      if (res.error) {
        throw new Error(res.error);
      }

      button.classList.toggle('grayscale');
    } catch (error) {
      alert('Error', error.message);
    }
  }

  function VerifyButton() {
    if (!user.verified && !loggedInUser?.isAdmin) return null;

    return (
      <span
        className={`icon verified ${user.verified ? '' : 'grayscale'}`}
        on:click={loggedInUser?.isAdmin ? (e) => verifyUser(user.id, user.verified, e.target) : null}
      />
    );
  }
}
