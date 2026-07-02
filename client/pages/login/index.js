import './style.scss';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import Input from 'components/input';
import OAuthButton from 'components/oauthButton';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import background from 'lib/background';
import { getLoggedInUser, loadingEnd, loadingStart, withRedirect } from 'lib/helpers';
import Router from 'lib/Router';

export default async function Login({ redirect = sessionStorage.getItem('redirect') }) {
  const errorText = Reactive('');
  const successText = Reactive('');
  const button = Ref();
  const canvas = Ref();
  const search = new URLSearchParams(window.location.search);
  const appLoginState = search.get('state');
  const appAuthChallenge = search.get('challenge');
  const appAuthFlow = search.get('authFlow');
  const appVersionCode = search.get('appVersionCode');
  const usesAppCodeFlow = redirect === 'app' && appAuthFlow === 'app-code';
  const oauthRedirect = usesAppCodeFlow ? `${location.pathname}${location.search}` : redirect;

  try {
    const user = await getLoggedInUser();
    if (user) {
      redirectAfterDone();
      return (
        <section id='user-login'>
          <div className='redirect-message'>
            <div className='error'>{errorText}</div>
            <div className='success'>{successText}</div>
          </div>
        </section>
      );
    }
  } catch (error) {
    return <div>{error.message}</div>;
  }

  const linkError = search.get('error');
  if (linkError) {
    alert('Error', linkError, () => {
      search.delete('error');
      const newSearch = search.toString();
      Router.loadUrl(`${location.pathname}${newSearch ? `?${newSearch}` : ''}`);
    });
  }

  canvas.onref = () => background(canvas.el);

  return (
    <section id='user-login'>
      <canvas ref={canvas} id='background' />
      <AjaxForm
        className='glass user-form'
        loading={onloadstart}
        loadingEnd={(form) => loadingEnd(form, 'Login')}
        onloadend={onloadeend}
        onerror={onerror}
        action='/api/login'
        autofill={false}
        method='post'
      >
        <div className='glass-layer-1' />
        <div className='glass-layer-2' />
        <div className='glass-layer-3' />
        <h1>
          <span className='icon login' /> Sign in to Acode
        </h1>
        <Input type='email' name='email' label='Email' placeholder='e.g. john@gmail.com' />
        <Input type='password' name='password' label='Password' placeholder='Password' autocomplete='current-password' />

        <span className='success'>{successText}</span>
        <span className='error'>{errorText}</span>
        <button ref={button} type='submit'>
          Sign in
        </button>
        <div className='oauth-section'>
          <div className='divider'>
            <span>or continue with</span>
          </div>
          <div className='oauth-buttons'>
            <OAuthButton provider='github' redirectUrl={oauthRedirect} />
            <OAuthButton provider='google' redirectUrl={oauthRedirect} />
          </div>
        </div>
        <div style={{ margin: 'auto' }}>
          <a className='link' href={withRedirect('/register', redirect)}>
            Create Account
          </a>
          &nbsp;|&nbsp;
          <a className='link' href={withRedirect('/change-password?mode=reset', redirect)}>
            Forgot password?
          </a>
        </div>
      </AjaxForm>
    </section>
  );

  function onloadstart(form) {
    loadingStart(form, errorText, successText);
  }

  function onloadeend(data) {
    if (data.error) {
      onerror(data.error);
      return;
    }

    redirectAfterDone();
  }

  function onerror(error) {
    if (button.el) {
      button.el.disabled = false;
    }
    successText.value = '';
    errorText.value = error;
  }

  async function getAppRedirectUrl() {
    if (!usesAppCodeFlow || !appLoginState || !appAuthChallenge) {
      throw new Error('Invalid app login request');
    }

    const res = await fetch('/api/user/app-auth-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: appLoginState,
        challenge: appAuthChallenge,
        appVersionCode,
      }),
    });

    if (!res.ok) {
      throw new Error(await getResponseError(res, 'Failed to create app auth code'));
    }

    const data = await res.json();
    if (!data.code) {
      throw new Error('Failed to create app auth code');
    }

    const callback = new URL('acode://auth/callback');
    callback.searchParams.set('code', data.code);
    callback.searchParams.set('state', appLoginState);
    return callback.toString();
  }

  async function redirectAfterDone() {
    if (button.el) {
      button.el.disabled = true;
    }

    try {
      if (redirect === 'app') {
        redirect = await getAppRedirectUrl();
      }
    } catch (error) {
      onerror(error.message);
      return;
    }

    errorText.value = '';
    successText.value = 'Login successful. Redirecting...';

    setTimeout(() => {
      window.location.replace(redirect || '/');
    }, 1000);
  }
}

async function getResponseError(response, fallback) {
  try {
    const data = await response.json();
    return data.error || fallback;
  } catch {
    return fallback;
  }
}
