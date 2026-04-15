import './style.scss';
import Input from 'components/input';
import Plugins from 'components/plugins';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser } from 'lib/helpers';
import Router from 'lib/Router';

export default async function PluginList({ filter, orderBy }) {
  const loggedInUser = await getLoggedInUser();
  const title = Ref();
  const plugins = Ref();
  let changeTimeout;
  let currentFilter = filter || '';
  let currentOrderBy = orderBy || '';

  plugins.onref = () => renderPlugins();

  return (
    <section style={{ padding: '20px 0' }} id='plugins'>
      <div className='header'>
        <h1 style={{ textAlign: 'center' }} ref={title}>
          Plugins
        </h1>

        <div className='controls-wrapper'>
          <div className='control-group'>
            <select className='filter-select' onchange={handleFilterChange}>
              <option value='' selected={currentFilter === ''}>
                Filter By
              </option>
              {loggedInUser?.isAdmin && (
                <optgroup label='Status'>
                  <option value='approved' selected={currentFilter === 'approved'}>
                    Approved
                  </option>
                  <option value='pending' selected={currentFilter === 'pending'}>
                    Pending
                  </option>
                  <option value='rejected' selected={currentFilter === 'rejected'}>
                    Rejected
                  </option>
                  <option value='deleted' selected={currentFilter === 'deleted'}>
                    Deleted
                  </option>
                </optgroup>
              )}
              <optgroup label='Editor Type'>
                <option value='cm' selected={currentFilter === 'cm'}>
                  CodeMirror
                </option>
                <option value='ace' selected={currentFilter === 'ace'}>
                  Ace
                </option>
              </optgroup>
            </select>
          </div>

          <div className='control-group'>
            <select className='sort-select' onchange={handleSortChange}>
              <option value='' selected={currentOrderBy === ''}>
                Sort By
              </option>
              <option value='downloads' selected={currentOrderBy === 'downloads'}>
                Most Downloaded
              </option>
              <option value='newest' selected={currentOrderBy === 'newest'}>
                Newest First
              </option>
            </select>
          </div>

          <div className='control-group search-group'>
            <Input
              oninput={(e) => {
                clearTimeout(changeTimeout);
                changeTimeout = setTimeout(() => {
                  let status;
                  let editor;

                  if (['cm', 'ace'].includes(currentFilter)) {
                    editor = currentFilter;
                  } else if (['approved', 'pending', 'rejected', 'deleted'].includes(currentFilter)) {
                    status = currentFilter;
                  }

                  plugins.el.content = <Plugins name={e.target.value} status={status} editor={editor} orderBy={currentOrderBy} />;
                }, 500);
              }}
              type='search'
              name='search'
              placeholder='e.g. lint, git, markdown...'
              label='Search'
            />
          </div>
        </div>
      </div>
      <div ref={plugins} className='plugins-container' />
    </section>
  );

  function handleFilterChange(e) {
    currentFilter = e.target.value;
    updateUrl();
    renderPlugins();
  }

  function handleSortChange(e) {
    currentOrderBy = e.target.value;
    updateUrl();
    renderPlugins();
  }

  function updateUrl() {
    const params = new URLSearchParams();
    if (currentFilter && currentFilter !== 'all') {
      params.set('filter', currentFilter);
    }
    if (currentOrderBy && currentOrderBy !== 'popular') {
      params.set('orderBy', currentOrderBy);
    }
    const query = params.toString();
    Router.setUrl(`/plugins${query ? `?${query}` : ''}`);
  }

  function renderPlugins() {
    let titleText = 'Plugins';
    let statusFilter;
    let editorFilter;
    let sortOrder;

    // Handle status filters (admin)
    if (currentFilter === 'approved') {
      titleText = 'Approved Plugins';
      statusFilter = 1;
    } else if (currentFilter === 'pending') {
      titleText = 'Pending Plugins';
      statusFilter = 0;
    } else if (currentFilter === 'rejected') {
      titleText = 'Rejected Plugins';
      statusFilter = 2;
    } else if (currentFilter === 'deleted') {
      titleText = 'Deleted Plugins';
      statusFilter = 3;
    }
    // Handle editor filters
    else if (currentFilter === 'cm') {
      titleText = 'CodeMirror Plugins';
      editorFilter = 'cm';
    } else if (currentFilter === 'ace') {
      titleText = 'Ace Editor Plugins';
      editorFilter = 'ace';
    } else if (currentFilter === 'both') {
      titleText = 'Universal Plugins';
      editorFilter = 'all';
    }

    // Handle sorting
    if (currentOrderBy === 'downloads') {
      sortOrder = 'downloads';
      titleText += ' - Most Downloaded';
    } else if (currentOrderBy === 'newest') {
      sortOrder = 'newest';
      titleText += ' - Newest';
    }

    title.textContent = titleText;
    plugins.el.content = <Plugins orderBy={sortOrder} status={statusFilter} editor={editorFilter} />;
  }
}
