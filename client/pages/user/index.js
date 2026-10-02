import './style.scss';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import select from 'components/dialogs/select';
import Plugins from 'components/plugins';
import Tabs from 'components/tabs';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser, gravatar, hideLoading, showLoading } from 'lib/helpers';
import { applyProfileMetadata, beginProfileMetadataRequest } from 'lib/pageMetadata';
import Router from 'lib/Router';
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
        <div onclick={addPaymentMethod} className='add-payment-method' title='Add payment method to get paid.'>
          <span className='icon add' />
          <span>Add payment method</span>
        </div>
      )}
    </div>
  );

  if (shouldShowSensitiveInfo) {
    renderPaymentMethods();
  }

  const stats = shouldShowSensitiveInfo ? await fetchDashboard() : null;
  const isDeveloper = Boolean(stats && (stats.totals.plugins > 0 || stats.totals.lifetimeEarnings > 0));
  const params = new URLSearchParams(window.location.search);
  const linked = params.get('linked');
  if (linked) {
    const label = linked === 'github' ? 'GitHub' : 'Google';
    alert('Success', `${label} account linked successfully.`, () => {
      params.delete('linked');
      const newSearch = params.toString();
      Router.loadUrl(`${location.pathname}${newSearch ? `?${newSearch}` : ''}`);
    });
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
        <img src={user.avatar_url || gravatar(user.github)} alt={user.email} className='profile-image' />
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
                {Boolean(user.acode_pro) && (
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
            <a className='action' href='/profile/edit'>
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
        content: () => (stats ? <PluginManager plugins={stats.plugins} isSelf={isSelf} /> : Plugins({ user: user.id })),
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

  function PaymentMethod({ id, bank_account_number: bankAccountNumber, bank_account_type: bankAccountType, is_default: isDefault }) {
    isDefault = isDefault ? 'default' : '';
    let title = `${bankAccountType} ${bankAccountNumber}`;

    if (isDefault) {
      title += ' (default)';
    }

    return (
      <div on:click={onPaymentMethodClick} data-id={id} title={title} className='payment-method' data-default={isDefault}>
        <span className='icon account_balance' />
        <div className='info'>
          <strong>{bankAccountType}</strong>
          <span>{bankAccountNumber}</span>
        </div>
        {isDefault && <span className='default-pill'>Default</span>}
      </div>
    );
  }

  /**
   * Give options to delete, set as default option.
   * @param {MouseEvent} e
   */
  async function onPaymentMethodClick(e) {
    if (!isSelf) return;
    try {
      const { title } = e.target;
      const option = await select(title, ['Delete', 'Set as default']);
      if (option === 'Delete') {
        const confirmation = await confirm('WARNING', `Are you sure you want to delete this payment method? This action cannot be undone. ${title}`);
        if (!confirmation) return;
        showLoading();
        const res = await fetch(`/api/user/payment-method/${e.target.dataset.id}`, {
          method: 'DELETE',
        }).then((paymentRes) => paymentRes.json());
        if (res.error) {
          throw new Error(res.error);
        }

        renderPaymentMethods();
        alert('Success', 'Payment method deleted.');
        return;
      }

      if (option === 'Set as default') {
        showLoading();
        const res = await fetch(`/api/user/payment-method/update-default/${e.target.dataset.id}`, {
          method: 'PATCH',
        }).then((paymentRes) => paymentRes.json());
        if (res.error) {
          throw new Error(res.error);
        }

        renderPaymentMethods();
        alert('Success', 'Payment method set as default.');
      }
    } catch (error) {
      alert('Error', error.message);
    } finally {
      hideLoading();
    }
  }

  /**
   * Add payment method
   */
  async function addPaymentMethod() {
    Router.loadUrl('/add-payment-method/bank-account');
  }

  async function renderPaymentMethods() {
    showLoading();
    try {
      const url = `/api/user/payment-methods?user=${user.id}`;
      const rows = await fetch(url).then((res) => res.json());
      const { el } = paymentMethods;
      const lastChild = el.lastElementChild;

      for (const $el of el.getAll('.payment-method')) {
        $el.remove();
      }

      for (const row of rows) {
        el.insertBefore(<PaymentMethod {...row} />, lastChild);
      }
    } catch (error) {
      paymentMethods.innerHTML = <div className='error'>{error.message}</div>;
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
