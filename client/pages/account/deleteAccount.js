import confirm from 'components/dialogs/confirm';
import Input from 'components/input';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { withAppSource } from 'lib/appSource';
import { invalidateLoggedInUser } from 'lib/helpers';

export default function DeleteAccount({ user }) {
  const error = Reactive('');
  const code = Ref();
  const sendButton = Ref();
  const deleteButton = Ref();
  const verification = Ref();

  return (
    <section className='delete-account'>
      <h2>
        <span className='icon warning' aria-hidden='true' /> Delete account
      </h2>
      <p>
        Permanently delete your account and saved payment details. <strong>This cannot be undone.</strong>
      </p>
      <details>
        <summary>What happens to my data?</summary>
        <p>
          All sessions are signed out. Published plugins and purchase/payment records stay under Deleted User. Local files and App Store purchases are
          unaffected.
        </p>
      </details>
      {Boolean(user.apple_id) && (
        <p>
          We also request removal of your Apple authorization. If Apple cannot complete that request, your Acode account will still be deleted. You
          can remove Acode under Sign-In &amp; Security → Sign in with Apple at{' '}
          <a href='https://account.apple.com' target='_blank' rel='noopener noreferrer'>
            your Apple Account
          </a>
          .
        </p>
      )}
      <button type='button' className='danger' ref={sendButton} onclick={sendCode}>
        Send deletion code
      </button>
      <div hidden ref={verification}>
        <p>Enter the six-digit code sent to {user.email}. It expires in 10 minutes.</p>
        <Input ref={code} name='deletion-code' type='tel' label='Confirmation code' autocomplete='one-time-code' maxlength='6' />
        <button type='button' className='danger' ref={deleteButton} onclick={deleteAccount}>
          Permanently delete account
        </button>
      </div>
      <p className='error'>{error}</p>
    </section>
  );

  async function sendCode() {
    sendButton.el.disabled = true;
    error.value = '';
    try {
      await request('/api/account/deletion-code', 'POST');
      verification.el.hidden = false;
      sendButton.el.className = 'resend-code';
      sendButton.el.textContent = 'Resend code';
    } catch (failure) {
      error.value = failure.message;
    } finally {
      sendButton.el.disabled = false;
    }
  }

  async function deleteAccount() {
    const otp = code.el.querySelector('input').value.trim();
    if (!/^\d{6}$/.test(otp)) {
      error.value = 'Enter the six-digit confirmation code.';
      return;
    }
    deleteButton.el.disabled = true;
    try {
      if (!(await confirm('Delete account permanently?', 'This cannot be undone. Your account and saved payment details will be removed.'))) return;
      await request('/api/account', 'DELETE', { otp });
      invalidateLoggedInUser();
      sessionStorage.removeItem('redirect');
      window.location.replace(withAppSource('/login?accountDeleted=1'));
    } catch (failure) {
      error.value = failure.message;
    } finally {
      deleteButton.el.disabled = false;
    }
  }
}

async function request(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to complete the request.');
  return data;
}
