import './style.scss';
import Input from 'components/input';
import Plugins from 'components/plugins';
import Ref from 'html-tag-js/ref';
import Router from 'lib/Router';
import { getLoggedInUser } from 'lib/helpers';

export default async function PluginList({ filter }) {
  const loggedInUser = await getLoggedInUser();
  const title = Ref();
  const plugins = Ref();
  let changeTimeout;

  plugins.onref = renderPlugins.bind(null, filter);
  return (
    <section style={{ padding: '20px 0' }} id='plugins'>
      <div className='header'>
        <h1 ref={title}>Plugins</h1>
        {loggedInUser?.isAdmin ? (
          <nav>
            <span className='link' onclick={updatePlugins} data-filter='all'>
              All
            </span>
            <span className='link' onclick={updatePlugins} data-filter='approved'>
              Approved
            </span>
            <span className='link' onclick={updatePlugins} data-filter='pending'>
              Pending
            </span>
            <span className='link' onclick={updatePlugins} data-filter='rejected'>
              Rejected
            </span>
            <span className='link' onclick={updatePlugins} data-filter='deleted'>
              Deleted
            </span>
          </nav>
        ) : (
          ''
        )}
        <nav>
          <span className='link' onclick={updatePlugins} data-filter='newest'>
            New
          </span>
          <span className='link' onclick={updatePlugins} data-filter='downloads'>
            Most Downloaded
          </span>
        </nav>
        <nav>
          <Input
            oninput={(e) => {
              clearTimeout(changeTimeout);
              changeTimeout = setTimeout(() => {
                plugins.el.content = <Plugins name={e.target.value} />;
              }, 500);
            }}
            type='search'
            name='search'
            placeholder='e.g. lint'
            label='Search'
          />
        </nav>
      </div>
      <div ref={plugins} className='plugins-container' />
    </section>
  );

  function updatePlugins(e) {
    filter = e.target.dataset.filter;
    Router.setUrl(`/plugins?filter=${filter}`);
    renderPlugins();
  }

  function renderPlugins() {
    let titleText = 'Plugins';
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
