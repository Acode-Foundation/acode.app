import 'html-tag-js/dist/polyfill';
import 'core-js';

import './main.scss';
import './common.scss';
import 'res/icons/style.css';

import Router from 'lib/Router';
import Theme from 'lib/theme';
import dark from 'themes/dark';
import PullToRefresh from 'lib/pullToRefresh';
import $loginText from 'components/loginText';
import { getLoggedInUser, hideLoading, showLoading } from 'lib/helpers';
import View from './main.view';

window.onload = async () => {
  Theme(dark);
  PullToRefresh(app, () => {
    Router.reload();
  });
  app.content = <View appName="Acode" routes={[
    { href: '/faqs', text: 'FAQs' },
    { href: '/plugin-docs', text: 'Plugin Docs' },
    { href: '/plugins', text: 'Plugins' },
    { href: '/user', text: $loginText },
    { href: 'https://foxdebug.com', text: 'Foxdebug' },
    { href: '/policy', text: 'Privacy policy' },
    { href: '/terms', text: 'Terms of service' },
  ]} />;

  const user = await getLoggedInUser();
  if (user) {
    $loginText.value = user.name;
  }

  const main = app.get('main');

  Router.add('/payments', (params) => loadModule('payments', params));
  Router.add('/admin', (params) => loadModule('admin', params));
  Router.add('/add-payment-method/:mode', (params) => loadModule('addPaymentMethod', params));
  Router.add('/plugin-docs/:doc?', ({ doc }, { title }) => loadModule('pluginDocs', { doc, title }));
  Router.add('/faqs/:qHash?', (params) => loadModule('FAQs', params));
  Router.add('/policy', () => loadModule('privacyPolicy'));
  Router.add('/terms', () => loadModule('termsOfService'));
  Router.add('/login', (params, query) => loadModule('loginUser', query));
  Router.add('/plugins', (params, query) => loadModule('plugins', query));
  Router.add('/logout', logout);
  Router.add('/register', () => loadModule('registerUser'));
  Router.add('/change-password', (params, query) => loadModule('changePassword', query));
  Router.add('/edit-user', () => loadModule('registerUser', { mode: 'edit' }));
  Router.add('/publish', (params, query) => loadModule('publishPlugin', query));
  Router.add('/plugin/:id/:section?', (params) => loadModule('plugin', params));
  Router.add('/user/:userEmail?', (params) => loadModule('user', params));
  Router.add('/earnings', (params, query) => loadModule('earnings', query));
  Router.add('/:filename(index.html?)?', () => loadModule('home'));

  Router.add('*', () => {
    main.innerHTML = `Cannot get ${window.location.pathname}`;
  });

  Router.listen();

  Router.onnavigate = () => {
    const navToggler = tag.get('#menu-toggler');
    if (navToggler.checked) {
      navToggler.checked = false;
    }
    main.content = '';
    app.scrollTop = 0;
  };

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