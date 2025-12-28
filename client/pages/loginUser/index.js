import './style.scss';
import AjaxForm from 'components/ajaxForm';
import Input from 'components/input';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import background from 'lib/background';
import { loadingEnd, loadingStart } from 'lib/helpers';
import userImage from 'res/user.svg';

export default function LoginUser({ redirect, error, error_description }) {
  const errorText = Reactive(error_description || (error ? `Login failed: ${error}` : ''));
  const successText = Reactive('');
  const button = Ref();
  const canvas = Ref();

  canvas.onref = () => background(canvas.el);

  // const callbackUrl = redirect || '/user'; // GitHub login disabled

  return (
    <section id='user-login'>
      <canvas ref={canvas} id='background' />
      <div className='login-card'>
        <picture className='login-profile'>
          <source srcset={userImage} type='image/svg' />
          <img src={userImage} alt='User' />
        </picture>

        <h1>Welcome Back</h1>
        <p className='login-subtitle'>Sign in to your account to continue</p>

        {/* Social Login Buttons - Temporarily disabled */}
        {/* <div className='social-login'>
          <a href={`/api/oauth/github?callbackUrl=${encodeURIComponent(callbackUrl)}`} className='social-btn btn-github'>
            <span className='icon github' />
            <span>Continue with GitHub</span>
          </a>
        </div>

        <div className='divider'>
          <span>or sign in with email</span>
        </div> */}

        <AjaxForm
          loading={onloadstart}
          loadingEnd={(form) => loadingEnd(form, 'Login')}
          onloadend={onloadeend}
          onerror={onerror}
          action='/api/login'
          method='post'
        >
          <Input type='email' name='email' label='Email' placeholder='e.g. john@gmail.com' />
          <Input type='password' name='password' label='Password' placeholder='Password' autocomplete='current-password' />

          <span className='success'>{successText}</span>
          <span className='error'>{errorText}</span>
          <button ref={button} type='submit'>
            Sign In
          </button>
        </AjaxForm>

        <div className='login-footer'>
          <a className='link' href={`/register?redirect=${redirect || ''}`}>
            Create account
          </a>
          <span className='separator'>•</span>
          <a className='link' href={`/change-password?redirect=${redirect || ''}&mode=reset`}>
            Forgot password?
          </a>
        </div>
      </div>
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
      let redirectUrl = redirect;
      if (redirect === 'app') {
        redirectUrl = `acode://user/login/${data.token}`;
      }
      window.location.replace(redirectUrl || '/');
    }, 1000);
  }

  function onerror(error) {
    button.el.disabled = false;
    errorText.value = error;
  }
}
