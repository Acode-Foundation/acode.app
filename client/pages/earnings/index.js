import './style.scss';
import alert from 'components/dialogs/alert';
import prompt from 'components/dialogs/prompt';
import MonthSelect from 'components/MonthSelect';
import YearSelect from 'components/YearSelect';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { hideLoading, showLoading } from 'lib/helpers';
import moment from 'moment';

let loggedInUser;

export default async function Earnings({ user, threshold }) {
  loggedInUser = user;

  if (!threshold) {
    const userData = await fetchJson(user);
    threshold = userData.threshold;
  }

  const paymentsTable = Ref();
  const earningsYear = Ref();
  const earningsMonth = Ref();
  const paymentsYear = Ref();
  const earnings = Reactive('Loading...');
  const thresholdText = Reactive(threshold.toLocaleString());

  let unpaidEarnings;
  try {
    unpaidEarnings = await fetchJson('unpaid-earnings');
  } catch (error) {
    return <span className='error'>{error.message}</span>;
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
                <span title='Your earnings'>&#8377; {earnings}</span>
              </td>
            </tr>
            <tr>
              <th>Unpaid earnings</th>
              <td>
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
                      <p>Earnings from previous month will be calculated after 16th of this month.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <th>Payment Threshold</th>
              <td>
                <div on:click={updateThreshold}>
                  &#8377; {thresholdText} {loggedInUser !== '1' && <span className='icon create' />}
                </div>
                <p>
                  You will be paid when your earnings reach this amount. Please read <a href='/terms'>Terms of Service</a> "Payment threshold" section
                  for more info.
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

  async function updateThreshold() {
    const newThreshold = await prompt('Enter new threshold amount', {
      type: 'number',
      defaultValue: threshold,
    });
    if (!newThreshold) return;
    try {
      showLoading();
      await fetch('/api/user/threshold', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ threshold: newThreshold }),
      });
      thresholdText.value = newThreshold.toLocaleString();
    } catch (error) {
      alert('Error', error.message);
    } finally {
      hideLoading();
    }
  }

  /**
   * Renders earnings table
   */
  async function updateEarnings() {
    try {
      showLoading();
      const selectedYear = earningsYear.el.value;
      const selectedMonth = earningsMonth.el.value;
      const totalEarnings = await fetchJson(`earnings/${selectedYear}/${selectedMonth}`);

      earnings.value = totalEarnings.earnings.toLocaleString();
    } catch (error) {
      earnings.value = error.message;
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
  const { paypal_email: paypalEmail, bank_name: bankName, bank_account_number: bankAccountNumber } = props;
  let method;

  if (paypalEmail) {
    method = (
      <div>
        <span className='icon paypal' />
        <span>{paypalEmail}</span>
      </div>
    );
  } else {
    method = (
      <div>
        <span className='icon bank' />
        <span>{bankName}</span>
        <span>{bankAccountNumber}</span>
      </div>
    );
  }

  return (
    <tr>
      <td className='download'>{moment(props.created_at).format('DD MMM YYYY')}</td>
      <td className='amount'>&#8377; {props.amount.toLocaleString()}</td>
      <td className='payment-method'>{method}</td>
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
    throw new Error(json.error);
  }
  return json;
}
