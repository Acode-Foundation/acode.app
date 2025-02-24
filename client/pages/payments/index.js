import './style.scss';
import alert from 'components/dialogs/alert';
import DialogBox from 'components/dialogs/dialogBox';
import select from 'components/dialogs/select';
import Ref from 'html-tag-js/ref';

export default function Payments() {
  const list = Ref();
  const paymentMethod = Ref();
  const $paymentDialog = (
    <DialogBox oncancel={(hide) => hide()}>
      <table ref={paymentMethod} className='payment-method' />
    </DialogBox>
  );

  list.onref = async () => {
    try {
      const data = await fetch('/api/admin/payments').then((res) => res.json());

      if (data.error) {
        throw new Error(data.error);
      }

      for (const item of data) {
        list.append(Payment(item));
      }
    } catch (err) {
      alert('ERROR', err.message || err);
    }
  };

  return (
    <div id='payments'>
      <h1>Payments</h1>
      <div className='payments'>
        <ul ref={list} className='list' />
      </div>
    </div>
  );

  function Payment({ id, amount, user_name: name, user_email: email, status, created_at: date, payment_method_id: paymentId }) {
    return (
      <li data-id={id} className={`payment ${status}`} onclick={() => renderPaymentMethod(id, paymentId)}>
        <div className='group'>
          <strong onclick={updateStatus} data-id={id} className='status'>
            {status}
          </strong>
          <span className='date'>{new Date(date).toLocaleDateString()}</span>
        </div>
        <span className='amount'>&#8377; {amount}</span>
        <div className='group'>
          <span className='name'>{name}</span>
          &lt;<span className='email'>{email}</span>&gt;
        </div>
      </li>
    );
  }

  /**
   * Update payment status
   * @param {MouseEvent} e
   * @returns
   */
  async function updateStatus(e) {
    e.preventDefault();
    e.stopPropagation();

    const { id } = e.target.dataset;
    const status = await select('Select Status', ['none', 'paid', 'initiated']);
    if (!status) return;

    try {
      const body = new FormData();

      body.append('id', id);
      body.append('status', status);

      const data = await fetch('/api/admin/payment', {
        method: 'PATCH',
        body,
      }).then((res) => res.json());

      if (data.error) {
        throw new Error(data);
      }

      const old = list.get(`[data-id='${id}']`);
      const el = Payment(data);

      old.replaceWith(el);
      el.click();
    } catch (err) {
      alert('ERROR', err.message || err);
    }
  }

  async function renderPaymentMethod(id, pmId) {
    try {
      list.get('li.active')?.classList.remove('active');
      list.get(`[data-id='${id}']`)?.classList.add('active');
      const data = await fetch(`/api/admin/payment-method/${pmId}`).then((res) => res.json());

      if (data.error) {
        throw new Error(data.error);
      }

      paymentMethod.el.content = (
        <>
          {data.bank_account_number && (
            <tr>
              <th>Account</th>
              <td>
                <span>{data.bank_name}</span>
                <br />
                <strong>{data.bank_account_number}</strong>
                <br />
                <span>
                  {data.bank_account_type} ({data.bank_account_holder})
                </span>
                <br />
                <span>IFSC: {data.bank_ifsc_code}</span>
                <br />
                <span>SWIFT: {data.bank_swift_code}</span>
              </td>
            </tr>
          )}
          {data.paypal_email && (
            <tr>
              <th>Paypal Email</th>
              <td>{data.paypal_email}</td>
            </tr>
          )}
          {data.wallet_address && (
            <tr>
              <th>Wallet</th>
              <td>
                <span>{data.wallet_type}</span>
                <br />
                <strong>{data.wallet_address}</strong>
              </td>
            </tr>
          )}
          <tr>
            <th>User</th>
            <td>{data.user_name}</td>
          </tr>
          <tr>
            <th>Email</th>
            <td>{data.user_email}</td>
          </tr>
        </>
      );
      document.body.append($paymentDialog);
    } catch (err) {
      alert('ERROR', err.message || err);
    }
  }
}
