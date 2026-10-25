import './style.scss';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import Input from 'components/input';
import OAuthButton from 'components/oauthButton';
import SendOtp from 'components/sendOtp';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { clearAccountRedirect, getAccountRedirect, safeAccountRedirect } from 'lib/appSource';
import background from 'lib/background';
import { getLoggedInUser, hideLoading, loadingEnd, loadingStart, showLoading, withRedirect } from 'lib/helpers';
import Router from 'lib/Router';
import DeleteAccount from './deleteAccount';

export default async function Profile({ mode = 'register', redirect }) {
  const isRegister = mode === 'register';
  redirect = isRegister ? getAccountRedirect(redirect) : safeAccountRedirect(redirect);
  if (isRegister) {
    let signedInUser;
    try {
      signedInUser = await getLoggedInUser({ force: true });
    } catch {
      // The server still enforces guest-only registration if this lookup fails.
    }
    if (signedInUser) {
      clearAccountRedirect();
      window.location.replace(redirect === 'app' ? withRedirect('/login', 'app') : redirect || '/');
      return null;
    }
  }
  const oauthRedirect = redirect === 'app' ? withRedirect('/login', redirect) : safeAccountRedirect(redirect);
  const buttonText = mode === 'edit' ? 'Update' : 'Create account';
  const method = mode === 'edit' ? 'put' : 'post';
  const errorText = Reactive('');
  const successText = Reactive('');
  // Keep feedback free of JSX whitespace so :empty hides it until needed.
  const errorMessage = <div className='error' role='alert' />;
  const successMessage = <div className='success' role='status' />;
  errorMessage.append(errorText);
  successMessage.append(successText);
  const canvas = Ref();
  const otpInput = Ref();
  const sendOtpBtn = Ref();

  let email = '';
  let user = {};

  if (mode === 'edit') {
    user = await getLoggedInUser();
    if (!user) {
      window.location.href = withRedirect('/login', '/profile/edit');
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

  email = user.email || '';

  canvas.onref = () => background(canvas.el);

  if (!isRegister) {
    otpInput.style.display = 'none';
    sendOtpBtn.style.display = 'none';
  }

  return (
    <section id='register-user'>
      <canvas ref={canvas} id='background' />
      <AjaxForm
        className={`glass user-form${isRegister ? ' create-account' : ''}`}
        loading={(form) => loadingStart(form, errorText, successText)}
        loadingEnd={(form) => loadingEnd(form, buttonText)}
        onloadend={onloadend}
        onerror={onerror}
        action='/api/user'
        method={method}
        autofill={true}
      >
        <div className='glass-layer-1' />
        <div className='glass-layer-2' />
        <div className='glass-layer-3' />
        <h1>
          {isRegister ? (
            <>
              <span className='icon person' />
              Create your account
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
            <AuthButton type='apple' user={user} />
          </div>
        )}
        {isRegister && (
          <>
            <div className='social-login'>
              <OAuthButton provider='github' redirectUrl={oauthRedirect} />
              <OAuthButton provider='google' redirectUrl={oauthRedirect} />
              <OAuthButton provider='apple' redirectUrl={oauthRedirect} />
            </div>
            <div className='divider'>
              <span>or</span>
            </div>
          </>
        )}
        <Input value={user?.name} type='text' name='name' label='Full name' placeholder='Your name' autocomplete='name' required={isRegister} />

        <div className='email-otp-group'>
          <Input
            value={user.email}
            autocomplete='email'
            required={isRegister}
            onchange={(e) => {
              email = e.target.value;
              updateEmailOtpUi();
            }}
            oninput={(e) => {
              email = e.target.value;
              updateEmailOtpUi();
              sendOtpBtn.refresh?.();
            }}
            type='email'
            name='email'
            label='Email address'
            placeholder='you@example.com'
          />
          <div className='verification-row'>
            <Input
              ref={otpInput}
              type='text'
              inputmode='numeric'
              autocomplete='one-time-code'
              name='otp'
              label='Email code'
              placeholder='Code from email'
              required={isRegister}
            />
            <SendOtp ref={sendOtpBtn} className='otp-send-action' errorText={errorText} getEmail={() => email} />
          </div>
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
          <Input type='password' name='password' label='Password' placeholder='At least 6 characters' autocomplete='new-password' required={true} />
        )}

        {errorMessage}
        {successMessage}
        <button type='submit'>{buttonText}</button>
        {isRegister && (
          <small className='disclaimer'>
            By creating an account, you agree to our <a href='/terms'>Terms of Service</a> and <a href='/policy'>Privacy Policy</a>.
          </small>
        )}
        {mode !== 'edit' && (
          <p className='register-signin'>
            <a className='link' href={withRedirect('/login', redirect)}>
              Sign in instead
            </a>
          </p>
        )}
      </AjaxForm>
      {mode === 'edit' && !user.isAdmin && user.role !== 'admin' && <DeleteAccount user={user} />}
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
    errorText.value = error.message || String(error);
  }

  function updateEmailOtpUi() {
    if (isRegister) return;

    if (normalizeEmail(email) === normalizeEmail(user?.email)) {
      otpInput.style.display = 'none';
      sendOtpBtn.style.display = 'none';
      return;
    }

    otpInput.style.removeProperty('display');
    sendOtpBtn.style.removeProperty('display');
    sendOtpBtn.refresh?.();
  }
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/**
 * AuthButton
 * @param {object} props
 * @param {'github'|'google'|'apple'} props.type
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
        {{ github: 'GitHub', google: 'Google', apple: 'Apple' }[type]}{' '}
        {Boolean(user[key]) && <span className='icon check_circle oauth-status oauth-status--linked' title='Connected' />}
      </span>
      {action}
    </div>
  );
}
