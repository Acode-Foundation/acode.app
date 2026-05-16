import './style.scss';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import Input from 'components/input';
import OAuthButton from 'components/oauthButton';
import SendOtp from 'components/sendOtp';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import background from 'lib/background';
import { getLoggedInUser, hideLoading, loadingEnd, loadingStart, showLoading, withRedirect } from 'lib/helpers';
import Router from 'lib/Router';

export default async function Profile({ mode = 'register', redirect }) {
  const isRegister = mode === 'register';
  const buttonText = mode === 'edit' ? 'Update' : 'Register';
  const method = mode === 'edit' ? 'put' : 'post';
  const errorText = Reactive('');
  const successText = Reactive('');
  const canvas = Ref();
  const otpInput = Ref();
  const sendOtpBtn = Ref();

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

  canvas.onref = () => background(canvas.el);

  if (!isRegister) {
    otpInput.style.display = 'none';
    sendOtpBtn.style.display = 'none';
  }

  return (
    <section id='register-user'>
      <canvas ref={canvas} id='background' />
      <AjaxForm
        className='glass user-form'
        loading={(form) => loadingStart(form, errorText, successText)}
        loadingEnd={(form) => loadingEnd(form, buttonText)}
        onloadend={onloadend}
        onerror={onerror}
        action='/api/user'
        method={method}
        autofill={!isRegister}
      >
        <div className='glass-layer-1' />
        <div className='glass-layer-2' />
        <div className='glass-layer-3' />
        <h1>
          {isRegister ? (
            <>
              <span className='icon person' />
              Signup for Acode
            </>
          ) : (
            <>
              <span className='icon create' />
              Edit your Profile
            </>
          )}
        </h1>
        {mode === 'edit' && (
          <div className='oauth-links'>
            <h3>
              <span className='icon link' /> Link Accounts
            </h3>
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
              oninput={(e) => {
                if (isRegister) return;

                if (e.target.value !== user?.email) {
                  otpInput.style.removeProperty('display');
                  sendOtpBtn.style.removeProperty('display');
                } else {
                  otpInput.style.display = 'none';
                  sendOtpBtn.style.display = 'none';
                }
              }}
              type='email'
              name='email'
              label='Email'
              placeholder='e.g. john@gmail.com'
            />
            <Input ref={otpInput} style={{ width: '140px' }} type='number' name='otp' label='OTP' placeholder='e.g. 1234' />
          </fieldset>
          <SendOtp ref={sendOtpBtn} errorText={errorText} getEmail={() => email} />
        </div>

        {mode === 'edit' && (
          <>
            <h3>
              <span className='icon share' /> Social Links
            </h3>
            <div className='social-link'>
              <span className='icon earth' />
              <Input value={user.website} type='url' name='website' label='Website' placeholder='e.g. https://john.dev' />
            </div>
            <div className='social-link'>
              <span className='icon github' />
              <Input value={user.github} type='text' name='github' label='Github' placeholder='e.g. johndoe' />
            </div>
            <div className='social-link'>
              <span className='icon x' />
              <Input value={user.x} type='text' name='x' label='x' placeholder='e.g. johndoe' />
            </div>
            <div className='social-link'>
              <span className='icon linkedin' />
              <Input value={user.linkedin} type='text' name='linkedin' label='linkedin' placeholder='e.g. johndoe' />
            </div>
          </>
        )}

        {mode === 'edit' ? (
          <a href='/change-password'>Change password</a>
        ) : (
          <Input type='password' name='password' label='Password' placeholder='password' autocomplete={isRegister ? 'new-password' : 'password'} />
        )}

        <div className='error'>{errorText}</div>
        <div className='success'>{successText}</div>
        <button type='submit'>{buttonText}</button>
        {isRegister && (
          <small className='disclaimer'>
            By clicking <strong>Register</strong> button above you agree to our <a href='/policy'>Privacy Policy</a> and{' '}
            <a href='/terms'>Terms and conditions</a>.
          </small>
        )}
        {mode !== 'edit' && (
          <p>
            <a className='link' href={withRedirect('/login', redirect)}>
              Sign in
            </a>{' '}
            to existing account.
          </p>
        )}
      </AjaxForm>
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
        window.location.href = withRedirect('/login', redirect);
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
    if (user.primary_auth !== type) {
      action = (
        <button
          type='button'
          onclick={async () => {
            showLoading();
            try {
              const res = await fetch(`/api/user/link/${type}`, { method: 'DELETE' });
              const data = await res.json();
              if (data.error) {
                throw new Error(data.error);
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
        {Boolean(user[key]) && <span className='icon check_circle oauth-status oauth-status--linked' title='Connected' />}
      </span>
      {action}
    </div>
  );
}
