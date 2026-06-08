import './style.scss';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import Input from 'components/input';
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

  const activeTab = Reactive('dashboard');

  const switchTab = (tab) => {
    activeTab.value = tab;
    const nav = document.querySelector('#admin .admin-tabs');
    const content = document.querySelector('#admin .tab-content');
    if (nav) {
      for (const btn of nav.querySelectorAll('.tab-btn')) {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      }
    }
    if (content) {
      for (const panel of content.querySelectorAll('.tab-panel')) {
        panel.classList.toggle('active', panel.dataset.tab === tab);
      }
    }
  };

  return (
    <section ref={usersList} id='admin'>
      <h1>Admin Panel</h1>
      <nav
        className='admin-tabs'
        on:click={(e) => {
          const tab = e.target.dataset.tab;
          if (tab) switchTab(tab);
        }}
      >
        <button type='button' data-tab='dashboard' className='tab-btn active'>
          Dashboard
        </button>
        <button type='button' data-tab='settings' className='tab-btn'>
          Settings
        </button>
        <button type='button' data-tab='users' className='tab-btn'>
          Users
        </button>
        <button type='button' data-tab='email' className='tab-btn'>
          Email
        </button>
        <button type='button' data-tab='promotions' className='tab-btn'>
          Promotions
        </button>
        <button type='button' data-tab='sponsors' className='tab-btn'>
          Sponsors
        </button>
      </nav>
      <div className='tab-content'>
        <div data-tab='dashboard' className='tab-panel active'>
          <Dashboard />
        </div>
        <div data-tab='settings' className='tab-panel'>
          <AppSettings />
        </div>
        <div data-tab='users' className='tab-panel'>
          <Users />
        </div>
        <div data-tab='email' className='tab-panel'>
          <EmailUsers />
        </div>
        <div data-tab='promotions' className='tab-panel'>
          <Promotions />
        </div>
        <div data-tab='sponsors' className='tab-panel'>
          <Sponsors />
        </div>
      </div>
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

    const res = await fetch(`api/admin/sponsors?page=${page}&limit=${limit}`);
    const { sponsors, pages } = await res.json();
    if (!res.ok || !Array.isArray(sponsors)) {
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
  const statusRef = Ref();

  (async () => {
    try {
      const res = await fetch('/api/admin/config');
      const config = await res.json();
      if (priceRef.el) {
        priceRef.el.value = config.acode_pro_price;
      }
    } catch {
      if (statusRef.el) {
        statusRef.el.textContent = 'Failed to load config';
      }
    }
  })();

  const onSave = async () => {
    const price = priceRef.el.value;
    const numPrice = Number(price);
    if (Number.isNaN(numPrice) || numPrice <= 0) {
      alert('ERROR', 'Price must be a positive number');
      return;
    }

    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'acode_pro_price', value: price }),
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
      alert('ERROR', 'Failed to save config');
    }
  };

  return (
    <div className='app-settings'>
      <div className='setting-row'>
        <label>Acode Pro Price (INR)</label>
        <div className='setting-input'>
          <input ref={priceRef} type='number' min='1' step='1' placeholder='370' />
          <button type='button' onclick={onSave}>
            Save
          </button>
          <span ref={statusRef} className='status' />
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
