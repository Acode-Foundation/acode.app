import './style.scss';
import AjaxForm from 'components/ajaxForm';
import Input from 'components/input';
import SendOtp from 'components/sendOtp';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import background from 'lib/background';
import { getLoggedInUser, loadingEnd, loadingStart } from 'lib/helpers';
import Router from 'lib/Router';

export default async function changePassword({ mode, redirect }) {
  const errorText = Reactive('');
  const successText = Reactive('');
  const canvas = Ref();

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

  canvas.onref = () => background(canvas.el);

  return (
    <section id='change-password'>
      <canvas ref={canvas} id='background' />
      <AjaxForm
        className='glass user-form'
        method='PUT'
        action={action}
        onloadend={onloadend}
        onerror={onerror}
        loading={(form) => loadingStart(form, errorText, successText)}
        loadingEnd={(form) => loadingEnd(form, 'Change password')}
      >
        <h1>
          <span className='icon vpn_key'></span> {title}
        </h1>
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
        <Input type='password' name='password' label='Password' placeholder='password' autocomplete='new-password' />
        <span className='error'>{errorText}</span>
        <span className='success'>{successText}</span>
        <button type='submit'>Change password</button>
        <p style={{ margin: 0 }}>
          Go back <a href='/login'>Signin</a> page.
        </p>
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
