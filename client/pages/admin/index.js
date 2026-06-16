import './style.scss';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import DialogBox from 'components/dialogs/dialogBox';
import select from 'components/dialogs/select';
import Input from 'components/input';
import Tabs from 'components/tabs';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser } from 'lib/helpers';
import moment from 'moment';

export default async function Admin() {
  const usersList = Ref();
  const loggedInUser = await getLoggedInUser();
  if (!loggedInUser?.isAdmin) {
    return <div className='error'>Access denied</div>;
  }

  return (
    <section ref={usersList} id='admin'>
      <h1>Admin Panel</h1>
      <Tabs
        defaultActive='dashboard'
        tabs={[
          { id: 'dashboard', label: 'Dashboard', content: <Dashboard /> },
          { id: 'settings', label: 'Settings', content: <AppSettings /> },
          { id: 'users', label: 'Users', content: <Users /> },
          { id: 'email', label: 'Email', content: <EmailUsers /> },
          { id: 'payments', label: 'Payments', content: <Payments /> },
          { id: 'promotions', label: 'Promotions', content: <Promotions /> },
          { id: 'sponsors', label: 'Sponsors', content: <Sponsors /> },
        ]}
      />
    </section>
  );
}

function Sponsors() {
  const currentPage = Reactive(1);
  const totalPages = Reactive(-1);
  const limit = 10;
  const ref = Ref(goTo.bind(null, 1));

  return (
    <div className='sponsors'>
      <div className='table-container'>
        <table className='info'>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Tier</th>
              <th>Email</th>
              <th>Status</th>
              <th>Created</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody on:click={sponsorClickHandler} ref={ref} />
        </table>
      </div>
      <div className='pagination'>
        <button type='button' on:click={() => goTo(--currentPage.value)} title='previous page' className='icon navigate_before' /> {currentPage}/
        {totalPages} <button type='button' on:click={() => goTo(++currentPage.value)} title='next page' className='icon navigate_next' />
      </div>
    </div>
  );

  async function goTo(page) {
    if (totalPages.value === 0) {
      currentPage.value = 0;
      return;
    }

    if (page < 1) {
      page = 1;
      currentPage.value = 1;
    } else if (totalPages.value > 0 && page > totalPages.value) {
      currentPage.value = totalPages.value;
      return;
    }

    const res = await fetch(`/api/admin/sponsors?page=${page}&limit=${limit}`);
    if (!res.ok) {
      ref.innerHTML = 'Failed to load sponsors';
      return;
    }
    const { sponsors, pages } = await res.json();
    if (!Array.isArray(sponsors)) {
      ref.innerHTML = 'Failed to load sponsors';
      return;
    }
    totalPages.value = pages || 0;

    if (pages === 0) {
      currentPage.value = 0;
      ref.innerHTML = '';
      return;
    }

    currentPage.value = page;
    ref.innerHTML = '';
    ref.append(
      ...sponsors.map((s) => {
        const expired = s.expires_at && new Date(s.expires_at) < new Date();
        let statusLabel = 'Pending';
        if (expired) {
          statusLabel = 'Expired';
        } else if (s.status === 0) {
          statusLabel = 'Active';
        } else if (s.status === 1) {
          statusLabel = 'Canceled';
        }
        const statusClass = expired ? 'status-expired' : '';
        return (
          <tr id={`sponsor-${s.id}`}>
            <td>{s.id}</td>
            <td>{s.name}</td>
            <td>{s.tier}</td>
            <td>{s.email}</td>
            <td className={statusClass}>{statusLabel}</td>
            <td>{moment(s.created_at).format('DD-MM-YY')}</td>
            <td style={{ textAlign: 'center' }}>
              <span data-action='delete' data-sponsor-id={s.id} className='icon delete' />
            </td>
          </tr>
        );
      }),
    );
  }

  async function sponsorClickHandler(e) {
    const { action, sponsorId } = e.target.dataset;
    if (action === 'delete') {
      const confirmation = await confirm('WARNING', 'Are you sure you want to delete this sponsor?');
      if (confirmation) {
        try {
          const res = await fetch(`/api/sponsors/${sponsorId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Delete failed');
          goTo(currentPage.value);
        } catch {
          alert('Error', 'Failed to delete sponsor');
        }
      }
    }
  }
}

function Dashboard() {
  const ref = Ref();
  (async () => {
    const res = await fetch('api/admin/');
    const { users, amountPaid, pluginSales, pluginDownloads } = await res.json();
    ref.append(
      ...(
        <>
          <Card title='Users' text={users} />
          <Card title='Amount Paid' text={amountPaid || 0} />
          <Card title='Plugin Sales' text={pluginSales || 0} />
          <Card title='Plugin Downloads' text={pluginDownloads || 0} />
          <Card
            title='Download Report'
            icon='download'
            onclick={() => {
              const date = new Date();
              const year = date.getFullYear();
              const month = date.getMonth();
              window.open(`api/admin/reports/${year}/${month}`);
            }}
          />
        </>
      ),
    );
  })();
  return <div ref={ref} className='dashboard' />;
}

/**
 * Card component to display title and content
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.text]
 * @param {string} [props.icon]
 * @param {()=>{}} [props.onclick]
 */
function Card({ title, text, icon, onclick }) {
  return (
    <div className='card' onclick={onclick}>
      {icon ? <span className={`content icon ${icon}`} /> : <span className='content'>{text?.toLocaleString()}</span>}
      <span className='title'>{title}</span>
    </div>
  );
}

function AppSettings() {
  const priceRef = Ref();
  const thresholdRef = Ref();
  const priceStatusRef = Ref();
  const thresholdStatusRef = Ref();

  (async () => {
    try {
      const res = await fetch('/api/admin/config');
      const config = await res.json();
      if (priceRef.el) {
        priceRef.el.value = config.acode_pro_price;
      }
      if (thresholdRef.el) {
        thresholdRef.el.value = config.payment_threshold;
      }
    } catch {
      const msg = 'Failed to load config';
      if (priceStatusRef.el) priceStatusRef.el.textContent = msg;
      if (thresholdStatusRef.el) thresholdStatusRef.el.textContent = msg;
    }
  })();

  const onSave = async (key) => {
    let value;
    let numValue;

    if (key === 'acode_pro_price') {
      if (!priceRef.el) return;
      value = priceRef.el.value;
      numValue = Number(value);
      if (Number.isNaN(numValue) || numValue <= 0) {
        alert('ERROR', 'Price must be a positive number');
        return;
      }
    } else if (key === 'payment_threshold') {
      if (!thresholdRef.el) return;
      value = thresholdRef.el.value;
      numValue = Number(value);
      if (Number.isNaN(numValue) || numValue <= 0 || !Number.isInteger(numValue)) {
        alert('ERROR', 'Threshold must be a positive integer');
        return;
      }
    }

    const statusEl = key === 'acode_pro_price' ? priceStatusRef.el : thresholdStatusRef.el;
    if (!statusEl) return;

    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const json = await res.json();
      if (json.error) {
        alert('ERROR', json.error);
      } else {
        statusEl.textContent = 'Saved!';
        setTimeout(() => {
          statusEl.textContent = '';
        }, 2000);
      }
    } catch {
      alert('ERROR', 'Failed to save config');
    }
  };

  return (
    <div className='app-settings'>
      <div className='setting-row'>
        <label>Acode Pro Price (INR)</label>
        <div className='setting-input'>
          <input ref={priceRef} type='number' min='1' step='1' placeholder='370' />
          <button type='button' onclick={() => onSave('acode_pro_price')}>
            Save
          </button>
          <span ref={priceStatusRef} className='status' />
        </div>
      </div>
      <div className='setting-row'>
        <label>Payment Threshold (INR)</label>
        <div className='setting-input'>
          <input ref={thresholdRef} type='number' min='1' step='1' placeholder='15000' />
          <button type='button' onclick={() => onSave('payment_threshold')}>
            Save
          </button>
          <span ref={thresholdStatusRef} className='status' />
        </div>
      </div>
    </div>
  );
}

function Users() {
  const currentPage = Reactive(0);
  const totalPages = Reactive(1);
  const limit = 10;
  const ref = Ref(goTo.bind(null, currentPage.value));
  let debounceTimer;
  let name = '';
  let email = '';

  const oninput = (e) => {
    const { value } = e.target;
    if (e.target.name === 'name') {
      name = value;
    } else {
      email = value;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => goTo(1), 500);
  };

  return (
    <div className='users'>
      <div className='table-container'>
        <table className='info'>
          <thead>
            <tr>
              <th>ID</th>
              <th>
                <Input oninput={oninput} name='name' type='search' label='Name' placeholder='Search by name' />
              </th>
              <th>
                <Input oninput={oninput} name='email' type='search' label='Email' placeholder='Search by email' />
              </th>
              <th>Joined</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody on:click={clickHandler} ref={ref} />
        </table>
      </div>
      <div className='pagination'>
        <button type='button' on:click={() => goTo(--currentPage.value)} title='previous page' className='icon navigate_before' /> {currentPage}/
        {totalPages} <button type='button' on:click={() => goTo(++currentPage.value)} title='next page' className='icon navigate_next' />
      </div>
    </div>
  );

  /**
   * Go to a specific page
   * @param {number} page
   * @returns
   */
  async function goTo(page) {
    if (page < 1) {
      page = 1;
      currentPage.value = 1;
    } else if (totalPages.value !== -1 && page > totalPages.value) {
      page = totalPages.value;
      currentPage.value = totalPages.value;
      return;
    }

    let apiUrl = `api/admin/users?page=${page}&limit=${limit}`;

    if (name) {
      apiUrl += `&name=${name}`;
    }
    if (email) {
      apiUrl += `&email=${email}`;
    }

    const res = await fetch(apiUrl);
    const { users, pages } = await res.json();
    totalPages.value = pages;
    ref.innerHTML = '';
    ref.append(
      ...users.map((user) => (
        <tr id={`user-${user.id}`}>
          <td>
            <a href={`/profile/${user.id}`}>{user.id}</a>
          </td>
          <td>{user.name}</td>
          <td>{user.email}</td>
          <td>{moment(user.created_at).format('DD-MM-YY')}</td>
          <td style={{ textAlign: 'center' }}>
            <span data-action='delete' data-user-id={user.id} className='icon delete' />
          </td>
        </tr>
      )),
    );
  }
}

/**
 * Click event handler
 * @param {MouseEvent} e
 */
async function clickHandler(e) {
  const { target } = e;
  const { action } = target.dataset;
  if (action === 'delete') {
    const { userId } = e.target.dataset;
    const confirmation = await confirm('WARNING', 'Are you sure you want to delete this user?');
    if (confirmation) {
      await deleteUser(userId);
      app.get(`#user-${userId}`)?.remove();
    }
  }
}

/**
 * Delete user
 * @param {string} id
 */
async function deleteUser(id) {
  const res = await fetch(`api/admin/user/${id}`, {
    method: 'DELETE',
  });
  const json = await res.json();
  if (json.error) {
    alert('ERROR', json.error);
  } else {
    alert('Success', 'User deleted successfully');
  }
}

function EmailUsers() {
  const recipientCount = Reactive(0);
  const sendBtn = Ref();
  let filter = 'all';
  let subject = '';
  let message = '';

  const fetchCount = async (selectedFilter) => {
    const res = await fetch(`api/admin/email-recipients-count?filter=${selectedFilter}`);
    const json = await res.json();
    recipientCount.value = json.count;
  };

  fetchCount(filter);

  const onFilterChange = (e) => {
    filter = e.target.value;
    fetchCount(filter);
  };

  const onSend = async () => {
    if (!subject.trim() || !message.trim()) {
      alert('ERROR', 'Subject and message are required');
      return;
    }
    const confirmation = await confirm('Confirm', `Send email to ${recipientCount.value} recipient(s)?`);
    if (!confirmation) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    try {
      const res = await fetch('api/admin/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, subject, message }),
      });
      const json = await res.json();
      if (json.error) {
        alert('ERROR', json.error);
      } else {
        alert('Success', `Email sent to ${json.sent} user(s)`);
      }
    } catch {
      alert('ERROR', 'Failed to send emails');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send Email';
    }
  };

  return (
    <div className='email-users'>
      <div className='email-form'>
        <div className='form-group'>
          <label>Recipients</label>
          <select onchange={onFilterChange}>
            <option value='all'>All Users</option>
            <option value='with_plugins'>Users with Plugins</option>
            <option value='with_paid_plugins'>Users with Paid Plugins</option>
            <option value='with_payment'>Users who Received Payment</option>
          </select>
          <small>{recipientCount} recipient(s) will receive this email</small>
        </div>
        <Input
          label='Subject'
          placeholder='Email subject'
          oninput={(e) => {
            subject = e.target.value;
          }}
        />
        <div className='form-group'>
          <label>Message</label>
          <textarea
            placeholder='Email message...'
            oninput={(e) => {
              message = e.target.value;
            }}
          />
        </div>
        <button ref={sendBtn} type='button' onclick={onSend} className='send-btn'>
          Send Email
        </button>
      </div>
    </div>
  );
}

function Payments() {
  const tblBody = Ref();
  const summaryRef = Ref();
  const prevBtn = Ref();
  const nextBtn = Ref();
  const currentPage = Reactive(1);
  const totalPages = Reactive(0);
  const totalCount = Reactive(0);
  const limit = 10;
  let abortController;
  let debounceTimer;
  let searchQuery = '';
  let statusFilter = 'all';

  const paymentMethod = Ref();
  const $paymentDialog = (
    <DialogBox oncancel={(hide) => hide()}>
      <table ref={paymentMethod} className='payment-method' />
    </DialogBox>
  );

  const onSearchInput = (e) => {
    searchQuery = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchPayments(1), 400);
  };

  const onStatusFilter = (e) => {
    statusFilter = e.target.value;
    fetchPayments(1);
  };

  tblBody.onref = () => fetchPayments(1);

  async function fetchPayments(page) {
    if (!tblBody.el) return;

    if (abortController) abortController.abort();
    abortController = new AbortController();

    tblBody.el.innerHTML = '<tr><td colspan="6" class="loading-cell">Loading...</td></tr>';

    let url = `/api/admin/payments?page=${page}&limit=${limit}`;
    if (statusFilter !== 'all') {
      url += `&status=${encodeURIComponent(statusFilter)}`;
    }
    if (searchQuery) {
      url += `&search=${encodeURIComponent(searchQuery)}`;
    }

    try {
      const res = await fetch(url, { signal: abortController.signal });

      if (!res.ok) {
        throw new Error(`Server error (${res.status})`);
      }

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const { payments, pages, total } = data;

      currentPage.value = page;
      totalPages.value = pages;
      totalCount.value = total;
      updatePaginationButtons();

      if (summaryRef.el) {
        const start = total === 0 ? 0 : (page - 1) * limit + 1;
        const end = Math.min(page * limit, total);
        summaryRef.el.textContent = `Showing ${start}–${end} of ${total} payments`;
      }

      if (!total) {
        tblBody.el.innerHTML = '<tr><td colspan="6" class="empty-cell">No payments found</td></tr>';
        return;
      }

      tblBody.el.innerHTML = '';
      tblBody.el.append(
        ...payments.map((p) => (
          <tr data-id={p.id} data-pmid={p.payment_method_id} data-amount={p.amount} className={`payment-row ${p.status}`}>
            <td>{p.id}</td>
            <td>{p.user_name}</td>
            <td>{p.user_email}</td>
            <td className='amount-cell'>&#8377; {p.amount.toLocaleString()}</td>
            <td>
              <span className={`status-badge status-${p.status}`} data-action='update-status' data-id={p.id}>
                {p.status} <span className='chevron' />
              </span>
            </td>
            <td>{moment(p.created_at).format('DD-MM-YY')}</td>
          </tr>
        )),
      );
    } catch (err) {
      if (err?.name === 'AbortError') return;

      currentPage.value = 1;
      totalPages.value = 0;
      totalCount.value = 0;
      updatePaginationButtons();
      if (summaryRef.el) summaryRef.el.textContent = '';
      tblBody.el.innerHTML = '<tr><td colspan="6" class="error-cell"></td></tr>';
      tblBody.el.querySelector('.error-cell').textContent = err.message || 'Failed to load payments';
    }
  }

  function updatePaginationButtons() {
    if (prevBtn.el) prevBtn.el.disabled = currentPage.value <= 1 || totalPages.value < 1;
    if (nextBtn.el) nextBtn.el.disabled = currentPage.value >= totalPages.value || totalPages.value < 1;
  }

  const rowClickHandler = async (e) => {
    const badge = e.target.closest('.status-badge');
    if (badge) {
      e.stopPropagation();
      const { id } = badge.dataset;

      try {
        const statusValue = await select('Select Status', ['none', 'paid', 'initiated']);
        if (!statusValue) return;

        const body = new FormData();
        body.append('id', id);
        body.append('status', statusValue);

        const data = await fetch('/api/admin/payment', {
          method: 'PATCH',
          body,
        }).then((res) => res.json());

        if (data.error) {
          throw new Error(data.error);
        }

        fetchPayments(currentPage.value);
      } catch (err) {
        alert('ERROR', err.message || err);
      }
      return;
    }

    const row = e.target.closest('tr');
    if (row) {
      showPaymentMethod({
        id: row.dataset.id,
        payment_method_id: row.dataset.pmid,
        amount: row.dataset.amount,
      });
    }
  };

  async function showPaymentMethod({ id, payment_method_id: pmId, amount }) {
    try {
      const prev = tblBody.el?.querySelector('.active-row');
      prev?.classList.remove('active-row');
      const row = tblBody.el?.querySelector(`[data-id='${id}']`);
      row?.classList.add('active-row');

      const data = await fetch(`/api/admin/payment-method/${pmId}`).then((res) => res.json());

      if (data.error) throw new Error(data.error);

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
          <tr>
            <th>Amount</th>
            <td>&#8377; {amount}</td>
          </tr>
        </>
      );
      document.body.append($paymentDialog);
    } catch (err) {
      alert('ERROR', err.message || err);
    }
  }

  const goTo = (page) => {
    if (page < 1 || (totalPages.value > 0 && page > totalPages.value)) return;
    if (totalPages.value < 1) return;
    fetchPayments(page);
  };

  return (
    <div className='admin-payments'>
      <div className='payments-toolbar'>
        <div className='search-box'>
          <span className='icon search' />
          <input className='search-input' type='search' placeholder='Search by name or email...' oninput={onSearchInput} />
        </div>
        <select className='status-filter' onchange={onStatusFilter}>
          <option value='all'>All Status</option>
          <option value='paid'>Paid</option>
          <option value='initiated'>Initiated</option>
          <option value='none'>None</option>
        </select>
      </div>
      <div className='table-container'>
        <table className='info payments-table'>
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Email</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody ref={tblBody} onclick={rowClickHandler} />
        </table>
      </div>
      <small ref={summaryRef} className='summary-text'>
        Loading...
      </small>
      <div className='pagination'>
        <button ref={prevBtn} type='button' on:click={() => goTo(currentPage.value - 1)} title='Previous page' className='icon navigate_before' />
        <span>
          {currentPage}/{totalPages}
        </span>
        <button ref={nextBtn} type='button' on:click={() => goTo(currentPage.value + 1)} title='Next page' className='icon navigate_next' />
      </div>
    </div>
  );
}

