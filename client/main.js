import 'html-tag-js/dist/polyfill';
import 'core-js';

import './main.scss';
import './common.scss';
import 'res/icons/style.css';

import { setupHeaderTitle } from 'lib/headerTitle';
import { getLoggedInUser, hideLoading, invalidateLoggedInUser, showLoading } from 'lib/helpers';
import { applyRouteMetadata } from 'lib/pageMetadata';
import Router from 'lib/Router';
import Theme from 'lib/theme';
import dark from 'themes/dark';
import View, { addProButton, updateAccountButton } from './main.view';

document.addEventListener('DOMContentLoaded', () => {
  showLoading();
  Theme(dark);
  let initialDetail = app.querySelector('.public-detail');
  app.content = (
    <View
      appName='Acode'
      routes={[
        { href: '/faqs', text: 'FAQs' },
        { href: 'https://docs.acode.app', text: 'Docs' },
        { href: '/plugins', text: 'Plugins' },
        { href: '/sponsors', text: 'Sponsors' },
        { href: 'https://academy.acode.app', text: 'Learn' },
      ]}
    />
  );

  setupHeaderTitle(app.get('#main-header'));

  app.addEventListener('scroll', (e) => {
    const depth = Math.min(e.target.scrollTop / 80, 1);
    app.get('#main-header').style.cssText = `
      background-color: rgba(12, 13, 17, ${depth * 0.78});
      backdrop-filter: blur(${depth * 16}px);
      border-bottom-color: rgba(255, 255, 255, ${depth * 0.08});
    `;
    if (e.target.scrollTop > 0) {
      app.classList.add('scrolled');
    } else {
      app.classList.remove('scrolled');
    }
  });
  // Render routes as soon as the DOM is ready. Ads, images, and account lookup
  // must not delay public content until the window load event.
  getLoggedInUser()
    .then((user) => {
      updateAccountButton(user);
      addProButton(user);
    })
    .catch((error) => {
      console.error('Failed to load account controls:', error);
      updateAccountButton();
      addProButton();
    });

  const main = app.get('main');
  if (initialDetail) main.append(initialDetail);
  else main.content = pagePlaceholder(window.location.pathname);

  Router.add('/admin', (_params, queries) => loadModule('admin', { queries }));
  Router.add('/add-payment-method/:mode', (params) => loadModule('addPaymentMethod', params));
  Router.add('/faqs/:qHash?', (params) => loadModule('FAQs', params));
  Router.add('/docs/run-python', () => window.location.replace('https://docs.acode.app/tutorials/python-language-server'));
  Router.add('/policy', () => loadModule('privacyPolicy'));
  Router.add('/terms', () => loadModule('termsOfService'));
  Router.add('/refund', () => loadModule('refundPolicy'));
  Router.add('/contact', () => loadModule('contactUs'));
  Router.add('/about', () => loadModule('aboutUs'));

  if (process.env.RAZORPAY_ENABLED) {
    Router.add('/pro', (_params, query) => loadModule('pro', query));
    Router.add('/sponsors', (_params, query) => loadModule('sponsors', query));
    Router.add('/become-sponsor', (_params, query) => loadModule('becomeSponsor', query));
  }

  Router.add('/login', (_params, query) => loadModule('login', query));
  Router.add('/plugins', (_params, query) => loadModule('plugins', query));
  Router.add('/logout', logout);
  Router.add('/register', (_params, query) => loadModule('account', query));
  Router.add('/change-password', (_params, query) => loadModule('changePassword', query));
  Router.add('/api-keys', () => loadModule('apiKeys'));
  Router.add('/publish', (_params, query) => loadModule('publishPlugin', query));
  Router.add('/plugin/:id/:section?', (params, queries) => loadModule('plugin', { ...params, ...queries }));
  Router.add('/user/:userId?', () => Router.loadUrl(window.location.pathname.replace('/user', '/profile') + window.location.search));
  Router.add('/profile/edit', () => loadModule('account', { mode: 'edit' }));
  Router.add('/profile/:userId?', (params) => loadModule('user', params));
  Router.add('/earnings', (_params, query) => loadModule('earnings', query));
  Router.add('/update-plugin-editor/:id', (params) => loadModule('updatePluginEditor', params));
  Router.add('/orders', () => loadModule('orders'));

  // Server will redirect to respected provider
  Router.add('/oauth/*', () => window.location.reload());

  Router.add('/:filename(index.html?)?', () => loadModule('home'));

  Router.add('*', () => {
    hideLoading();
    main.content = <div className='error'>Cannot get '{window.location.pathname}'</div>;
  });

  if (!initialDetail) applyRouteMetadata(window.location.pathname);
  Router.listen();
  Router.on('navigate', () => applyRouteMetadata(window.location.pathname));

  Router.on('navigate', (path) => {
    const navMenuToggler = tag.get('#nav-menu-toggler');
    const userMenuToggler = tag.get('#user-menu-toggler');
    if (navMenuToggler.checked) {
      navMenuToggler.checked = false;
    }
    if (userMenuToggler.checked) {
      userMenuToggler.checked = false;
    }
    main.content = pagePlaceholder(path);
    app.scrollTop = 0;
  });

  function pagePlaceholder(path) {
    return path.startsWith('/plugin/') ? document.getElementById('plugin-skeleton')?.content?.firstElementChild?.cloneNode(true) || '' : '';
  }

  async function loadModule(module, props = {}) {
    const detail = initialDetail;
    initialDetail = null;
    const path = window.location.pathname;
    showLoading();
    try {
      const { default: Module } = await import(`./pages/${module}`);
      if (window.location.pathname !== path) return;
      hideLoading();
      const page = await (<Module {...props} initialDetail={detail} />);
      if (window.location.pathname === path && page !== detail) main.content = page;
    } catch (error) {
      if (window.location.pathname !== path) return;
      hideLoading();
      if (!detail?.isConnected) {
        main.content =
          module === 'plugin' ? (
            <div className='error'>
              Unable to load plugin. <a href='/plugins'>All plugins</a>
            </div>
          ) : (
            <div className='error'>Unable to load this page. Please reload to try again.</div>
          );
      }
      console.error('Could not load the interactive page', error);
    } finally {
      detail?.querySelector('.plugin-preview-body')?.removeAttribute('hidden');
    }
  }

  async function logout() {
    const path = window.location.pathname;
    showLoading();
    try {
      const res = await fetch('/api/login', { method: 'DELETE' });
      if (!res.ok) throw new Error(`Logout failed (HTTP ${res.status})`);
    } catch (error) {
      if (window.location.pathname === path) {
        hideLoading();
        main.content = <div className='error'>Couldn’t log out. Reload to try again.</div>;
      }
      console.error('Could not log out', error);
      return;
    }

    sessionStorage.clear();
    invalidateLoggedInUser();
    updateAccountButton();
    addProButton();
    if (window.location.pathname !== path) return;
    hideLoading();
    if (window.history.length > 1) {
      window.history.go(-1);
    } else {
      window.location = '/';
    }
  }
});
