import './style.scss';
import AjaxForm from 'components/ajaxForm';
import Input from 'components/input';
import SendOtp from 'components/sendOtp';
import Reactive from 'html-tag-js/reactive';
import { getLoggedInUser, loadingEnd, loadingStart } from 'lib/helpers';

export default async function registerUser({ mode, redirect }) {
  const title = mode === 'edit' ? 'Edit Profile' : 'Create Account';
  const subtitle = mode === 'edit' ? 'Update your profile information' : 'Join the Acode community today';
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
  }

  // const callbackUrl = redirect || '/user'; // GitHub login disabled

  return (
    <section id='register-user'>
      <div className='register-card'>
        <h1>{title}</h1>
        <p className='register-subtitle'>{subtitle}</p>

        {/* GitHub login temporarily disabled */}
        {/* {mode !== 'edit' && (
          <>
            <div className='social-login'>
              <a href={`/api/oauth/github?callbackUrl=${encodeURIComponent(callbackUrl)}`} className='social-btn github'>
                <span className='icon github' />
                <span>Continue with GitHub</span>
              </a>
            </div>

            <div className='divider'>
              <span>or register with email</span>
            </div>
          </>
        )} */}

        <AjaxForm
          loading={(form) => loadingStart(form, errorText, successText)}
          loadingEnd={(form) => loadingEnd(form, buttonText)}
          onloadend={onloadend}
          onerror={onerror}
          action='/api/user'
          method={method}
        >
          <Input value={user?.name} type='text' name='name' label='Name' placeholder='e.g. John Doe' />

          <div className='email-otp-group'>
            <fieldset>
              <Input
                value={user.email}
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

          <Input value={user.github} type='text' name='github' label='Github Username' placeholder='e.g. johndoe' />
          <Input value={user.website} type='url' name='website' label='Website' placeholder='e.g. https://john.dev' />
          {mode === 'edit' ? (
            <a href='/change-password' className='change-password-link'>
              Change password
            </a>
          ) : (
            <Input type='password' name='password' label='Password' placeholder='password' />
          )}

          <div className='error'>{errorText}</div>
          <div className='success'>{successText}</div>
          <button type='submit'>{buttonText}</button>
        </AjaxForm>

        <div className='register-footer'>
          {mode !== 'edit' && (
            <p className='login-link'>
              Already have an account?{' '}
              <a className='link' href={`/login?redirect=${redirect || ''}`}>
                Sign in
              </a>
            </p>
          )}
          <p className='terms-text'>
            By registering, you agree to our <a href='/policy'>Privacy Policy</a> and <a href='/terms'>Terms of Service</a>.
          </p>
        </div>
      </div>
    </section>
  );

  async function onloadend(data) {
    if (data.error) {
      errorText.value = data.error;
      return;
    }

    if (mode !== 'edit') {
      successText.value = 'Account created successfully. Redirecting...';
      setTimeout(() => {
        window.location.href = `/login?redirect=${redirect || ''}`;
      }, 2000);
      return;
    }

    successText.value = 'Profile updated successfully.';
  }

  function onerror(error) {
    errorText.value = error;
  }
}
