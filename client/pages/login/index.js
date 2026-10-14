import './style.scss';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import Input from 'components/input';
import OAuthButton from 'components/oauthButton';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { safeAccountRedirect } from 'lib/appSource';
import background from 'lib/background';
import { getLoggedInUser, invalidateLoggedInUser, loadingEnd, loadingStart, withRedirect } from 'lib/helpers';
import Router from 'lib/Router';
import AppSignIn from './appSignIn';

export default async function Login({ redirect = sessionStorage.getItem('redirect') }) {
  redirect = safeAccountRedirect(redirect);
  const errorText = Reactive('');
  const successText = Reactive('');
  const button = Ref();
  const canvas = Ref();
  const search = new URLSearchParams(window.location.search);
  const oauthRedirect = redirect === 'app' ? withRedirect('/login', 'app') : redirect;
  if (search.get('accountDeleted') === '1') successText.value = 'Your account has been deleted.';

  try {
    const user = await getLoggedInUser();
    if (user) {
      if (redirect === 'app') return <AppSignIn user={user} />;
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
        loadingEnd={(form) => loadingEnd(form, 'Sign in')}
        onloadend={onloadend}
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
            <OAuthButton provider='apple' redirectUrl={oauthRedirect} />
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

  function onloadend(data) {
    if (data.error) {
      onerror(data.error);
      return;
    }

    invalidateLoggedInUser();
    if (redirect === 'app') {
      window.location.replace(withRedirect('/login', 'app'));
    } else {
      redirectAfterDone();
    }
  }

  function onerror(error) {
    if (button.el) {
      button.el.disabled = false;
    }
    successText.value = '';
    errorText.value = error.message || error;
  }

  function redirectAfterDone() {
    if (button.el) {
      button.el.disabled = true;
    }

    errorText.value = '';
    successText.value = 'Login successful. Redirecting...';

    setTimeout(() => {
      window.location.replace(redirect || '/');
    }, 1000);
  }
}
