import './style.scss';
import userImage from 'res/user.png';
import {
  getLoggedInUser, gravatar, hideLoading, showLoading,
} from 'lib/helpers';
import Router from 'lib/Router';
import Plugins from 'components/plugins';
import moment from 'moment';
import Ref from 'html-tag-js/ref';
import select from 'components/dialogs/select';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import Earnings from 'pages/earnings';

export default async function User({ userEmail }) {
  const amount = new Ref();
  const loggedInUser = await getLoggedInUser();
  let user;

  if (userEmail) {
    try {
      const res = await fetch(`/api/user/${userEmail}`);
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
    Router.loadUrl('/login?redirect=/user');
    return <>Redirecting to login...</>;
  }

  const isSameUser = loggedInUser && loggedInUser.id === user.id;
  const shouldShowSensitiveInfo = isSameUser || loggedInUser?.isAdmin;
  const paymentMethods = new Ref();
  const img = new Ref();

  // get user image from github
  const ghImage = gravatar(user.github);

  // check if github user has image
  fetch(ghImage).then((res) => {
    if (res.status === 200) {
      img.el.src = ghImage;
    }
  });

  if (shouldShowSensitiveInfo) {
    renderEarnings();
    renderPaymentMethods();
  }

  return <section id='user'>
    <div className='profile'>
      <img ref={img} src={userImage} alt="" className="profile-image" />
      <div className='profile-info'>
        <h1>
          <span>{user.name}</span>
          <VerifyButton />
        </h1>
        {
          shouldShowSensitiveInfo
            ? <small className='link earnings' title='Your earnings for this month'>
              <strong className='loading' ref={amount}></strong>|<span>{moment().format('YYYY MMMM')}</span>
            </small>
            : ''
        }
        <div onwheel={onwheel} ref={paymentMethods} className='payment-methods'>{
          loggedInUser?.id === user.id
            ? <div onclick={addPaymentMethod} className='add-payment-method' title='Add payment method to get paid.'>
              <span className='icon add'></span>
              <span>Payment method</span>
            </div>
            : ''
        }</div>
        <div className="socials">
          <a title='email' className='icon mail' href={`mailto:${user.email}`}></a>
          {
            user.github
              ? <a title='go to github account' className='icon github' href={`https://github.com/${user.github}`}></a>
              : ''
          }
          {
            user.website
              ? <a title='go to website' className='icon earth' href={user.website}></a>
              : ''
          }
          {
            isSameUser
              ? <a title='edit profile' href='/edit-user' className='icon create'></a>
              : ''
          }
          {
            loggedInUser?.id === user.id
              ? <a title='logout' className="icon logout danger" href='/logout'></a>
              : ''
          }
        </div>
        {
          isSameUser
            ? <a href='/publish'>Publish Plugin</a>
            : ''
        }
      </div>
    </div>
    {await (<Plugins user={user?.email || userEmail} />)}
  </section>;

  /**
   * Scroll payment methods horizontally on mouse wheel
   * @param {WheelEvent} e
   */
  function onwheel(e) {
    e.preventDefault();
    this.scrollLeft += e.deltaY;
  }

  function PaymentMethod({
    id,
    paypal_email: paypalEmail,
    bank_account_number: bankAccountNumber,
    bank_account_type: bankAccountType,
    is_default: isDefault,
    wallet_address: walletAddress,
    wallet_type: walletType,
  }) {
    isDefault = isDefault ? 'default' : '';
    let title = paypalEmail ? `PayPal ${paypalEmail}` : `${bankAccountType} ${bankAccountNumber}`;

    if (isDefault) {
      title += ' (default)';
    }

    if (paypalEmail) {
      return <div on:click={onPaymentMethodClick} title={title} data-id={id} className='payment-method' data-default={isDefault}>
        <span className='icon paypal'></span>
        <span className='info'>{paypalEmail}</span>
      </div>;
    }

    if (walletAddress && walletType) {
      return <div on:click={onPaymentMethodClick} data-id={id} title={title} className='payment-method' data-default={isDefault}>
        <span className='icon bitcoin'></span>
        <div className='info'>
          <strong>{walletType}</strong>
          <span>{walletAddress}</span>
        </div>
      </div>;
    }

    return <div on:click={onPaymentMethodClick} data-id={id} title={title} className='payment-method' data-default={isDefault}>
      <span className='icon account_balance'></span>
      <div className='info'>
        <strong>{bankAccountType}</strong>
        <span>{bankAccountNumber}</span>
      </div>
    </div>;
  }

  /**
   * Give options to delete, set as default option.
   * @param {MouseEvent} e
   */
  async function onPaymentMethodClick(e) {
    if (!isSameUser) return;
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
    const option = await select('Add payment method', ['Paypal', 'Bank account', 'Crypto']);
    Router.loadUrl(`/add-payment-method/${option.toLowerCase().replace(' ', '-')}`);
  }

  async function renderPaymentMethods() {
    showLoading();
    try {
      const url = `/api/user/payment-methods?user=${user.id}`;
      const rows = await fetch(url).then((res) => res.json());
      const { el } = paymentMethods;
      const lastChild = el.lastElementChild;

      el.getAll('.payment-method').forEach(($el) => $el.remove());

      rows.forEach((row) => {
        el.insertBefore(<PaymentMethod {...row} />, lastChild);
      });
    } catch (error) {
      paymentMethods.innerHTML = <div className='error'>{error.message}</div>;
    } finally {
      hideLoading();
    }
  }

  async function renderEarnings() {
    try {
      const now = moment();
      const res = await (
        await fetch(`/api/user/earnings/${now.year()}/${now.month()}?user=${user.id}`)
      ).json();

      if (res.error) {
        amount.innerHTML = `<span class="error">${res.error}</span>`;
        return;
      }

      amount.innerHTML = `&#8377; ${res.earnings?.toLocaleString() || 0}`;
      amount.classList.remove('loading');
      amount.el.parentElement.onclick = async () => {
        Router.setUrl(`/earnings?user=${user.id}`);
        showLoading();
        tag.get('main').content = await Earnings({ user: user.id, threshold: user.threshold });
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
      const res = (await fetch(`/api/user/verify${revoke ? '/revoke' : ''}/${userId}`, {
        method: 'PATCH',
      })).json();
      if (res.error) {
        throw new Error(res.error);
      }

      button.classList.toggle('grayscale');
    } catch (error) {
      alert('Error', error.message);
    }
  }

  function VerifyButton() {
    if (!user.verified && !loggedInUser.isAdmin) return <span></span>;

    return <span className={`icon verified ${user.verified ? '' : 'grayscale'}`} on:click={
      loggedInUser?.isAdmin
        ? (e) => verifyUser(user.id, user.verified, e.target)
        : null
    }></span>;
  }
}
