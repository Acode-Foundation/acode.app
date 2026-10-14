import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { gravatar, invalidateLoggedInUser, withRedirect } from 'lib/helpers';
import logo from 'res/logo.svg';

export default function AppSignIn({ user }) {
  const loginUrl = withRedirect('/login', 'app');
  const search = new URLSearchParams(location.search);
  const error = Reactive(search.get('error') || '');
  const status = Reactive('');
  const continueButton = Ref();
  const switchButton = Ref();
  const avatarUrl = user.avatar_url || (user.github ? gravatar(user.github) : null);
  let busy = false;
  const page = (
    <section id='user-login'>
      <form className='glass user-form app-sign-in' onsubmit={onContinue}>
        <img className='app-sign-in-logo' src={logo} alt='' width='48' height='48' />
        <h1>Continue to Acode</h1>
        <p className='app-sign-in-intro'>Choose the account to use in the app.</p>
        <div className='app-sign-in-account'>
          <span className='account-initial' aria-hidden='true'>
            {(user.name || user.email || 'A').slice(0, 1).toUpperCase()}
            {avatarUrl && <img src={avatarUrl} alt='' width='44' height='44' onerror={(event) => event.target.remove()} />}
          </span>
          <div>
            <strong>{user.name || 'Acode account'}</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <p className='error' role='alert'>
          {error}
        </p>
        <p className='success' role='status'>
          {status}
        </p>
        <button type='submit' ref={continueButton}>
          Continue to Acode
        </button>
        <button type='button' className='switch-account' ref={switchButton} onclick={() => runAction('switch')}>
          Use a different account
        </button>
        <p className='app-sign-in-note'>Switching accounts signs you out of this website.</p>
      </form>
    </section>
  );
  return page;

  function onContinue(event) {
    event.preventDefault();
    return runAction('continue');
  }

  async function runAction(action) {
    if (busy) return;
    busy = true;
    continueButton.el.disabled = true;
    switchButton.el.disabled = true;
    continueButton.el.textContent = action === 'continue' ? 'Opening Acode…' : 'Continue to Acode';
    switchButton.el.textContent = action === 'switch' ? 'Signing out…' : 'Use a different account';
    page.setAttribute('aria-busy', 'true');
    error.value = '';
    status.value = '';
    try {
      if (action === 'switch') {
        await request('/api/login', { method: 'DELETE' });
        invalidateLoggedInUser();
        if (page.isConnected) window.location.replace(loginUrl);
        return;
      }

      // The website session may have changed in another tab since this account was shown.
      const currentUser = await request('/api/login', { cache: 'no-store' });
      if (!page.isConnected) return;
      if (currentUser.id !== user.id) {
        invalidateLoggedInUser();
        window.location.replace(loginUrl);
        return;
      }
      const callback = await getAppRedirectUrl(search);
      if (!page.isConnected) return;
      status.value = 'Opening Acode. If it doesn’t open, tap Continue again.';
      window.location.replace(callback);
    } catch (failure) {
      if (!page.isConnected) return;
      if (failure.status === 401 || (action === 'switch' && failure.status === 400)) {
        invalidateLoggedInUser();
        window.location.replace(loginUrl);
        return;
      }
      error.value = failure.message;
    } finally {
      busy = false;
      continueButton.el.disabled = false;
      switchButton.el.disabled = false;
      continueButton.el.textContent = 'Continue to Acode';
      switchButton.el.textContent = 'Use a different account';
      page.setAttribute('aria-busy', 'false');
    }
  }
}

async function getAppRedirectUrl(search) {
  if (search.get('authFlow') === 'app-code') {
    const androidPackage = search.get('androidPackage');
    if (androidPackage && !['com.foxdebug.acode', 'com.foxdebug.acodefree'].includes(androidPackage)) {
      throw new Error('This sign-in request targets an unsupported app. Please start sign-in again from Acode.');
    }
    const state = search.get('state');
    const challenge = search.get('challenge');
    if (!state || !challenge) throw new Error('This sign-in request is incomplete. Please start sign-in again from Acode.');
    const data = await request('/api/user/app-auth-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, challenge, appVersionCode: search.get('appVersionCode') }),
    });
    if (!data.code) throw new Error('Unable to open Acode. Please try again.');
    const callback = new URL('acode://auth/callback');
    callback.searchParams.set('code', data.code);
    callback.searchParams.set('state', state);
    if (androidPackage) {
      return `intent://auth/callback?${callback.searchParams}#Intent;scheme=acode;package=${androidPackage};end`;
    }
    return callback.toString();
  }
  const data = await request('/api/user/app-token', { method: 'POST' });
  if (!data.token) throw new Error('Unable to open Acode. Please try again.');
  return `acode://user/login/${encodeURIComponent(data.token)}`;
}

async function request(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      const minutes = Math.ceil(retryAfter / 60);
      const message =
        response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
          ? `Too many sign-in attempts. Please wait ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} and try again.`
          : data.error || 'Unable to complete the request. Please try again.';
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The request took too long. Please try again.');
    if (error instanceof TypeError) throw new Error('Could not connect. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
