import AjaxForm from 'components/ajaxForm';
import Input from 'components/input';
import SendOtp from 'components/sendOtp';
import Reactive from 'html-tag-js/reactive';
import { getLoggedInUser, loadingEnd, loadingStart } from 'lib/helpers';

export default async function registerUser({ mode }) {
  const title = mode === 'edit' ? 'Edit user' : 'Register new user';
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

  return (
    <section id='register-user'>
      <h1>{title}</h1>
      <AjaxForm
        loading={(form) => loadingStart(form, errorText, successText)}
        loadingEnd={(form) => loadingEnd(form, buttonText)}
        onloadend={onloadend}
        onerror={onerror}
        action='/api/user'
        method={method}
      >
        <Input value={user?.name} type='text' name='name' label='Name' placeholder='e.g. John Doe' />

        <div>
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

        <Input value={user.github} type='text' name='github' label='Github' placeholder='e.g. johndoe' />
        <Input value={user.website} type='url' name='website' label='Website' placeholder='e.g. https://john.dev' />
        {mode === 'edit' ? (
          <a href='/change-password'>Change password</a>
        ) : (
          <Input type='password' name='password' label='Password' placeholder='password' />
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
      <p>
        By clicking <strong>Register</strong> button above you agree to our <a href='/policy'>Privacy Policy and Terms and conditions</a>.
      </p>
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
        window.location.href = '/login';
      }, 2000);
      return;
    }

    successText.value = 'User updated successfully.';
  }

  function onerror(error) {
    errorText.value = error;
  }
}
