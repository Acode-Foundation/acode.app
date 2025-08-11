import confirm from 'components/dialogs/confirm';
import './sponsors.scss';
import alert from 'components/dialogs/alert';
import { getLoggedInUser } from 'lib/helpers';

export default async function Sponsors() {
  try {
    const loggedInUser = await getLoggedInUser();

    if (loggedInUser.role !== 'admin') {
      return <p>You do not have permission to view this page.</p>;
    }
  } catch (error) {
    console.error('Error fetching logged in user:', error);
    return <p>Error fetching logged in user</p>;
  }

  const sponsors = await fetch('/api/sponsors').then((res) => res.json());
  return (
    <section id='sponsors'>
      <h1>Sponsors</h1>
      <ul>
        {sponsors.map((sponsor) => (
          <li className='sponsor-item'>
            <div>
              <div className='info'>
                <strong>{sponsor.name}</strong>
                <span>{sponsor.tier}</span>
              </div>
              <button
                type='button'
                className='icon delete'
                onclick={async (e) => {
                  const confirmation = await confirm('Warning', `Are you sure you want to delete ${sponsor.name}?`);
                  if (confirmation) {
                    try {
                      await fetch(`/api/sponsors/${sponsor.id}`, { method: 'DELETE' });
                      e.target.closest('li.sponsor-item').remove();
                    } catch (error) {
                      console.error('Error deleting sponsor:', error);
                      alert('Error', 'Failed to delete sponsor');
                    }
                  }
                }}
              ></button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
