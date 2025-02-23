import AjaxForm from 'components/ajaxForm';
import Input from 'components/input';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { loadingEnd, loadingStart } from 'lib/helpers';

export default function LoginUser({ redirect }) {
  const errorText = Reactive('');
  const successText = Reactive('');
  const button = Ref();

  return (
    <section id='login-user'>
      <h1>Developer login</h1>

      <AjaxForm
        loading={onloadstart}
        loadingEnd={(form) => loadingEnd(form, 'Login')}
        onloadend={onloadeend}
        onerror={onerror}
        action='/api/login'
        method='post'
      >
        <Input type='email' name='email' label='Email' placeholder='e.g. john@gmail.com' />
        <Input type='password' name='password' label='Password' placeholder='Password' />

        <span className='success'>{successText}</span>
        <span className='error'>{errorText}</span>
        <button ref={button} type='submit'>
          Login
        </button>
        <div style={{ margin: 'auto' }}>
          <a className='link' href='/register'>
            New account.
          </a>{' '}
          |{' '}
          <a className='link' href='/change-password?mode=reset'>
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

    successText.textContent = 'Login successful. Redirecting...';
    button.el.disabled = true;
    setTimeout(() => {
      window.location.replace(redirect || '/');
    }, 1000);
  }

  function onerror(error) {
    button.el.disabled = false;
    errorText.textContent = error;
  }
}
