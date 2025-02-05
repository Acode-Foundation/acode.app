import './style.scss';
import Ref from 'html-tag-js/ref';
import Input from 'components/input';
import alert from 'components/dialogs/alert';
import { getLoggedInUser } from 'lib/helpers';
import moment from 'moment';
import confirm from 'components/dialogs/confirm';

export default function Admin() {
  const usersList = new Ref();
  (async () => {
    const loggedInUser = await getLoggedInUser();
    if (!loggedInUser.isAdmin) {
      alert('ERROR', 'You are not authorized to view this page');
    }
  })();

  return (
    <section ref={usersList} id="admin">
      <h1>Admin Panel</h1>
      <Dashboard />
      <Users />
    </section>
  );
}

function Dashboard() {
  const ref = new Ref();
  (async () => {
    const res = await fetch('api/admin/');
    const {
      users,
      amountPaid,
      pluginSales,
      pluginDownloads,
    } = await res.json();
    ref.append(
      ...(
        <>
          <Card title="Users" text={users} />
          <Card title="Amount Paid" text={amountPaid} />
          <Card title="Plugin Sales" text={pluginSales} />
          <Card title="Plugin Downloads" text={pluginDownloads} />
          <Card title="Download Report" icon='download' onclick={() => {
            const date = new Date();
            const year = date.getFullYear();
            const month = date.getMonth();
            window.open(`api/admin/reports/${year}/${month}`);
          }} />
        </>
      ),
    );
  })();
  return <div ref={ref} className="dashboard"></div>;
}

/**
 * Card component to display title and content
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.text]
 * @param {string} [props.icon]
 * @param {()=>{}} [props.onclick]
 */
function Card({
  title,
  text,
  icon,
  onclick,
}) {
  return (
    <div className="card" onclick={onclick}>
      {
        icon
          ? <span className={`content icon ${icon}`}></span>
          : <span className="content">{text.toLocaleString()}</span>
      }
      <span className="title">{title}</span>
    </div>
  );
}

function Users() {
  const currentPage = <>1</>;
  const totalPages = <>-1</>;
  const limit = 10;
  const ref = new Ref();
  let debounceTimer;
  let name = '';
  let email = '';

  const goTo = async (page) => {
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
            <a href={`/user/${user.email}`}>{user.id}</a>
          </td>
          <td>{user.name}</td>
          <td>{user.email}</td>
          <td>{moment(user.created_at).format('DD-MM-YY')}</td>
          <td style={{ textAlign: 'center' }}><span data-action="delete" data-user-id={user.id} className='icon delete'></span></td>
        </tr>
      )),
    );
  };

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

  ref.onref = () => goTo(1);

  return (
    <div className="users">
      <div className="table-container">
        <table className="info">
          <thead>
            <tr>
              <th>ID</th>
              <th>
                <Input
                  oninput={oninput}
                  name="name"
                  type="search"
                  label="Name"
                  placeholder="Search by name"
                />
              </th>
              <th>
                <Input
                  oninput={oninput}
                  name="email"
                  type="search"
                  label="Email"
                  placeholder="Search by email"
                />
              </th>
              <th>Joined</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody on:click={clickHandler} ref={ref}></tbody>
        </table>
      </div>
      <div className="pagination">
        <button
          on:click={() => goTo(--currentPage.value)}
          title="previous page"
          className="icon navigate_before"
        ></button>{' '}
        {currentPage}/{totalPages}{' '}
        <button
          on:click={() => goTo(++currentPage.value)}
          title="next page"
          className="icon navigate_next"
        ></button>
      </div>
    </div>
  );
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
