import { CONSENT_DURATION, CONSENT_KEY, createConsentController, GA_ID, readConsent, suppressVignettes } from '../../client/lib/cookieConsent';

function setup({ stored, adsAllowed = true, blockedStorage = false } = {}) {
  const storage = {
    getItem: vi.fn(() => stored || null),
    removeItem: vi.fn(() => {
      stored = null;
    }),
    setItem: vi.fn((_key, value) => {
      if (blockedStorage) throw Error('blocked');
      stored = value;
    }),
  };
  const pending = [];
  const failed = [];
  const loadScript = vi.fn(
    () =>
      new Promise((resolve, reject) => {
        pending.push(resolve);
        failed.push(reject);
      }),
  );
  const stop = vi.fn();
  const observeAds = vi.fn(() => stop);
  const setAdsVisible = vi.fn();
  const reload = vi.fn();
  const win = {};
  const controller = createConsentController({ storage, adsAllowed, loadScript, observeAds, setAdsVisible, reload, win });
  return { storage, pending, failed, loadScript, stop, observeAds, setAdsVisible, reload, win, ...controller };
}
const saved = (values = {}) => JSON.stringify({ version: 1, analytics: true, advertising: true, expires: Date.now() + CONSENT_DURATION, ...values });

describe('cookie consent', () => {
  it.each([null, '{invalid', saved({ version: 2 }), saved({ expires: 0 }), saved({ analytics: 'true' })])(
    'fails closed for missing or invalid consent %s',
    (stored) => {
      const state = setup({ stored });
      expect(state.loadScript).not.toHaveBeenCalled();
      expect(state.win[`ga-disable-${GA_ID}`]).toBe(true);
      expect(state.setAdsVisible).toHaveBeenLastCalledWith(false);
    },
  );
  it('handles inaccessible storage', () => {
    expect(readConsent(undefined)).toBeNull();
    const state = setup({ blockedStorage: true });
    state.save({ analytics: true, advertising: true });
    expect(state.loadScript).not.toHaveBeenCalled();
  });
  it('loads analytics independently and remembers the decision', () => {
    const state = setup();
    state.save({ analytics: true, advertising: false });
    expect(state.loadScript).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('googletagmanager'));
    expect(state.storage.setItem).toHaveBeenCalledWith(CONSENT_KEY, expect.any(String));
    expect(state.win[`ga-disable-${GA_ID}`]).toBe(false);
  });
  it('never loads AdSense on an excluded document even with remembered consent', () => {
    const state = setup({ stored: saved(), adsAllowed: false });
    expect(state.loadScript).toHaveBeenCalledTimes(1);
    expect(state.loadScript.mock.calls[0][0]).toContain('googletagmanager');
    expect(state.observeAds).not.toHaveBeenCalled();
  });
  it('starts ads once after SDK load, including when analytics is enabled while loading', async () => {
    const state = setup();
    state.save({ analytics: false, advertising: true });
    state.save({ analytics: true, advertising: true });
    state.pending[0]();
    await Promise.resolve();
    expect(state.observeAds).toHaveBeenCalledOnce();
    state.save({ analytics: true, advertising: true });
    expect(state.loadScript).toHaveBeenCalledTimes(2);
  });
  it('withdraws consent immediately and ignores a late SDK callback', async () => {
    const state = setup({ stored: saved() });
    state.save({ analytics: false, advertising: false });
    for (const resolve of state.pending) resolve();
    await Promise.resolve();
    expect(state.observeAds).not.toHaveBeenCalled();
    expect(state.win[`ga-disable-${GA_ID}`]).toBe(true);
    expect(state.reload).toHaveBeenCalledOnce();
  });
  it('cleans up running ads and does not overwrite another tab’s preference', async () => {
    const state = setup({ stored: saved({ analytics: false }) });
    state.pending[0]();
    await Promise.resolve();
    state.storage.getItem.mockReturnValue(saved({ analytics: false, advertising: false }));
    expect(state.refresh()).toEqual({ reloadRequired: true });
    expect(state.stop).toHaveBeenCalledOnce();
    expect(state.reload).not.toHaveBeenCalled();
    expect(state.storage.setItem).not.toHaveBeenCalled();
  });
  it('does not require a reload after a failed ad SDK request and can retry on a later grant', async () => {
    const state = setup({ stored: saved({ analytics: false }) });
    state.failed[0](Error('SDK blocked'));
    await Promise.resolve();
    await Promise.resolve();
    state.storage.getItem.mockReturnValue(saved({ analytics: false, advertising: false }));
    expect(state.refresh()).toEqual({ reloadRequired: false });
    expect(state.observeAds).not.toHaveBeenCalled();
    expect(state.setAdsVisible).toHaveBeenLastCalledWith(false);
    expect(state.reload).not.toHaveBeenCalled();
    state.storage.getItem.mockReturnValue(saved({ analytics: false }));
    state.refresh();
    expect(state.loadScript).toHaveBeenCalledTimes(2);
    state.pending[1]();
    await Promise.resolve();
    expect(state.observeAds).toHaveBeenCalledOnce();
  });
  it('removes an old opt-in when persisting withdrawal fails', () => {
    const state = setup({ stored: saved(), blockedStorage: true });
    expect(state.save({ analytics: false, advertising: false })).toEqual({});
    expect(state.storage.removeItem).toHaveBeenCalledWith(CONSENT_KEY);
    expect(readConsent(state.storage)).toBeNull();
    expect(state.reload).toHaveBeenCalledOnce();
  });
  it('does not reload into an old opt-in when storage cannot be cleared', () => {
    const state = setup({ stored: saved(), blockedStorage: true });
    state.storage.removeItem.mockImplementation(() => {
      throw Error('blocked');
    });
    expect(state.save({ analytics: false, advertising: false }).error).toContain('could not save');
    expect(state.reload).not.toHaveBeenCalled();
    expect(state.win[`ga-disable-${GA_ID}`]).toBe(true);
  });
  it('applies grants and unchanged preferences in other tabs without reload', () => {
    const state = setup();
    state.storage.getItem.mockReturnValue(saved());
    expect(state.refresh()).toEqual({ reloadRequired: false });
    state.refresh();
    expect(state.loadScript).toHaveBeenCalledTimes(2);
    expect(state.reload).not.toHaveBeenCalled();
  });
  it('revokes analytics on ad-free pages without losing unsaved forms', () => {
    const state = setup({ stored: saved(), adsAllowed: false });
    state.storage.getItem.mockReturnValue(saved({ analytics: false, advertising: false }));
    expect(state.refresh()).toEqual({ reloadRequired: false });
    expect(state.win[`ga-disable-${GA_ID}`]).toBe(true);
    expect(state.reload).not.toHaveBeenCalled();
  });
  it('ignores delayed ad startup after cross-tab withdrawal', async () => {
    const state = setup({ stored: saved() });
    state.storage.getItem.mockReturnValue(null);
    state.refresh();
    for (const resolve of state.pending) resolve();
    await Promise.resolve();
    expect(state.observeAds).not.toHaveBeenCalled();
    expect(state.setAdsVisible).toHaveBeenLastCalledWith(false);
  });
  it('marks only new or changed owned links without rescanning the page or touching ad markup', () => {
    function element({ link = false, ad = false, children = [] } = {}) {
      const attributes = new Map();
      return {
        nodeType: 1,
        matches: () => link,
        closest: () => (ad ? {} : null),
        getAttribute: (key) => attributes.get(key) ?? null,
        setAttribute: vi.fn((key, value) => attributes.set(key, value)),
        querySelectorAll: vi.fn(() => children),
      };
    }
    const owned = element({ link: true });
    const ad = element({ link: true, ad: true });
    const root = element({ children: [owned, ad] });
    root.contains = (node) => !node.detached;
    let update;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback) {
          update = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const stop = suppressVignettes(root);
    expect(owned.setAttribute).toHaveBeenCalledWith('data-google-vignette', 'false');
    expect(ad.setAttribute).not.toHaveBeenCalled();
    const dynamic = element({ link: true });
    const nested = element({ link: true });
    const container = element({ children: [nested] });
    const adContainer = element({ ad: true, children: [ad] });
    const detached = { ...element({ link: true }), detached: true };
    update([{ type: 'childList', addedNodes: [dynamic, container, adContainer, detached, { nodeType: 3 }] }]);
    expect(dynamic.setAttribute).toHaveBeenCalledOnce();
    expect(nested.setAttribute).toHaveBeenCalledOnce();
    expect(adContainer.querySelectorAll).not.toHaveBeenCalled();
    expect(detached.setAttribute).not.toHaveBeenCalled();
    const changed = element({ link: true });
    update([owned, changed, ad, detached].map((target) => ({ type: 'attributes', target })));
    expect(changed.setAttribute).toHaveBeenCalledWith('data-google-vignette', 'false');
    expect(changed.querySelectorAll).not.toHaveBeenCalled();
    update([
      { type: 'childList', addedNodes: [] },
      { type: 'childList', addedNodes: [element(), { nodeType: 3 }] },
    ]);
    expect(root.querySelectorAll).toHaveBeenCalledOnce();
    expect(owned.setAttribute).toHaveBeenCalledOnce();
    expect(ad.setAttribute).not.toHaveBeenCalled();
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
