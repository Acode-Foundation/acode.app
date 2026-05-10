import 'html-tag-js/dist/polyfill';
import 'core-js';

import './main.scss';
import './common.scss';
import 'res/icons/style.css';

import $loginText from 'components/loginText';
import { getLoggedInUser, hideLoading, showLoading } from 'lib/helpers';
import Router from 'lib/Router';
import Theme from 'lib/theme';
import dark from 'themes/dark';
import View from './main.view';

window.onload = async () => {
  Theme(dark);
  app.content = (
    <View
      appName='Acode'
      routes={[
        { href: '/faqs', text: 'FAQs' },
        { href: 'https://docs.acode.app', text: 'Plugin Docs' },
        { href: '/plugins', text: 'Plugins' },
      ]}
    />
  );

  app.addEventListener('scroll', (e) => {
    app.get('#main-header').style.cssText = `
      background-color: rgba(0, 0, 0, ${Math.min(e.target.scrollTop / 100, 0.5)});
      backdrop-filter: blur(${Math.min(e.target.scrollTop / 10, 10)}px);
      box-shadow: 0 2px 5px rgba(0, 0, 0, ${Math.min(e.target.scrollTop / 100, 0.2)});
      transition: background-color 0.3s ease, backdrop-filter 0.3s ease, box-shadow 0.3s ease;
    `;
    if (e.target.scrollTop > 0) {
      app.classList.add('scrolled');
    } else {
      app.classList.remove('scrolled');
    }
  });

  const user = await getLoggedInUser();
  if (user) {
    $loginText.value = user.name;
  }

  // Show "Get Pro" button if user is not pro
  if (!user?.acode_pro) {
    const header = app.get('#main-header');
    const navUser = header.get('nav:last-of-type');
    if (navUser) {
      const loginLink = navUser.get('a');
      navUser.insertBefore(
        <a href='/pro' className='get-pro-btn'>
          <span className='icon favorite' /> Get Pro
        </a>,
        loginLink,
      );
    }
  }

  const main = app.get('main');

  Router.add('/payments', (params) => loadModule('payments', params));
  Router.add('/admin', (params) => loadModule('admin', params));
  Router.add('/admin/sponsors', (params) => loadModule('admin/sponsors', params));
  Router.add('/add-payment-method/:mode', (params) => loadModule('addPaymentMethod', params));
  Router.add('/faqs/:qHash?', (params) => loadModule('FAQs', params));
  Router.add('/policy', () => loadModule('privacyPolicy'));
  Router.add('/terms', () => loadModule('termsOfService'));
  Router.add('/refund', () => loadModule('refundPolicy'));
  Router.add('/contact', () => loadModule('contactUs'));
  Router.add('/pro', () => loadModule('pro'));
  Router.add('/login', (_params, query) => loadModule('loginUser', query));
  Router.add('/plugins', (_params, query) => loadModule('plugins', query));
  Router.add('/logout', logout);
  Router.add('/register', (_params, query) => loadModule('registerUser', query));
  Router.add('/change-password', (_params, query) => loadModule('changePassword', query));
  Router.add('/edit-user', () => loadModule('registerUser', { mode: 'edit' }));
  Router.add('/publish', (_params, query) => loadModule('publishPlugin', query));
  Router.add('/plugin/:id/:section?', (params, queries) => loadModule('plugin', { ...params, ...queries }));
  Router.add('/user/:userId?', (params) => loadModule('user', params));
  Router.add('/earnings', (_params, query) => loadModule('earnings', query));
  Router.add('/update-plugin-editor/:id', (params) => loadModule('updatePluginEditor', params));
  Router.add('/:filename(index.html?)?', () => loadModule('home'));

  Router.add('*', () => {
    main.innerHTML = `Cannot get ${window.location.pathname}`;
  });

  Router.listen();

  Router.on('navigate', () => {
    const navToggler = tag.get('#menu-toggler');
    if (navToggler.checked) {
      navToggler.checked = false;
    }
    main.content = '';
    app.scrollTop = 0;
  });

  async function loadModule(module, props = {}) {
    showLoading();
    const { default: Module } = await import(`./pages/${module}`);
    hideLoading();

    main.content = await (<Module {...props} />);
  }

  async function logout() {
    const res = await fetch('/api/login', {
      method: 'DELETE',
    });

    if (res.status === 200) {
      window.location.replace('/');
    }
  }
};