function Promotions() {
  const listRef = Ref();
  const statusRef = Ref();

  const createFormRow = (promo = {}) => {
    const row = (
      <div className='promo-form-row'>
        <input type='url' placeholder='URL' value={promo.url || ''} className='promo-url' />
        <input type='text' placeholder='Label' value={promo.label || ''} className='promo-label' />
        <input type='text' placeholder='Icon' value={promo.icon || ''} className='promo-icon' />
        <input type='text' placeholder='Link Text' value={promo.link_text || ''} className='promo-link-text' />
        <button
          type='button'
          className='icon delete promo-delete'
          onclick={(e) => {
            e.target.closest('.promo-form-row').remove();
          }}
        />
      </div>
    );
    return row;
  };

  (async () => {
    try {
      const res = await fetch('/api/admin/promotions');
      if (!res.ok) {
        if (statusRef.el) statusRef.el.textContent = 'Failed to load promotions';
        return;
      }
      const json = await res.json();
      if (Array.isArray(json)) {
        for (const promo of json) {
          const row = createFormRow(promo);
          listRef.el.append(row);
        }
      }
    } catch {
      if (statusRef.el) statusRef.el.textContent = 'Failed to load promotions';
    }
  })();

  const onAdd = () => {
    const row = createFormRow();
    listRef.el.append(row);
  };

  const onSave = async () => {
    const rows = listRef.el.querySelectorAll('.promo-form-row');
    const promotions = [];
    for (const row of rows) {
      const url = row.querySelector('.promo-url').value.trim();
      const label = row.querySelector('.promo-label').value.trim();
      const icon = row.querySelector('.promo-icon').value.trim();
      const link_text = row.querySelector('.promo-link-text').value.trim();
      if (!url || !label || !icon || !link_text) {
        alert('ERROR', 'All fields (url, label, icon, link_text) are required for each promotion');
        return;
      }
      promotions.push({ url, label, icon, link_text });
    }
    try {
      const res = await fetch('/api/admin/promotions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promotions }),
      });
      const json = await res.json();
      if (json.error) {
        alert('ERROR', json.error);
      } else {
        statusRef.el.textContent = 'Saved!';
        setTimeout(() => {
          if (statusRef.el) statusRef.el.textContent = '';
        }, 2000);
      }
    } catch {
      alert('ERROR', 'Failed to save promotions');
    }
  };

  return (
    <div className='promotions'>
      <div ref={listRef} className='promo-list' />
      <div className='promo-actions'>
        <button type='button' onclick={onAdd} className='promo-add-btn'>
          + Add Promotion
        </button>
        <button type='button' onclick={onSave} className='promo-save-btn'>
          Save All
        </button>
        <span ref={statusRef} className='status' />
      </div>
    </div>
  );
}
