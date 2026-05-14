import './style.scss';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import Input from 'components/input';
import OAuthButton from 'components/oauthButton';
import SendOtp from 'components/sendOtp';
import Reactive from 'html-tag-js/reactive';
import { getLoggedInUser, hideLoading, loadingEnd, loadingStart, showLoading } from 'lib/helpers';
import Router from 'lib/Router';

export default async function registerUser({ mode = 'register', redirect }) {
  const isRegister = mode === 'register';
  const title = mode === 'edit' ? 'Edit your account' : 'Register new user';
  const buttonText = mode === 'edit' ? 'Update' : 'Register';
  const method = mode === 'edit' ? 'put' : 'post';
  const errorText = Reactive('');
  const successText = Reactive('');
  let email = '';
  let user = {};

  if (mode === 'edit') {
    user = await getLoggedInUser();
    if (!user) {
      window.location.href = '/login';
      return null;
    }

    const search = new URLSearchParams(window.location.search);
    const linkError = search.get('error');
    if (linkError) {
      alert('Error', linkError, () => {
        search.delete('error');
        const newSearch = search.toString();
        Router.loadUrl(`${location.pathname}${newSearch ? `?${newSearch}` : ''}`);
      });
    }
  }

  return (
    <section id='register-user' className='text-center'>
      <AjaxForm
        loading={(form) => loadingStart(form, errorText, successText)}
        loadingEnd={(form) => loadingEnd(form, buttonText)}
        onloadend={onloadend}
        onerror={onerror}
        action='/api/user'
        method={method}
        autofill={!isRegister}
      >
        <h1>{title}</h1>
        {mode === 'edit' && (
          <div className='oauth-links'>
            <h3>Link Accounts</h3>
            <AuthButton type='github' user={user} />
            <AuthButton type='google' user={user} />
          </div>
        )}
        {isRegister && (
          <>
            <div className='social-login'>
              <OAuthButton provider='github' redirectUrl={redirect} />
              <OAuthButton provider='google' redirectUrl={redirect} />
            </div>
            <div className='divider'>
              <span>or register with email</span>
            </div>
          </>
        )}
        <Input value={user?.name} type='text' name='name' label='Name' placeholder='e.g. John Doe' />

        <div>
          <fieldset>
            <Input
              value={user.email}
              autocomplete={isRegister ? 'new-email' : 'email'}
              onchange={(e) => {
                email = e.target.value;
              }}
              type='email'
              name='email'
              label='Email'
              placeholder='e.g. john@gmail.com'
            />
            <Input style={{ width: '140px' }} type='number' name='otp' label='OTP' placeholder='e.g. 1234' />
          </fieldset>
          <SendOtp errorText={errorText} getEmail={() => email} />
        </div>

        <Input value={user.github} type='text' name='github' label='Github' placeholder='e.g. johndoe' />
        <Input value={user.website} type='url' name='website' label='Website' placeholder='e.g. https://john.dev' />
        {mode === 'edit' ? (
          <a href='/change-password'>Change password</a>
        ) : (
          <Input type='password' name='password' label='Password' placeholder='password' autocomplete={isRegister ? 'new-password' : 'password'} />
        )}

        <div className='error'>{errorText}</div>
        <div className='success'>{successText}</div>
        <button type='submit'>{buttonText}</button>
        {mode !== 'edit' && (
          <a className='link' href='/login'>
            Login to existing account.
          </a>
        )}
      </AjaxForm>
      {isRegister && (
        <p>
          By clicking <strong>Register</strong> button above you agree to our <a href='/policy'>Privacy Policy and Terms and conditions</a>.
        </p>
      )}
    </section>
  );

  async function onloadend(data) {
    if (data.error) {
      errorText.value = data.error;
      return;
    }

    if (mode !== 'edit') {
      successText.value = 'User registered successfully. Redirecting...';
      setTimeout(() => {
        window.location.href = `/login?redirect=${redirect}`;
      }, 2000);
      return;
    }

    successText.value = 'User updated successfully.';
  }

  function onerror(error) {
    errorText.value = error;
  }
}

/**
 * AuthButton
 * @param {object} props
 * @param {'github'|'google'} props.type
 * @param {import('lib/helpers').User} props.user
 */
function AuthButton({ type, user }) {
  const key = `${type}_id`;
  /** @type {HTMLElement} */
  let action = null;

  if (user[key]) {
    if (user.primary_auth === type) {
      action = <span className='oauth-primary-badge'>Primary</span>;
    } else {
      action = (
        <button
          type='button'
          onclick={async () => {
            showLoading();
            try {
              const res = await fetch(`/api/user/link/${type}`, { method: 'DELETE' });
              const data = await res.json();
              if (data.error) {
                throw new Error(data.error.message);
              }
              window.location.reload();
            } catch (error) {
              alert('ERROR', error.message);
            }

            hideLoading();
          }}
          className='oauth-btn unlink'
        >
          Unlink
        </button>
      );
    }
  } else {
    action = (
      <button
        type='button'
        className='oauth-btn connect'
        onclick={(e) => {
          showLoading();
          e.target.disabled = true;
          window.location = `/oauth/${type}?intent=link`;
        }}
      >
        Connect
      </button>
    );
  }

  return (
    <div className='oauth-link-item'>
      <span className={`icon ${type} oauth-link-icon`} />
      <span className='oauth-link-label'>
        {type === 'github' ? 'Github' : 'Google'}{' '}
        {user[key] && <span className='icon check_circle oauth-status oauth-status--linked' title='Connected' />}
      </span>
      {action}
    </div>
  );
}
