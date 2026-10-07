import './style.scss';
import '../user/style.scss';
import alert from 'components/dialogs/alert';
import MonthSelect from 'components/MonthSelect';
import YearSelect from 'components/YearSelect';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { hideLoading, showLoading } from 'lib/helpers';
import moment from 'moment';

let loggedInUser;

export default async function Earnings({ user }) {
  loggedInUser = user;

  const paymentsList = Ref();
  const earningsYear = Ref();
  const earningsMonth = Ref();
  const paymentsYear = Ref();
  const earnings = Reactive('...');

  let unpaidEarnings;
  try {
    unpaidEarnings = await fetchJson('unpaid-earnings');
  } catch (error) {
    return <span className='error'>{error.message}</span>;
  }

  earningsMonth.onref = updateEarnings;
  paymentsList.onref = renderPaymentsTable;

  return (
    <section id='earnings'>
      <div className='profile'>
        <div className='profile-info'>
          <h1>Earnings</h1>
        </div>
      </div>

      <div className='dash-grid' style={{ marginTop: '20px' }}>
        <div className='panel'>
          <div className='panel-head'>
            <h3>Selected Month</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <YearSelect ref={earningsYear} onChange={updateEarnings} />
              <MonthSelect ref={earningsMonth} onChange={updateEarnings} />
            </div>
          </div>
          <div className='stat-value'>&#8377; {earnings}</div>
          <div className='stat-sub'>Total earnings for the period</div>
        </div>

        <div className='panel'>
          <div className='panel-head'>
            <h3>Unpaid Earnings</h3>
          </div>
          <div className='stat-value'>&#8377; {unpaidEarnings.earnings.toLocaleString()}</div>
          <div className='stat-sub'>
            From {new Date(unpaidEarnings.from).toLocaleDateString()} to {new Date(unpaidEarnings.to).toLocaleDateString()}
          </div>
          <div className='panel-meta' style={{ marginTop: 'auto', paddingTop: '12px' }}>
            Earnings from previous month will be calculated after 16th of this month.
          </div>
        </div>

        <div className='panel'>
          <div className='panel-head'>
            <h3>Payment Threshold</h3>
          </div>
          <div className='stat-value'>&#8377; {unpaidEarnings.threshold.toLocaleString()}</div>
          <div className='stat-sub'>Minimum amount for payout</div>
          <div className='panel-meta' style={{ marginTop: 'auto', paddingTop: '12px' }}>
            You will be paid when your earnings reach this amount. Read <a href='/terms'>Terms of Service</a>.
          </div>
        </div>
      </div>

      <div className='panel' style={{ marginTop: '16px' }}>
        <div className='panel-head'>
          <h3>Payment History</h3>
          <YearSelect ref={paymentsYear} onChange={renderPaymentsTable} />
        </div>
        <div className='payment-methods' ref={paymentsList}></div>
      </div>
    </section>
  );

  async function updateEarnings() {
    try {
      showLoading();
      const selectedYear = earningsYear.el.value;
      const selectedMonth = earningsMonth.el.value;
      const response = await fetchJson(`earnings/${selectedYear}/${selectedMonth}`);

      earnings.value = response.earnings !== undefined ? response.earnings.toLocaleString() : '0';
    } catch (error) {
      earnings.value = 'Error';
    } finally {
      hideLoading();
    }
  }

  async function renderPaymentsTable() {
    try {
      showLoading();
      const year = paymentsYear.el.value;
      const payments = await fetchJson(`payments/${year}`);
      let content = <div className='panel-empty'>No payments yet.</div>;
      if (payments.length) {
        content = payments.map((payment) => <Payment {...payment} />);
      }
      paymentsList.el.content = content;
    } catch (error) {
      alert('Error', error.message);
    } finally {
      hideLoading();
    }
  }
}

function Payment(props) {
  const { bank_name: bankName, bank_account_number: bankAccountNumber } = props;
  const statusLower = String(props.status).toLowerCase();
  const statusClass = statusLower === 'paid' ? 'live' : statusLower === 'pending' ? 'pending' : 'rejected';

  return (
    <div className='payment-method'>
      <div className='info' style={{ flex: '1 1 0' }}>
        <strong>&#8377; {props.amount.toLocaleString()}</strong>
        <span>{moment(props.created_at).format('DD MMM YYYY')}</span>
      </div>
      <div className='info' style={{ flex: '2 1 0' }}>
        <strong style={{ textTransform: 'none' }}>{bankName}</strong>
        <span>{bankAccountNumber}</span>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span className={`status-chip status-chip--${statusClass}`}>
          {props.status}
        </span>
        <button type='button' onclick={() => window.open(`/api/user/receipt/${props.id}`, '_blank')} title='Download receipt' className='icon-action'>
          <span className='icon download' />
        </button>
      </div>
    </div>
  );
}

async function fetchJson(url) {
  const res = await fetch(`/api/user/${url}?user=${loggedInUser}`);
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error);
  }
  return json;
}
