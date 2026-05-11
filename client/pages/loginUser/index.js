import './style.scss';
import AjaxForm from 'components/ajaxForm';
import Input from 'components/input';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import background from 'lib/background';
import { loadingEnd, loadingStart } from 'lib/helpers';
import userImage from 'res/user.svg';
import { getLoggedInUser } from '../../lib/helpers';

export default async function LoginUser({ redirect: redirectUlr }) {
  const errorText = Reactive('');
  const successText = Reactive('');
  const button = Ref();
  const canvas = Ref();

  try {
    const user = await getLoggedInUser();
    if (user) {
      redirect(getCookie('token'));
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

  canvas.onref = () => background(canvas.el);

  return (
    <section id='user-login'>
      <canvas ref={canvas} id='background' />
      <AjaxForm
        loading={onloadstart}
        loadingEnd={(form) => loadingEnd(form, 'Login')}
        onloadend={onloadeend}
        onerror={onerror}
        action='/api/login'
        method='post'
      >
        <picture className='login-profile'>
          <source srcset={userImage} type='image/svg' />
          <img src={userImage} alt='Wombat' />
        </picture>
        <h1 style={{ textAlign: 'center' }}>Login</h1>
        <Input type='email' name='email' label='Email' placeholder='e.g. john@gmail.com' />
        <Input type='password' name='password' label='Password' placeholder='Password' autocomplete='current-password' />

        <span className='success'>{successText}</span>
        <span className='error'>{errorText}</span>
        <button ref={button} type='submit' style={{ width: '120px' }}>
          Login
        </button>
        <div style={{ margin: 'auto' }}>
          <a className='link' href={`/register?redirect=${redirectUlr}`}>
            New account.
          </a>{' '}
          |{' '}
          <a className='link' href={`/change-password?redirect=${redirectUlr}&mode=reset`}>
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

    redirect(data.token);
  }

  function onerror(error) {
    button.el.disabled = false;
    errorText.value = error;
  }

  function redirect(token) {
    successText.value = 'Login successful. Redirecting...';

    if (button.el) {
      button.el.disabled = true;
    }

    setTimeout(() => {
      if (redirectUlr === 'app') {
        redirectUlr = `acode://user/login/${token}`;
      }
      window.location.replace(redirectUlr || '/');
    }, 1000);
  }
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);

  if (parts.length === 2) {
    return parts.pop().split(';').shift();
  }
  return null;
}
