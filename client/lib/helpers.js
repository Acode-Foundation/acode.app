import moment from 'moment';

/**
 * @typedef {object} User
 * @property {number} id
 * @property {string} name
 * @property {string} role
 * @property {string} email
 * @property {string} [github]
 * @property {string} [website]
 * @property {number} verified
 * @property {number} threshold
 * @property {number} acode_pro
 * @property {string} [pro_purchased_at]
 * @property {string} [github_id]
 * @property {string} [google_id]
 * @property {string} [avatar_url]
 * @property {'github' | 'google' | 'email'} primary_auth
 * @property {string} created_at
 * @property {string} updated_at
 * @property {boolean} isAdmin
 */

/** @type {User} */
let loggedInUser = null;

/**
 * Format a currency amount, fixing floating point noise (e.g. 39.199999999 → 39.2).
 * Removes unnecessary trailing zeros (40.00 → 40, 39.20 → 39.2).
 * @param {number} amount
 * @returns {number}
 */
export function formatPrice(amount) {
  return parseFloat(Number(amount).toFixed(2));
}

const on = {
  showloading: [],
  hideloading: [],
};
let eventTimeout = null;

export function attachListener(event, callback) {
  on[event].push(callback);
}

export function detachListener(event, callback) {
  on[event] = on[event].filter((cb) => cb !== callback);
}

export function showLoading() {
  document.body.classList.add('loading');
  if (eventTimeout) {
    clearTimeout(eventTimeout);
    return;
  }

  for (const cb of Array.from(on.showloading)) {
    cb();
  }
}

export function hideLoading() {
  document.body.classList.remove('loading');
  eventTimeout = setTimeout(() => {
    eventTimeout = null;
    for (const cb of Array.from(on.hideloading)) {
      cb();
    }
  }, 500);
}

export function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * @returns {Promise<User>}
 */
export async function getLoggedInUser() {
  if (loggedInUser) {
    return loggedInUser;
  }

  const res = await fetch('/api/login');
  const user = await res.json();
  if (user.error) {
    return null;
  }

  loggedInUser = user;

  setTimeout(() => {
    loggedInUser = null;
  }, 5 * 1000);

  return user;
}

/**
 *
 * @param {HTMLElement} el
 * @param {Text} [errorText]
 * @param {Text} [successText]
 * @param {Text} [buttonText]
 */
export function loadingStart(el, errorText, successText, buttonText) {
  const button = el.get('button[type=submit]');
  button.classList.add('loading');
  button.disabled = true;

  if (errorText) {
    errorText.value = '';
  }
  if (errorText) {
    successText.value = '';
  }
  if (buttonText) {
    buttonText.value = 'Loading...';
    return;
  }

  button.textContent = 'Loading...';
}

/**
 *
 * @param {HTMLElement} el
 * @param {string || Text} buttonText
 * @param {string} buttonTextValue
 */
export function loadingEnd(el, buttonText, buttonTextValue) {
  const button = el.get('button[type=submit]');
  button.classList.remove('loading');
  button.disabled = false;
  if (typeof buttonText === 'string') {
    button.textContent = buttonText;
    return;
  }

  buttonText.value = buttonTextValue;
}

export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  return Math.abs(hash).toString(36);
}

export function gravatar(github) {
  if (github) {
    return `https://avatars.githubusercontent.com/${github}`;
  }

  return '/user.png';
}

/**
 * Calculate rating
 * @param {number} votesUp
 * @param {number} votesDown
 * @returns
 */
export function calcRating(votesUp, votesDown) {
  return !votesUp && !votesDown ? 'Unrated' : `${Math.round((votesUp / (votesDown + votesUp)) * 100)}%`;
}

export function since(date) {
  const now = moment().add(new Date().getTimezoneOffset(), 'minutes');
  return moment(date).from(now);
}
