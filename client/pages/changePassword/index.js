import AjaxForm from 'components/ajaxForm';
import Input from 'components/input';
import SendOtp from 'components/sendOtp';
import Reactive from 'html-tag-js/reactive';
import Router from 'lib/Router';
import { getLoggedInUser, loadingEnd, loadingStart } from 'lib/helpers';

export default async function changePassword({ mode, redirect }) {
  const errorText = Reactive('');
  const successText = Reactive('');
  let title = 'Change password';
  let email = '';

  const user = await getLoggedInUser();
  let action = '/api/password';
  if (mode === 'reset') {
    title = 'Reset password';
    action = '/api/password/reset';
  } else if (!user) {
    window.location.href = '/login';
    return null;
  }

  return (
    <section id='change-password'>
      <h1>{title}</h1>
      <AjaxForm
        method='PUT'
        action={action}
        onloadend={onloadend}
        onerror={onerror}
        loading={(form) => loadingStart(form, errorText, successText)}
        loadingEnd={(form) => loadingEnd(form, 'Change password')}
      >
        {mode === 'reset' ? (
          <div>
            <fieldset>
              <Input
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
            <SendOtp type='reset' errorText={errorText} getEmail={() => email} />
          </div>
        ) : (
          <Input type='password' name='oldPassword' label='Old password' placeholder='old password' />
        )}
        <Input type='password' name='password' label='Password' placeholder='password' />
        <span className='error'>{errorText}</span>
        <span className='success'>{successText}</span>
        <button type='submit'>Change password</button>
      </AjaxForm>
    </section>
  );

  function onloadend(data) {
    if (data.error) {
      errorText.value = data.error;
      return;
    }

    errorText.value = '';
    successText.value = 'Password changed successfully.';
    setTimeout(() => {
      Router.loadUrl(`/login?redirect=${redirect}`);
    }, 3000);
  }

  function onerror(error) {
    errorText.value = error;
  }
}
