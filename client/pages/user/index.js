import './style.scss';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import select from 'components/dialogs/select';
import Plugins from 'components/plugins';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser, gravatar, hideLoading, showLoading } from 'lib/helpers';
import Router from 'lib/Router';
import moment from 'moment';
import Earnings from 'pages/earnings';

export default async function User({ userId }) {
  const amount = Ref();
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

  const isSelf = loggedInUser && loggedInUser.id === user.id;
  const shouldShowSensitiveInfo = Boolean(isSelf || loggedInUser?.isAdmin);
  const paymentMethods = Ref();

  if (shouldShowSensitiveInfo) {
    renderEarnings();
    renderPaymentMethods();
  }

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
                {isSelf && user.role === 'admin' && <small className='tag'>Admin</small>}
                {Boolean(user.acode_pro) && <small className='tag pro-tag'>Pro</small>}
              </div>
            </div>
          </h1>
          {shouldShowSensitiveInfo && (
            <>
              <small className='link earnings' title='Your earnings for this month'>
                <strong className='loading' ref={amount} />|<span>{moment().format('YYYY MMMM')}</span>
              </small>
              <div onwheel={onwheel} ref={paymentMethods} className='payment-methods'>
                {isSelf && (
                  <div onclick={addPaymentMethod} className='add-payment-method' title='Add payment method to get paid.'>
                    <span className='icon add' />
                    <span>Payment method</span>
                  </div>
                )}
              </div>
            </>
          )}
          <div className='socials' data-show-sensitive-info={String(shouldShowSensitiveInfo)}>
            {user.website && (
              <a href={user.website} target='_blank' rel='noopener'>
                <span className='icon earth' />
                <span className='label'>{user.website}</span>
              </a>
            )}
            {user.github && (
              <a href={`https://github.com/${user.github}`} target='_blank' rel='noopener'>
                <span className='icon github' />
                <span className='label'>@{user.github}</span>
              </a>
            )}
            {user.x && (
              <a href={`https://x.com/@${user.x}`} target='_blank' rel='noopener'>
                <span className='icon x' />
                <span className='label'>@{user.x}</span>
              </a>
            )}
            {user.linkedin && (
              <a href={`https://linkedin.com/in/${user.linkedin}`} target='_blank' rel='noopener'>
                <span className='icon linkedin' />
                <span className='label'>{user.linkedin}</span>
              </a>
            )}
          </div>
          {isSelf && <a href='/publish'>Publish Plugin</a>}
        </div>
      </div>
      <Plugins user={user.id} />
    </section>
  );

  /**
   * Scroll payment methods horizontally on mouse wheel
   * @param {WheelEvent} e
   */
  function onwheel(e) {
    e.preventDefault();
    this.scrollLeft += e.deltaY;
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

  async function renderEarnings() {
    try {
      const now = moment();
      const res = await (await fetch(`/api/user/earnings/${now.year()}/${now.month()}?user=${user.id}`)).json();

      if (res.error) {
        amount.innerHTML = `<span class="error">${res.error}</span>`;
        return;
      }

      amount.innerHTML = `&#8377; ${res.earnings?.toLocaleString() || 0}`;
      amount.classList.remove('loading');
      amount.el.parentElement.onclick = async () => {
        Router.setUrl(`/earnings?user=${user.id}`);
        showLoading();
        tag.get('main').content = await Earnings({ user: user.id });
        hideLoading();
      };
    } catch (error) {
      amount.innerHTML = `<span class="error">${error.message}</span>`;
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
