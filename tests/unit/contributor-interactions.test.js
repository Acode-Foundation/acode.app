import { hover, press } from 'motion';
import { animate } from 'motion/mini';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupHomeInteractions } from '../../client/pages/home/homeInteractions';

vi.mock('motion', () => ({ hover: vi.fn(() => vi.fn()), press: vi.fn(() => vi.fn()), spring: vi.fn() }));
vi.mock('motion/mini', () => ({
  animate: vi.fn((element, styles) => {
    Object.assign(element.style, styles);
    const callbacks = [];
    return {
      stop: vi.fn(),
      // biome-ignore lint/suspicious/noThenProperty: Motion animation controls are intentionally thenable.
      then: (callback) => callbacks.push(callback),
      finish: () => {
        for (const callback of callbacks) callback();
      },
    };
  }),
}));

class Control extends EventTarget {
  style = {};
  contributor = true;
  focusVisible = false;
  matches(selector) {
    return selector === ':focus-visible' ? this.focusVisible : this.contributor;
  }
}

describe('contributor Motion interactions', () => {
  let avatar;
  let repoLink;
  let page;
  let preference;
  let observer;
  let reportMount;
  let dispose;
  const hoverStart = (element) => hover.mock.calls.at(-1)[1](element);
  const pressStart = (element) => press.mock.calls.at(-1)[1](element);

  beforeEach(() => {
    vi.clearAllMocks();
    avatar = new Control();
    repoLink = new Control();
    repoLink.contributor = false;
    page = { querySelectorAll: vi.fn(() => [avatar, repoLink]) };
    preference = new EventTarget();
    preference.matches = false;
    vi.stubGlobal('window', { matchMedia: () => preference });
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback) {
          reportMount = callback;
          observer = this;
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    dispose?.();
    vi.unstubAllGlobals();
  });

  it('binds avatars and the repo link without any entrance animation', () => {
    dispose = setupHomeInteractions(page);
    expect(page.querySelectorAll.mock.calls[0][0]).toContain('.home-contributors__faces a');
    expect(page.querySelectorAll.mock.calls[0][0]).toContain('.home-contributors__link');
    expect(hover).toHaveBeenCalledWith([avatar, repoLink], expect.any(Function));
    expect(animate).not.toHaveBeenCalled();
  });

  it('lifts an avatar with a gentle spring and keeps it above neighbors while returning', () => {
    dispose = setupHomeInteractions(page);
    const leave = hoverStart(avatar);
    expect(animate).toHaveBeenLastCalledWith(
      avatar,
      { transform: 'translateY(-4px) scale(1.14)', boxShadow: '0 8px 18px rgba(0, 0, 0, 0.4)' },
      expect.objectContaining({ duration: 0.42, bounce: 0.08 }),
    );
    leave();
    expect(avatar.style.transform).toBe('translateY(0px) scale(1)');
    expect(avatar.style.zIndex).toBe('2');
    animate.mock.results.at(-1).value.finish();
    expect(avatar.style.zIndex).toBe('');
  });

  it('interrupts rapid changes without an older return animation dropping the active avatar', () => {
    dispose = setupHomeInteractions(page);
    hoverStart(avatar)();
    const returning = animate.mock.results.at(-1).value;
    hoverStart(avatar);
    expect(returning.stop).toHaveBeenCalled();
    returning.finish();
    expect(avatar.style.zIndex).toBe('2');
    expect(avatar.style.transform).toBe('translateY(-4px) scale(1.14)');
  });

  it('provides press feedback and returns to the correct hover state', () => {
    dispose = setupHomeInteractions(page);
    const leave = hoverStart(avatar);
    const release = pressStart(avatar);
    expect(avatar.style.transform).toBe('translateY(0px) scale(0.96)');
    release();
    expect(avatar.style.transform).toBe('translateY(-4px) scale(1.14)');
    leave();
    expect(avatar.style.transform).toBe('translateY(0px) scale(1)');
  });

  it('supports keyboard focus without turning pointer focus into a sticky hover', () => {
    dispose = setupHomeInteractions(page);
    avatar.dispatchEvent(new Event('focus'));
    expect(animate).not.toHaveBeenCalled();
    avatar.focusVisible = true;
    avatar.dispatchEvent(new Event('focus'));
    expect(avatar.style.transform).toBe('translateY(-4px) scale(1.14)');
    hoverStart(avatar)();
    expect(avatar.style.transform).toBe('translateY(-4px) scale(1.14)');
    avatar.dispatchEvent(new Event('blur'));
    expect(avatar.style.transform).toBe('translateY(0px) scale(1)');
  });

  it('keeps ordinary links on their smaller interaction scale', () => {
    dispose = setupHomeInteractions(page);
    hoverStart(repoLink);
    expect(repoLink.style.transform).toBe('translateY(-2px) scale(1)');
    expect(repoLink.style.boxShadow).toBeUndefined();
    pressStart(repoLink);
    expect(repoLink.style.transform).toBe('translateY(0px) scale(0.98)');
  });

  it('clears motion immediately for reduced-motion preferences', () => {
    dispose = setupHomeInteractions(page);
    hoverStart(avatar);
    const animation = animate.mock.results.at(-1).value;
    preference.matches = true;
    preference.dispatchEvent(new Event('change'));
    expect(animation.stop).toHaveBeenCalled();
    expect(avatar.style).toEqual({ transform: '', boxShadow: '', zIndex: '' });
    animate.mockClear();
    pressStart(avatar)();
    expect(animate).not.toHaveBeenCalled();
  });

  it('binds asynchronously mounted contributors once, without entrance animations', () => {
    dispose = setupHomeInteractions(page);
    const laterAvatar = new Control();
    const section = { nodeType: 1, querySelectorAll: () => [laterAvatar] };
    reportMount([{ addedNodes: [section] }]);
    reportMount([{ addedNodes: [section] }]);
    expect(hover).toHaveBeenCalledTimes(2);
    expect(animate).not.toHaveBeenCalled();
    hoverStart(laterAvatar);
    expect(laterAvatar.style.transform).toBe('translateY(-4px) scale(1.14)');
  });

  it('cleans up gestures, focus listeners, observers, and inline styles on navigation', () => {
    dispose = setupHomeInteractions(page);
    hoverStart(avatar);
    const cancelHover = hover.mock.results[0].value;
    const cancelPress = press.mock.results[0].value;
    dispose();
    expect(observer.disconnect).toHaveBeenCalled();
    expect(cancelHover).toHaveBeenCalled();
    expect(cancelPress).toHaveBeenCalled();
    expect(avatar.style).toEqual({ transform: '', boxShadow: '', zIndex: '' });
    animate.mockClear();
    avatar.focusVisible = true;
    avatar.dispatchEvent(new Event('focus'));
    expect(animate).not.toHaveBeenCalled();
  });
});
