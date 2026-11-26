import './style.scss';
import alert from 'components/dialogs/alert';
import MonthSelect from 'components/MonthSelect';
import YearSelect from 'components/YearSelect';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { hideLoading, showLoading } from 'lib/helpers';
import moment from 'moment';
import { PAYMENT_METHOD_ICONS, PAYMENT_METHOD_LABELS } from '../../../shared/paymentMethods';

let loggedInUser;

export default async function Earnings({ user }) {
  loggedInUser = user;

  const paymentsTable = Ref();
  const earningsYear = Ref();
  const earningsMonth = Ref();
  const paymentsYear = Ref();
  const earnings = Reactive('Loading...');

  let unpaidEarnings;
  let unpaidError;
  try {
    unpaidEarnings = await fetchJson('unpaid-earnings');
  } catch (error) {
    unpaidError = error.status === 409 ? 'Earnings under review. Unpaid balance is unavailable.' : error.message;
  }

  earningsMonth.onref = updateEarnings;
  paymentsTable.onref = renderPaymentsTable;

  return (
    <section id='earnings'>
      <h2 style={{ textAlign: 'center' }}>Earnings</h2>
      <div className='table-wrapper'>
        <table className='info'>
          <tbody>
            <tr>
              <th>Month</th>
              <td>
                <YearSelect ref={earningsYear} onChange={updateEarnings} />
                <MonthSelect ref={earningsMonth} onChange={updateEarnings} />
              </td>
            </tr>
            <tr>
              <th>Total Earnings</th>
              <td>
                <span title='Your earnings'>{earnings}</span>
              </td>
            </tr>
            <tr>
              <th>Unpaid earnings</th>
              <td>
                {unpaidEarnings ? (
                  <table className='mini-info'>
                    <tr>
                      <td attr-colspan='2'>&#8377; {unpaidEarnings.earnings.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <th>From</th>
                      <th>To</th>
                    </tr>
                    <tr>
                      <td>{new Date(unpaidEarnings.from).toLocaleDateString()}</td>
                      <td>{new Date(unpaidEarnings.to).toLocaleDateString()}</td>
                    </tr>
                    <tr>
                      <td attr-colspan='2'>
                        <p>Earnings for each month are calculated on the 16th of the next month.</p>
                      </td>
                    </tr>
                  </table>
                ) : (
                  <span role='status'>{unpaidError}</span>
                )}
              </td>
            </tr>
            <tr>
              <th>Payment Threshold</th>
              <td>
                <div>{unpaidEarnings ? `₹ ${unpaidEarnings.threshold.toLocaleString()}` : 'Unavailable'}</div>
                <p>
                  Eligible payouts are initiated on the 16th and processed within 10 business days. <a href='/terms'>Payout terms</a>.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className='table-wrapper'>
        <table className='payments'>
          <thead>
            <th>
              <strong>Payments</strong>
            </th>
            <th attr-colspan={4}>
              <YearSelect ref={paymentsYear} onChange={renderPaymentsTable} />
            </th>
          </thead>
          <thead>
            <th>Date</th>
            <th>Amount</th>
            <th>Payment Method</th>
            <th>Status</th>
            <th>Receipt</th>
          </thead>
          <tbody ref={paymentsTable} />
        </table>
      </div>
    </section>
  );

  /**
   * Renders earnings table
   */
  async function updateEarnings() {
    try {
      showLoading();
      const selectedYear = earningsYear.el.value;
      const selectedMonth = earningsMonth.el.value;
      const totalEarnings = await fetchJson(`earnings/${selectedYear}/${selectedMonth}`);

      earnings.value = `₹ ${totalEarnings.earnings.toLocaleString()}`;
    } catch (error) {
      earnings.value = error.status === 409 ? 'Earnings under review' : error.message;
    } finally {
      hideLoading();
    }
  }

  /**
   * Render payments table
   */
  async function renderPaymentsTable() {
    try {
      showLoading();
      const year = paymentsYear.el.value;
      const payments = await fetchJson(`payments/${year}`);
      let content = <td attr-colspan={4}>No payments yet.</td>;
      if (payments.length) {
        content = payments.map((payment) => <Payment {...payment} />);
      }
      paymentsTable.el.content = content;
    } catch (error) {
      alert('Error', error.message);
    } finally {
      hideLoading();
    }
  }
}

function Payment(props) {
  const { payment_method_type: type, bank_name: bankName, bank_account_number: bankAccountNumber } = props;
  const details = { paypal: props.paypal_email, wallet: [props.wallet_type, props.wallet_address].filter(Boolean).join(' ') };
  const detail = details[type] ?? bankAccountNumber;

  return (
    <tr>
      <td className='download'>{moment(props.created_at).format('DD MMM YYYY')}</td>
      <td className='amount'>&#8377; {props.amount.toLocaleString()}</td>
      <td className='payment-method'>
        <div>
          <span className={`icon ${PAYMENT_METHOD_ICONS[type] || 'bank'}`} />
          <span>{bankName || PAYMENT_METHOD_LABELS[type]}</span>
          <span>{detail}</span>
        </div>
      </td>
      <td className='status'>{props.status}</td>
      <td className='download'>
        <button type='button' onclick={() => window.open(`/api/user/receipt/${props.id}`, '_blank')} title='download' className='icon download' />
      </td>
    </tr>
  );
}

/**
 * Fetch json data from server
 * @param {string} url
 */
async function fetchJson(url) {
  const res = await fetch(`/api/user/${url}?user=${loggedInUser}`);
  const json = await res.json();
  if (json.error) {
    throw Object.assign(new Error(json.error), { status: res.status });
  }
  return json;
}
