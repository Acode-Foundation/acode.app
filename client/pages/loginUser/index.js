import './style.scss';
import AjaxForm from 'components/ajaxForm';
import Input from 'components/input';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import background from 'lib/background';
import { loadingEnd, loadingStart } from 'lib/helpers';
import userImage from 'res/user.svg';

export default function LoginUser({ redirect }) {
  const errorText = Reactive('');
  const successText = Reactive('');
  const button = Ref();
  const canvas = Ref();

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
          <a className='link' href={`/register?redirect=${redirect}`}>
            New account.
          </a>{' '}
          |{' '}
          <a className='link' href={`/change-password?redirect=${redirect}&mode=reset`}>
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

    successText.value = 'Login successful. Redirecting...';
    button.el.disabled = true;
    setTimeout(() => {
      if (redirect === 'app') {
        redirect = `acode://user/login/${data.token}`;
      }
      window.location.replace(redirect || '/');
    }, 1000);
  }

  function onerror(error) {
    button.el.disabled = false;
    errorText.value = error;
  }
}
