import './sendOtp.scss';

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
  const defaultText = 'Send code';
  let button;
  let pending = false;

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
    <button type='button' className={`send-otp ${className}`.trim()} onclick={sendOtp} ref={ref}>
      {defaultText}
    </button>
  );

  async function sendOtp(e) {
    if (pending) return;
    const target = e.currentTarget || e.target;
    button = target;
    const emailInput = target.closest('form')?.querySelector('input[type=email]');
    if (emailInput && !emailInput.reportValidity()) return;
    const email = currentEmail();
    if (getRemainingSeconds(cooldowns.get(normalizeEmail(email))) > 0) return;
    if (!email) {
      errorText.value = 'Email is required';
      return;
    }

    errorText.value = '';
    pending = true;
    renderState();

    try {
      const formData = new FormData();
      formData.append('email', email);
      const res = await fetch(`/api/otp?type=${type}`, {
        method: 'post',
        body: formData,
      });
      const data = await res.json();
      if (data.error) {
        errorText.value = data.error;
        return;
      }
      startCooldown(normalizeEmail(email));
    } catch (error) {
      errorText.value = error.message;
    } finally {
      pending = false;
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

    const email = normalizeEmail(currentEmail());
    const cooldown = cooldowns.get(email);
    const remaining = cooldown ? getRemainingSeconds(cooldown) : 0;
    target.disabled = pending || remaining > 0;
    if (pending) {
      target.textContent = 'Sending…';
      return;
    }

    if (remaining > 0) {
      target.textContent = `Resend in ${remaining}s`;
      return;
    }

    target.textContent = defaultText;
  }

  function currentEmail() {
    const field = button?.closest('form')?.querySelector('input[type=email]');
    // Match the form submission exactly: the server binds codes to this string.
    return String(field?.value ?? getEmail() ?? '');
  }
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function getRemainingSeconds(cooldown) {
  if (!cooldown) return 0;
  return Math.max(0, Math.ceil((cooldown.expiresAt - Date.now()) / 1000));
}
