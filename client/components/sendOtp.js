/**
 *
 * @param {object} props
 * @param {'signup'| 'reset'} props.type
 * @param {object} props.errorText
 * @param {Ref} [props.ref]
 * @param {() => string} props.getEmail
 * @param {string} [props.className]
 * @returns
 */
export default function SendOtp({ errorText, getEmail, type = 'signup', ref, className = '' }) {
  const cooldowns = new Map();
  const defaultText = 'Send OTP';
  let button;

  if (ref) {
    const existingOnRef = ref.onref;
    ref.onref = (el) => {
      if (typeof existingOnRef === 'function') {
        existingOnRef(el);
      }
      button = el || ref.el;
      renderState();
    };
    ref.refresh = renderState;
  }

  return (
    <span style={{ marginTop: 0 }} className={`link ${className}`.trim()} on:click={sendOtp} ref={ref}>
      {defaultText}
    </span>
  );

  async function sendOtp(e) {
    const email = normalizeEmail(getEmail());
    if (!email) {
      errorText.value = 'Email is required';
      return;
    }

    const { target } = e;
    button = target;
    errorText.value = '';

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
        errorText.value = data.error;
        renderState();
        return;
      }
      startCooldown(email);
      renderState();
    } catch (error) {
      errorText.value = error.message;
      renderState();
    }
  }

  function startCooldown(email) {
    const existing = cooldowns.get(email);
    if (existing?.timer) {
      clearInterval(existing.timer);
    }

    const entry = {
      expiresAt: Date.now() + 60_000,
      timer: null,
    };
    entry.timer = setInterval(() => {
      if (getRemainingSeconds(entry) <= 0) {
        clearInterval(entry.timer);
        cooldowns.delete(email);
      }
      renderState();
    }, 1000);
    cooldowns.set(email, entry);
  }

  function renderState() {
    const target = button || ref?.el;
    if (!target) return;

    const email = normalizeEmail(getEmail());
    const cooldown = cooldowns.get(email);
    const remaining = cooldown ? getRemainingSeconds(cooldown) : 0;

    if (remaining > 0) {
      target.classList.remove('link');
      target.classList.add('success');
      target.style.pointerEvents = 'none';
      target.textContent = `Resend OTP (${remaining})`;
      target.onclick = null;
      return;
    }

    target.style.pointerEvents = 'auto';
    target.classList.remove('success');
    target.classList.add('link');
    target.textContent = defaultText;
    target.onclick = sendOtp;
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getRemainingSeconds(cooldown) {
  return Math.max(0, Math.ceil((cooldown.expiresAt - Date.now()) / 1000));
}
