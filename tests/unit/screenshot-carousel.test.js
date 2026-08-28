import { animate } from 'motion/mini';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupScreenshotCarousel } from '../../client/pages/home/screenshotCarousel';

vi.mock('motion', () => ({ spring: vi.fn() }));
vi.mock('motion/mini', () => ({
  animate: vi.fn((element, keyframes) => {
    for (const [property, value] of Object.entries(keyframes)) {
      element.style[property] = Array.isArray(value) ? value.at(-1) : value;
    }
    // biome-ignore lint/suspicious/noThenProperty: Motion's animation controls are intentionally thenable.
    return { stop: vi.fn(), complete: vi.fn(), then: (callback) => callback() };
  }),
}));

class Element extends EventTarget {
  style = {};
  dataset = {};
  attributes = new Map();
  isConnected = true;
  open = false;
  textContent = '';
  focus = vi.fn();
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  getAttribute(name) {
    return this.attributes.get(name);
  }
  contains(element) {
    return element === this || this.child === element;
  }
  querySelector() {
    return this.child;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  }
}

function fire(target, type, properties = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, properties);
  target.dispatchEvent(event);
  return event;
}

const shots = [
  { title: 'Editor & LSP', caption: 'Hover docs and completions.', alt: 'Editor', src: 'editor.jpg', webp: 'editor.webp', width: 720, height: 1387 },
  {
    title: 'Linux terminal',
    caption: 'Alpine. apk, npm, git, python.',
    alt: 'Terminal',
    src: 'terminal.jpg',
    webp: 'terminal.webp',
    width: 720,
    height: 1387,
  },
];

