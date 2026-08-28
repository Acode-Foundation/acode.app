import { hover, press, spring } from 'motion';
import { animate } from 'motion/mini';

const CONTRIBUTORS = '.home-contributors__faces a';
const CONTROLS = `.home-btn, .home-btn-text, .featured-plugins__list a, .see-all, .home-feature__link, .home-contributors__link, ${CONTRIBUTORS}`;
const RESTING_SHADOW = '0 0 0 rgba(0, 0, 0, 0)';

// Interaction feedback only: no page-load or scroll entrance animations.
export function setupHomeInteractions(page) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const bound = new WeakSet();
  const hovered = new WeakSet();
  const pressed = new WeakSet();
  const focused = new WeakSet();
  const animations = new Map();
  const listeners = new AbortController();
  const cleanups = [];
  let stopped = false;

  function clearStyles(element) {
    element.style.transform = '';
    if (element.matches(CONTRIBUTORS)) {
      element.style.boxShadow = '';
      element.style.zIndex = '';
    }
  }

  function update(element) {
    if (stopped) return;
    animations.get(element)?.stop();
    if (motion.matches) {
      clearStyles(element);
      return;
    }
    const contributor = element.matches(CONTRIBUTORS);
    const highlighted = hovered.has(element) || focused.has(element);
    const active = highlighted || pressed.has(element);
    let transform = 'translateY(0px) scale(1)';
    if (pressed.has(element)) transform = contributor ? 'translateY(0px) scale(0.96)' : 'translateY(0px) scale(0.98)';
    else if (highlighted) transform = contributor ? 'translateY(-4px) scale(1.14)' : 'translateY(-2px) scale(1)';
    const styles = { transform };
    if (contributor) {
      styles.boxShadow = highlighted ? '0 8px 18px rgba(0, 0, 0, 0.4)' : RESTING_SHADOW;
      if (active) element.style.zIndex = '2';
    }
    const animation = animate(element, styles, { type: spring, duration: contributor ? 0.42 : 0.35, bounce: contributor ? 0.08 : 0 });
    animations.set(element, animation);
    if (contributor && !active) {
      // Keep the returning avatar above its neighbors until it settles.
      animation.then(() => {
        if (!stopped && animations.get(element) === animation) element.style.zIndex = '';
      });
    }
  }

  function bind(container) {
    const controls = [...container.querySelectorAll(CONTROLS)].filter((element) => !bound.has(element));
    if (!controls.length) return;
    for (const element of controls) {
      bound.add(element);
      element.addEventListener(
        'focus',
        () => {
          if (!element.matches(':focus-visible')) return;
          focused.add(element);
          update(element);
        },
        { signal: listeners.signal },
      );
      element.addEventListener(
        'blur',
        () => {
          if (!focused.delete(element)) return;
          update(element);
        },
        { signal: listeners.signal },
      );
    }
    cleanups.push(
      hover(controls, (element) => {
        hovered.add(element);
        update(element);
        return () => {
          hovered.delete(element);
          update(element);
        };
      }),
      press(controls, (element) => {
        pressed.add(element);
        update(element);
        return () => {
          pressed.delete(element);
          update(element);
        };
      }),
    );
  }

  function reset() {
    for (const [element, animation] of animations) {
      animation.stop();
      clearStyles(element);
    }
    animations.clear();
  }

  const onMotionChange = () => {
    if (motion.matches) reset();
  };
  motion.addEventListener('change', onMotionChange);
  bind(page);

  // Contributors, plugins, and sponsors mount asynchronously. Binding never animates them in.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) bind(node);
      }
    }
  });
  observer.observe(page, { childList: true });

  return () => {
    stopped = true;
    observer.disconnect();
    listeners.abort();
    motion.removeEventListener('change', onMotionChange);
    for (const cleanup of cleanups) cleanup();
    reset();
  };
}
