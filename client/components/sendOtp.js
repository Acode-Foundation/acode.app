/**
 *
 * @param {object} props
 * @param {'signup'| 'reset'} props.type
 * @param {object} props.errorText
 * @param {() => string} props.getEmail
 * @returns
 */
export default function SendOtp({ errorText, getEmail, type = 'signup' }) {
  return (
    <span style={{ marginTop: 0 }} className='link' on:click={sendOtp}>
      Send OTP
    </span>
  );

  async function sendOtp(e) {
    const email = getEmail();
    const { target } = e;
    const oldText = target.textContent;
    errorText.value = '';

    const restore = () => {
      target.style.pointerEvents = 'auto';
      target.classList.remove('success');
      target.classList.add('link');
      target.textContent = oldText;
      target.onclick = sendOtp;
    };

    try {
      target.classList.remove('link');
      target.textContent = 'Sending...';
      target.onclick = null;
      const formData = new FormData();
      formData.append('email', email);
      const res = await fetch(`/api/otp?type=${type}`, {
        method: 'post',
        body: formData,
      });
      const data = await res.json();
      if (data.error) {
        restore();
        errorText.value = data.error;
        return;
      }
      target.classList.add('success');
      target.textContent = data.message;
      target.style.pointerEvents = 'none';
      startTimer(
        60,
        (time) => {
          target.textContent = `Resend OTP (${time})`;
        },
        restore,
      );
    } catch (error) {
      errorText.value = error.message;
      restore();
    }
  }
}

function startTimer(time, callback, onTimeEnd) {
  const timer = setInterval(() => {
    time--;
    if (time === 0) {
      clearInterval(timer);
      onTimeEnd();
      return;
    }
    callback(time);
  }, 1000);
}
