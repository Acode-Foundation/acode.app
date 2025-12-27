import './style.scss';
import Input from 'components/input';
import Plugins from 'components/plugins';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser } from 'lib/helpers';
import Router from 'lib/Router';

export default async function PluginList({ filter }) {
  const loggedInUser = await getLoggedInUser();
  const title = Ref();
  const plugins = Ref();
  let changeTimeout;

  plugins.onref = renderPlugins.bind(null, filter);
  return (
    <section id='plugins'>
      <div className='plugins-header'>
        <div className='header-content'>
          <h1 ref={title}>Explore Plugins</h1>
          <p className='header-subtitle'>Discover powerful plugins to enhance your Acode experience</p>
        </div>

        <div className='search-container'>
          <div className='search-wrapper'>
            <span className='icon search-icon'>&#xe9a7;</span>
            <Input
              oninput={(e) => {
                clearTimeout(changeTimeout);
                changeTimeout = setTimeout(() => {
                  plugins.el.content = <Plugins name={e.target.value} />;
                }, 500);
              }}
              type='search'
              name='search'
              placeholder='Search plugins...'
              label=''
            />
          </div>
        </div>

        <div className='filter-tabs'>
          {loggedInUser?.isAdmin && (
            <div className='admin-filters'>
              <button type='button' className='filter-chip' onclick={updatePlugins} data-filter='all'>
                All
              </button>
              <button type='button' className='filter-chip' onclick={updatePlugins} data-filter='approved'>
                Approved
              </button>
              <button type='button' className='filter-chip' onclick={updatePlugins} data-filter='pending'>
                Pending
              </button>
              <button type='button' className='filter-chip' onclick={updatePlugins} data-filter='rejected'>
                Rejected
              </button>
              <button type='button' className='filter-chip' onclick={updatePlugins} data-filter='deleted'>
                Deleted
              </button>
            </div>
          )}
          <div className='sort-filters'>
            <button type='button' className='filter-chip active' onclick={updatePlugins} data-filter='newest'>
              <span className='icon access_time' />
              Newest
            </button>
            <button type='button' className='filter-chip' onclick={updatePlugins} data-filter='downloads'>
              <span className='icon download' />
              Most Downloaded
            </button>
          </div>
        </div>
      </div>

      <div ref={plugins} className='plugins-container' />
    </section>
  );

  function updatePlugins(e) {
    // Remove active class from all chips and add to clicked one
    const allChips = document.querySelectorAll('.sort-filters .filter-chip');
    for (const chip of allChips) {
      chip.classList.remove('active');
    }
    e.target.closest('.filter-chip')?.classList.add('active');

    filter = e.target.closest('.filter-chip')?.dataset.filter || e.target.dataset.filter;
    Router.setUrl(`/plugins?filter=${filter}`);
    renderPlugins();
  }

  function renderPlugins() {
    let titleText = 'Explore Plugins';
    let orderBy;
    if (filter === 'approved') {
      titleText = 'Approved Plugins';
      filter = 1;
    } else if (filter === 'pending') {
      titleText = 'Pending Plugins';
      filter = 0;
    } else if (filter === 'rejected') {
      titleText = 'Rejected Plugins';
      filter = 2;
    } else if (filter === 'downloads') {
      titleText = 'Most Downloaded Plugins';
      filter = undefined;
      orderBy = 'downloads';
    } else if (filter === 'newest') {
      titleText = 'Newest Plugins';
      filter = undefined;
      orderBy = 'newest';
    } else if (filter === 'deleted') {
      titleText = 'Deleted Plugins';
      filter = 3;
    } else {
      filter = undefined;
    }

    title.textContent = titleText;
    plugins.el.content = <Plugins orderBy={orderBy} status={filter} />;
  }
}
