export const CONSENT_KEY = 'acode.cookie-consent';
export const CONSENT_DURATION = 180 * 24 * 60 * 60 * 1000;
export const GA_ID = 'G-YX6J9WVCDP';

export function readConsent(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(CONSENT_KEY));
    if (
      value?.version === 1 &&
      typeof value.analytics === 'boolean' &&
      typeof value.advertising === 'boolean' &&
      Number.isFinite(value.expires) &&
      value.expires > now &&
      value.expires <= now + CONSENT_DURATION
    )
      return value;
  } catch {
    /* Storage can be disabled by the browser. */
  }
  return null;
}

/** Local permission is an outer gate; Google's regional CMP still governs ads. */
export function createConsentController({ storage, adsAllowed, loadScript, observeAds, setAdsVisible, reload, win = window }) {
  let choice = readConsent(storage);
  let generation = 0;
  let stopAds;
  let adsStarted = false;
  let analyticsStarted = false;
  let reloadRequired = false;
  win.dataLayer = win.dataLayer || [];
  win.gtag =
    win.gtag ||
    function () {
      // Google gtag uses an Arguments object in its documented queue protocol.
      // biome-ignore lint/complexity/noArguments: preserve the Google queue protocol
      win.dataLayer.push(arguments);
    };
  win[`ga-disable-${GA_ID}`] = true;
  win.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });

  function apply() {
    const current = generation;
    const analytics = choice?.analytics === true;
    const advertising = !reloadRequired && adsAllowed && choice?.advertising === true;
    win[`ga-disable-${GA_ID}`] = !analytics;
    win.gtag('consent', 'update', { analytics_storage: analytics ? 'granted' : 'denied' });
    if (analytics && !analyticsStarted) {
      analyticsStarted = true;
      win.gtag('js', new Date());
      win.gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
      loadScript(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`).catch(() => {});
    }
    if (!advertising) {
      stopAds?.();
      stopAds = undefined;
      setAdsVisible(false);
    } else if (!adsStarted) {
      adsStarted = true;
      // The AdSense SDK starts Google's CMP. Waiting for CMP here would deadlock.
      loadScript('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5911839694379275')
        .then(
          () => {
            if (current !== generation || !choice?.advertising) return;
            setAdsVisible(true);
            stopAds = observeAds();
          },
          () => {
            adsStarted = false;
            setAdsVisible(false);
          },
        )
        .catch(() => setAdsVisible(false));
    }
  }

  function save(next) {
    const reduced = (choice?.analytics && !next.analytics) || (choice?.advertising && !next.advertising);
    const value = { version: 1, analytics: next.analytics === true, advertising: next.advertising === true, expires: Date.now() + CONSENT_DURATION };
    let persistenceFailed = false;
    try {
      storage.setItem(CONSENT_KEY, JSON.stringify(value));
    } catch {
      // A choice that cannot be remembered must not enable optional services.
      value.analytics = false;
      value.advertising = false;
      // Remove the previous opt-in before a reload can restore it.
      try {
        storage.removeItem(CONSENT_KEY);
        persistenceFailed = storage.getItem(CONSENT_KEY) !== null;
      } catch {
        persistenceFailed = true;
      }
    }
    const mustReload = reduced || (analyticsStarted && !value.analytics) || (adsStarted && !value.advertising);
    if (mustReload) generation++;
    choice = value;
    apply();
    if (persistenceFailed) {
      return {
        error:
          'Your browser could not save this choice. Clear this site’s stored data before reloading to prevent an earlier choice from being restored.',
      };
    }
    if (mustReload || reloadRequired) reload();
    return {};
  }
  apply();
  return {
    getChoice: () => choice,
    save,
    refresh: () => {
      choice = readConsent(storage);
      if (!choice?.advertising) {
        generation++;
        reloadRequired ||= adsStarted;
      }
      apply();
      return { reloadRequired };
    },
  };
}

export function suppressVignettes(root) {
  const update = () => {
    for (const link of root.querySelectorAll('a[href]')) {
      if (!link.closest('[data-acode-ad], .adsbygoogle')) link.setAttribute('data-google-vignette', 'false');
    }
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  return () => observer.disconnect();
}
