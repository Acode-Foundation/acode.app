import { observeAdUnits } from '../../client/lib/adUnits';

describe('manual AdSense unit lifecycle', () => {
  let root;
  let units;
  let sizes;
  let changes;
  let resize;
  let mutate;
  let dispose;

  function unit(width = 320) {
    const attributes = new Map();
    const loader = { style: { display: '' } };
    return {
      isConnected: true,
      width,
      loader,
      parentElement: { hidden: false, querySelector: () => loader },
      matches: () => true,
      getBoundingClientRect() {
        return { width: this.width };
      },
      getAttribute: (name) => attributes.get(name),
      hasAttribute: (name) => attributes.has(name),
      setAttribute: (name, value) => attributes.set(name, value),
    };
  }

  function mount(ad) {
    ad.isConnected = true;
    units.push(ad);
    mutate([{ type: 'childList' }]);
  }

  function remove(ad) {
    ad.isConnected = false;
    units = units.filter((candidate) => candidate !== ad);
    mutate([{ type: 'childList' }]);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    units = [];
    root = { querySelectorAll: () => units, contains: (ad) => units.includes(ad) };
    vi.stubGlobal('window', {});
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback) {
          resize = (ad) => callback([{ target: ad }]);
          sizes = this;
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback) {
          mutate = callback;
          changes = this;
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('safely queues once while the script is delayed or blocked', () => {
    const ad = unit();
    units.push(ad);
    dispose = observeAdUnits(root);
    expect(window.adsbygoogle).toEqual([{}]);
    resize(ad);
    mutate([{ type: 'childList' }]);
    expect(window.adsbygoogle).toHaveLength(1);
    expect(sizes.unobserve).toHaveBeenCalledWith(ad);
    expect(ad.loader.style.display).toBe('');

    // The later Google script consumes the existing queue and handles new units.
    const push = vi.fn();
    window.adsbygoogle = { push };
    mount(unit());
    expect(push).toHaveBeenCalledExactlyOnceWith({});
  });

  it('waits for connection and positive width, including tabs mounted later', () => {
    const ad = unit(0);
    ad.isConnected = false;
    units.push(ad);
    dispose = observeAdUnits(root);
    expect(window.adsbygoogle).toBeUndefined();
    expect(sizes.observe).not.toHaveBeenCalled();

    ad.isConnected = true;
    mutate([{ type: 'childList' }]);
    expect(sizes.observe).toHaveBeenCalledWith(ad);
    expect(window.adsbygoogle).toBeUndefined();
    ad.width = 320;
    resize(ad);
    expect(window.adsbygoogle).toEqual([{}]);
  });

  it('releases removed pending units and can initialize them after remounting', () => {
    const ad = unit(0);
    units.push(ad);
    dispose = observeAdUnits(root);
    vi.advanceTimersByTime(3_000);
    remove(ad);
    expect(sizes.unobserve).toHaveBeenCalledWith(ad);
    expect(vi.getTimerCount()).toBe(0);
    expect(ad.loader.style.display).toBe('none');
    vi.advanceTimersByTime(7_000);
    ad.width = 320;
    resize(ad);
    expect(window.adsbygoogle).toBeUndefined();
    mount(ad);
    expect(window.adsbygoogle).toHaveLength(1);
    expect(ad.loader.style.display).toBe('none');
    expect(vi.getTimerCount()).toBe(0);
    remove(ad);
    mount(ad);
    expect(window.adsbygoogle).toHaveLength(1);
  });

  it('ignores stale resize callbacks even before the removal mutation arrives', () => {
    const ad = unit(0);
    units.push(ad);
    dispose = observeAdUnits(root);
    ad.isConnected = false;
    ad.width = 320;
    resize(ad);
    expect(window.adsbygoogle).toBeUndefined();
    expect(sizes.unobserve).toHaveBeenCalledWith(ad);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves existing requests and collapses unfilled placements without touching ad contents', () => {
    const ad = unit();
    ad.setAttribute('data-adsbygoogle-status', 'done');
    units.push(ad);
    dispose = observeAdUnits(root);
    expect(window.adsbygoogle).toBeUndefined();
    ad.setAttribute('data-ad-status', 'unfilled');
    mutate([{ type: 'attributes', target: ad }]);
    expect(ad.parentElement.hidden).toBe(true);
    expect(ad.loader.style.display).toBe('none');
    expect(vi.getTimerCount()).toBe(0);
    ad.setAttribute('data-ad-status', 'filled');
    mutate([{ type: 'attributes', target: ad }]);
    expect(ad.parentElement.hidden).toBe(false);
    expect(ad.loader.style.display).toBe('none');
    expect(ad.getAttribute('data-adsbygoogle-status')).toBe('done');
  });

  it('does not retry failed requests or let provider errors escape', () => {
    const ad = unit();
    const push = vi.fn(() => {
      throw new Error('Provider unavailable');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.adsbygoogle = { push };
    units.push(ad);
    expect(() => {
      dispose = observeAdUnits(root);
    }).not.toThrow();
    expect(ad.parentElement.hidden).toBe(true);
    expect(ad.loader.style.display).toBe('none');
    expect(vi.getTimerCount()).toBe(0);
    mutate([{ type: 'childList' }]);
    resize(ad);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate a unit processed by Google while waiting for its size', () => {
    const ad = unit(0);
    units.push(ad);
    dispose = observeAdUnits(root);
    ad.setAttribute('data-adsbygoogle-status', 'done');
    ad.width = 320;
    resize(ad);
    expect(window.adsbygoogle).toBeUndefined();
    expect(sizes.unobserve).toHaveBeenCalledWith(ad);
  });

  it('disconnects observers and ignores queued callbacks after disposal', () => {
    const ad = unit(0);
    const requestedAd = unit();
    units.push(ad, requestedAd);
    dispose = observeAdUnits(root);
    dispose();
    ad.width = 320;
    resize(ad);
    mutate([{ type: 'childList' }]);
    expect(window.adsbygoogle).toHaveLength(1);
    expect(ad.loader.style.display).toBe('none');
    expect(requestedAd.loader.style.display).toBe('none');
    expect(vi.getTimerCount()).toBe(0);
    expect(sizes.disconnect).toHaveBeenCalledTimes(1);
    expect(changes.disconnect).toHaveBeenCalledTimes(1);
  });

  it('hides a blocked loader after ten seconds without hiding the placement or preventing a late fill', () => {
    const ad = unit();
    units.push(ad);
    dispose = observeAdUnits(root);
    vi.advanceTimersByTime(6_000);
    resize(ad);
    mutate([{ type: 'childList' }]);
    vi.advanceTimersByTime(3_999);
    expect(ad.loader.style.display).toBe('');
    vi.advanceTimersByTime(1);
    expect(ad.loader.style.display).toBe('none');
    expect(ad.parentElement.hidden).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    ad.setAttribute('data-ad-status', 'filled');
    mutate([{ type: 'attributes', target: ad }]);
    expect(ad.parentElement.hidden).toBe(false);
    expect(ad.loader.style.display).toBe('none');
    expect(window.adsbygoogle).toHaveLength(1);
  });

  it('resumes only the remaining loading time on tab remount without requesting another ad', () => {
    const ad = unit();
    units.push(ad);
    dispose = observeAdUnits(root);
    vi.advanceTimersByTime(3_000);
    remove(ad);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(4_000);
    mount(ad);
    expect(ad.loader.style.display).toBe('');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3_000);
    expect(ad.loader.style.display).toBe('none');
    remove(ad);
    mount(ad);
    expect(ad.loader.style.display).toBe('none');
    expect(vi.getTimerCount()).toBe(0);
    expect(window.adsbygoogle).toHaveLength(1);
  });

  it('gives a later unit its own deadline and stops its loader when filled', () => {
    const first = unit();
    units.push(first);
    dispose = observeAdUnits(root);
    vi.advanceTimersByTime(10_000);
    const later = unit();
    mount(later);
    expect(later.loader.style.display).toBe('');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_000);
    later.setAttribute('data-ad-status', 'filled');
    mutate([{ type: 'attributes', target: later }]);
    expect(later.loader.style.display).toBe('none');
    expect(later.parentElement.hidden).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    remove(later);
    mount(later);
    expect(later.loader.style.display).toBe('none');
    expect(vi.getTimerCount()).toBe(0);
    expect(window.adsbygoogle).toHaveLength(2);
  });
});