describe('homepage screenshot carousel', () => {
  let elements;
  let gallery;
  let slides;
  let dots;
  let triggers;
  let motion;
  let page;
  let scroller;
  let observer;
  let reportVisibility;
  let dispose;
  const get = (selector) => elements.get(selector);
  const activeTitle = () => get('[data-title]').textContent;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    elements = new Map();
    gallery = new Element();
    gallery.querySelector = (selector) => {
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    };
    slides = [new Element(), new Element()];
    dots = [new Element(), new Element()];
    triggers = slides.map((slide, index) => {
      slide.child = new Element();
      slide.child.dataset.expand = String(index);
      return slide.child;
    });
    gallery.querySelectorAll = (selector) =>
      ({
        '.home-gallery__slide': slides,
        '[data-slide]': dots,
        '[data-expand]': triggers,
      })[selector];
    scroller = new Element();
    scroller.style.overflow = 'auto';
    gallery.closest = () => scroller;
    page = new Element();
    page.hidden = false;
    motion = new Element();
    motion.matches = false;
    vi.stubGlobal('document', page);
    vi.stubGlobal('window', { matchMedia: () => motion });
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback) {
          reportVisibility = (visible) => callback([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]);
          observer = this;
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
    vi.unstubAllGlobals();
  });

  function start() {
    dispose = setupScreenshotCarousel(gallery, shots);
    reportVisibility(true);
  }

  it('exposes only the active screenshot and marks its pagination control', () => {
    start();
    expect(slides[0].inert).toBe(false);
    expect(slides[1].inert).toBe(true);
    expect(slides[1].getAttribute('aria-hidden')).toBe('true');
    expect(dots[0].getAttribute('aria-current')).toBe('true');
  });

  it('automatically slides every six seconds and wraps without announcements', () => {
    start();
    vi.advanceTimersByTime(6000);
    expect(activeTitle()).toBe('Linux terminal');
    expect(get('.home-gallery__track').style.transform).toBe('translateX(-100%)');
    vi.advanceTimersByTime(6000);
    expect(activeTitle()).toBe('Editor & LSP');
    expect(get('[data-announcement]').textContent).toBe('');
  });

  it('keeps feature screenshots manual, with no entrance or automatic animation', () => {
    dispose = setupScreenshotCarousel(gallery, shots, { autoplay: false });
    reportVisibility(true);
    vi.advanceTimersByTime(18000);
    expect(activeTitle()).toBe('Editor & LSP');
    expect(animate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    fire(dots[1], 'click');
    expect(activeTitle()).toBe('Linux terminal');
    expect(animate).toHaveBeenCalled();
    fire(get('[data-playback]'), 'click');
    vi.advanceTimersByTime(18000);
    expect(activeTitle()).toBe('Linux terminal');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a manual selection in place until playback is explicitly resumed', () => {
    start();
    fire(get('[data-next]'), 'click');
    expect(get('[data-announcement]').textContent).toBe('2 of 2: Linux terminal');
    fire(gallery, 'pointerleave');
    fire(gallery, 'focusout', { relatedTarget: null });
    vi.advanceTimersByTime(18000);
    expect(activeTitle()).toBe('Linux terminal');
    expect(get('[data-playback]').getAttribute('aria-label')).toBe('Play slideshow');
    fire(get('[data-playback]'), 'click');
    vi.advanceTimersByTime(6000);
    expect(activeTitle()).toBe('Editor & LSP');
  });

  it('supports previous and direct selection controls', () => {
    start();
    fire(get('[data-previous]'), 'click');
    expect(activeTitle()).toBe('Linux terminal');
    fire(dots[0], 'click');
    expect(activeTitle()).toBe('Editor & LSP');
  });

  it('supports direct selection and wrapping across eight screenshots', () => {
    const extendedShots = [...shots];
    for (let index = 2; index < 8; index++) {
      extendedShots.push({ ...shots[0], title: `Feature ${index + 1}` });
      const slide = new Element();
      slide.child = new Element();
      slide.child.dataset.expand = String(index);
      slides.push(slide);
      triggers.push(slide.child);
      dots.push(new Element());
    }
    dispose = setupScreenshotCarousel(gallery, extendedShots);
    fire(dots[7], 'click');
    expect(activeTitle()).toBe('Feature 8');
    expect(get('[data-announcement]').textContent).toBe('8 of 8: Feature 8');
    expect(slides.filter((slide) => !slide.inert)).toHaveLength(1);
    fire(get('[data-next]'), 'click');
    expect(activeTitle()).toBe('Editor & LSP');
    fire(get('[data-previous]'), 'click');
    fire(triggers[7], 'click');
    expect(get('[data-viewer-count]').textContent).toBe('8 / 8');
  });

  it('uses a restrained spring and interrupts existing transitions on rapid navigation', () => {
    start();
    fire(get('[data-next]'), 'click');
    expect(animate).toHaveBeenCalledWith(
      get('.home-gallery__track'),
      { transform: 'translateX(-100%)' },
      expect.objectContaining({ duration: 0.65, bounce: 0 }),
    );
    const firstTransition = animate.mock.results[0].value;
    fire(get('[data-previous]'), 'click');
    expect(firstTransition.stop).toHaveBeenCalled();
    expect(activeTitle()).toBe('Editor & LSP');
  });

  it('pauses on hover and keyboard focus', () => {
    start();
    fire(gallery, 'pointerenter', { pointerType: 'mouse' });
    vi.advanceTimersByTime(6000);
    expect(activeTitle()).toBe('Editor & LSP');
    fire(gallery, 'pointerleave');
    fire(gallery, 'focusin');
    vi.advanceTimersByTime(6000);
    expect(activeTitle()).toBe('Editor & LSP');
    fire(gallery, 'focusout', { relatedTarget: null });
    vi.advanceTimersByTime(6000);
    expect(activeTitle()).toBe('Linux terminal');
  });

  it('honors an explicit play request even with the playback control focused', () => {
    start();
    fire(get('[data-playback]'), 'click');
    fire(gallery, 'focusin');
    fire(gallery, 'pointerenter', { pointerType: 'mouse' });
    fire(get('[data-playback]'), 'click');
    vi.advanceTimersByTime(6000);
    expect(activeTitle()).toBe('Linux terminal');
  });

  it('does not rotate offscreen or in a background tab', () => {
    start();
    reportVisibility(false);
    vi.advanceTimersByTime(12000);
    expect(activeTitle()).toBe('Editor & LSP');
    reportVisibility(true);
    page.hidden = true;
    fire(page, 'visibilitychange');
    vi.advanceTimersByTime(12000);
    expect(activeTitle()).toBe('Editor & LSP');
    page.hidden = false;
    fire(page, 'visibilitychange');
    vi.advanceTimersByTime(6000);
    expect(activeTitle()).toBe('Linux terminal');
  });

  it('starts paused for reduced motion and responds to preference changes', () => {
    motion.matches = true;
    start();
    vi.advanceTimersByTime(12000);
    expect(activeTitle()).toBe('Editor & LSP');
    fire(get('[data-next]'), 'click');
    expect(activeTitle()).toBe('Linux terminal');
    expect(animate).not.toHaveBeenCalled();
    motion.matches = false;
    fire(motion, 'change');
    fire(get('[data-playback]'), 'click');
    motion.matches = true;
    fire(motion, 'change');
    vi.advanceTimersByTime(12000);
    expect(activeTitle()).toBe('Linux terminal');
  });

  it('opens the selected full image, locks scrolling, and restores focus on close', () => {
    start();
    fire(triggers[0], 'click');
    expect(get('dialog').open).toBe(true);
    expect(scroller.style.overflow).toBe('hidden');
    expect(get('[data-viewer-image]').src).toBe('editor.jpg');
    fire(get('[data-viewer-next]'), 'click');
    expect(get('[data-viewer-source]').srcset).toBe('terminal.webp');
    vi.advanceTimersByTime(12000);
    expect(activeTitle()).toBe('Linux terminal');
    fire(get('[data-close]'), 'click');
    expect(get('dialog').open).toBe(false);
    expect(scroller.style.overflow).toBe('auto');
    expect(triggers[1].focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('preserves the full-size aspect ratio when moving between different screenshot formats', () => {
    const mixedShots = [shots[0], { ...shots[1], src: 'plugins.png', webp: 'plugins.webp', width: 1080, height: 2400 }];
    dispose = setupScreenshotCarousel(gallery, mixedShots);
    fire(triggers[0], 'click');
    const image = get('[data-viewer-image]');
    expect([image.width, image.height]).toEqual([720, 1387]);
    fire(get('[data-viewer-next]'), 'click');
    expect(image.src).toBe('plugins.png');
    expect([image.width, image.height]).toEqual([1080, 2400]);
    fire(get('[data-viewer-previous]'), 'click');
    expect([image.width, image.height]).toEqual([720, 1387]);
  });

  it('uses arrow keys without leaving focus on an inert slide', () => {
    start();
    page.activeElement = triggers[0];
    const event = fire(gallery, 'keydown', { key: 'ArrowRight' });
    expect(event.defaultPrevented).toBe(true);
    expect(activeTitle()).toBe('Linux terminal');
    expect(triggers[1].focus).toHaveBeenCalled();
    fire(gallery, 'keydown', { key: 'ArrowLeft', altKey: true });
    expect(activeTitle()).toBe('Linux terminal');
  });

  it('dismisses the viewer with Escape and restores scrolling', () => {
    start();
    fire(triggers[0], 'click');
    const event = fire(get('dialog'), 'keydown', { key: 'Escape' });
    expect(event.defaultPrevented).toBe(true);
    expect(get('dialog').open).toBe(false);
    expect(scroller.style.overflow).toBe('auto');
  });

  it('supports horizontal swipes without opening the viewer or hijacking vertical scrolling', () => {
    start();
    const viewport = get('.home-gallery__viewport');
    fire(viewport, 'pointerdown', { isPrimary: true, pointerType: 'touch', clientX: 150, clientY: 100 });
    fire(viewport, 'pointerup', { clientX: 80, clientY: 110 });
    expect(activeTitle()).toBe('Linux terminal');
    expect(fire(viewport, 'click').defaultPrevented).toBe(true);
    fire(viewport, 'pointerdown', { isPrimary: true, pointerType: 'touch', clientX: 150, clientY: 100 });
    fire(viewport, 'pointerup', { clientX: 100, clientY: 190 });
    expect(activeTitle()).toBe('Linux terminal');
    expect(fire(viewport, 'click').defaultPrevented).toBe(false);
  });

  it('releases timers, observers, listeners, and the scroll lock on route cleanup', () => {
    start();
    fire(triggers[0], 'click');
    dispose();
    expect(observer.disconnect).toHaveBeenCalled();
    expect(get('dialog').open).toBe(false);
    expect(scroller.style.overflow).toBe('auto');
    expect(vi.getTimerCount()).toBe(0);
    fire(get('[data-next]'), 'click');
    expect(activeTitle()).toBe('Editor & LSP');
    expect(triggers[0].focus).not.toHaveBeenCalled();
  });
});
