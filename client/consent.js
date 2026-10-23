import './consent.scss';
import { isAdFreeRoute } from '../shared/adPolicy';
import { observeAdUnits } from './lib/adUnits';
import { CONSENT_KEY, createConsentController, suppressVignettes } from './lib/cookieConsent';

const adsAllowed = document.currentScript?.dataset.adsDisabled === 'false' && !isAdFreeRoute(location.pathname);
// Do this before injecting either Google script, including on remembered consent.
suppressVignettes(document.body);
let storage;
try {
  storage = window.localStorage;
} catch {
  /* Fail closed when storage is unavailable. */
}
const controller = createConsentController({
  storage,
  adsAllowed,
  loadScript: (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    }),
  observeAds: () => observeAdUnits(document.body),
  setAdsVisible: (visible) => document.documentElement.classList.toggle('optional-ads-enabled', visible),
  reload: () => location.reload(),
});

const panel = document.createElement('section');
panel.className = 'cookie-consent';
panel.setAttribute('aria-label', 'Cookie preferences');
panel.innerHTML = `
  <div class="cookie-consent-copy"><strong>Your privacy, your choice</strong>
    <p>We use essential cookies to keep you signed in. Analytics and advertising cookies are optional. <a href="/policy">Privacy policy</a></p>
  </div>
  <div class="cookie-consent-options" hidden>
    <label><input type="checkbox" checked disabled> Essential <span>Required for sign-in and security</span></label>
    <label><input type="checkbox" name="analytics"> Analytics <span>Help us understand website usage</span></label>
    <label><input type="checkbox" name="advertising"> Advertising <span>Allow Google ads; additional regional consent may apply</span></label>
    <p>Turning off a previously enabled option reloads this page. Save any unfinished work first.</p>
    <button type="button" data-choice="cancel">Cancel</button>
    <button type="button" data-google-privacy hidden>Google advertising privacy settings</button>
  </div>
  <p role="status" data-consent-status hidden></p>
  <button type="button" data-consent-reload hidden>Reload page</button>
  <div class="cookie-consent-actions">
    <button type="button" data-choice="reject">Reject optional</button>
    <button type="button" data-choice="settings">Settings</button>
    <button type="button" data-choice="accept">Accept all</button>
    <button type="button" data-choice="save" hidden>Save preferences</button>
  </div>`;
document.body.append(panel);
panel.hidden = !!controller.getChoice();
const options = panel.querySelector('.cookie-consent-options');
const analytics = panel.querySelector('[name="analytics"]');
const advertising = panel.querySelector('[name="advertising"]');
const status = panel.querySelector('[data-consent-status]');
const reloadButton = panel.querySelector('[data-consent-reload]');
let opener;
reloadButton.onclick = () => location.reload();

function closeSettings() {
  panel.hidden = !!controller.getChoice();
  options.hidden = true;
  panel.querySelector('[data-choice="settings"]').hidden = false;
  panel.querySelector('[data-choice="save"]').hidden = true;
  if (opener?.isConnected) opener.focus();
  else if (!panel.hidden) panel.querySelector('[data-choice="settings"]').focus();
}

panel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !options.hidden) {
    event.preventDefault();
    closeSettings();
  }
});

function openSettings() {
  if (!panel.contains(document.activeElement)) opener = document.activeElement;
  const choice = controller.getChoice();
  analytics.checked = choice?.analytics === true;
  advertising.checked = choice?.advertising === true;
  options.hidden = false;
  panel.hidden = false;
  panel.querySelector('[data-choice="settings"]').hidden = true;
  panel.querySelector('[data-choice="save"]').hidden = false;
  analytics.focus();
}

panel.addEventListener('click', (event) => {
  const action = event.target.closest('[data-choice]')?.dataset.choice;
  if (!action) return;
  if (action === 'settings') return openSettings();
  if (action === 'cancel') return closeSettings();
  const result = controller.save({
    analytics: action === 'save' ? analytics.checked : action === 'accept',
    advertising: action === 'save' ? advertising.checked : action === 'accept',
  });
  status.hidden = !result.error;
  status.textContent = result.error || '';
  if (result.error) return;
  panel.hidden = true;
  if (opener?.isConnected) opener.focus();
});
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-cookie-settings]')) openSettings();
});
window.addEventListener('storage', (event) => {
  if (event.storageArea === storage && (event.key === CONSENT_KEY || event.key === null)) {
    const { reloadRequired } = controller.refresh();
    analytics.checked = controller.getChoice()?.analytics === true;
    advertising.checked = controller.getChoice()?.advertising === true;
    if (reloadRequired) {
      status.textContent =
        'Advertising consent changed in another tab. Save any unfinished work, then reload to fully stop advertising already running on this page.';
      status.hidden = false;
      reloadButton.hidden = false;
      panel.hidden = false;
    } else if (!controller.getChoice()) {
      panel.hidden = false;
    }
  }
});

window.googlefc = window.googlefc || {};
window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
window.googlefc.callbackQueue.push({
  CONSENT_API_READY: () => {
    const button = panel.querySelector('[data-google-privacy]');
    if (typeof window.googlefc.showRevocationMessage !== 'function') return;
    button.hidden = false;
    button.onclick = () => window.googlefc.showRevocationMessage();
  },
});
