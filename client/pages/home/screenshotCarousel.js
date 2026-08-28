import { spring } from 'motion';
import { animate } from 'motion/mini';

const SLIDE_INTERVAL = 6000;
const SLIDE_SPRING = { type: spring, duration: 0.65, bounce: 0 };
const SOFT_EASE = [0.22, 1, 0.36, 1];

export function setupScreenshotCarousel(gallery, shots, { autoplay = true } = {}) {
  const find = (selector) => gallery.querySelector(selector);
  const slides = [...gallery.querySelectorAll('.home-gallery__slide')];
  const dots = [...gallery.querySelectorAll('[data-slide]')];
  const track = find('.home-gallery__track');
  const viewport = find('.home-gallery__viewport');
  const title = find('[data-title]');
  const caption = find('[data-caption]');
  const captionBlock = find('.home-gallery__caption');
  const announcement = find('[data-announcement]');
  const playback = find('[data-playback]');
  const pauseIcon = find('[data-pause-icon]');
  const playIcon = find('[data-play-icon]');
  const viewer = find('dialog');
  const viewerStage = find('.home-gallery__viewer-stage');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new AbortController();
  const animations = new Map();
  let index = 0;
  let timer;
  let visible = false;
  let hovered = false;
  let focused = false;
  let paused = !autoplay || motion.matches;
  let disposed = false;
  let returnFocus;
  let scrollContainer;
  let previousOverflow;
  let closing = false;

  const listen = (target, event, callback, options = {}) => {
    target.addEventListener(event, callback, { ...options, signal: listeners.signal });
  };

  function transition(element, keyframes, options) {
    // Retarget from the current visual position instead of queuing animations on rapid input.
    animations.get(element)?.stop();
    if (motion.matches || disposed) {
      for (const [property, value] of Object.entries(keyframes)) {
        element.style[property] = Array.isArray(value) ? value.at(-1) : value;
      }
      return null;
    }
    const animation = animate(element, keyframes, options);
    animations.set(element, animation);
    return animation;
  }

  function schedule() {
    clearTimeout(timer);
    playback.setAttribute('aria-label', paused ? 'Play slideshow' : 'Pause slideshow');
    pauseIcon.hidden = paused;
    playIcon.hidden = !paused;
    if (!autoplay || disposed || paused || hovered || focused || !visible || document.hidden || viewer.open) return;
    timer = setTimeout(() => {
      show(index + 1);
      schedule();
    }, SLIDE_INTERVAL);
  }

  function show(next, manual = false) {
    const previousIndex = index;
    index = (next + shots.length) % shots.length;
    const changed = index !== previousIndex;
    const transform = `translateX(-${index * 100}%)`;
    if (changed) transition(track, { transform }, SLIDE_SPRING);
    else track.style.transform = transform;
    for (const [position, slide] of slides.entries()) {
      slide.inert = position !== index;
      slide.setAttribute('aria-hidden', String(position !== index));
      dots[position].setAttribute('aria-current', String(position === index));
    }
    title.textContent = shots[index].title;
    caption.textContent = shots[index].caption;
    if (changed) {
      transition(captionBlock, { opacity: [0, 1], transform: ['translateY(6px)', 'translateY(0px)'] }, { duration: 0.35, ease: SOFT_EASE });
    }
    if (viewer.open) {
      updateViewer();
      if (changed) {
        const direction = next > previousIndex ? 1 : -1;
        transition(
          find('[data-viewer-image]'),
          {
            opacity: [0.4, 1],
            transform: [`translateX(${direction * 14}px) scale(0.99)`, 'translateX(0px) scale(1)'],
          },
          { duration: 0.4, ease: SOFT_EASE },
        );
      }
    }
    if (manual) {
      // Keep the selected screenshot in place until the visitor explicitly presses play.
      paused = true;
      announcement.textContent = `${index + 1} of ${shots.length}: ${shots[index].title}`;
      schedule();
    }
  }

  function updateViewer() {
    const shot = shots[index];
    find('[data-viewer-source]').srcset = shot.webp;
    const image = find('[data-viewer-image]');
    image.src = shot.src;
    image.alt = shot.alt;
    image.width = shot.width;
    image.height = shot.height;
    find('[data-viewer-title]').textContent = shot.title;
    find('[data-viewer-count]').textContent = `${index + 1} / ${shots.length}`;
    find('[data-viewer-caption]').textContent = shot.caption;
  }

  function openViewer(position, trigger) {
    if (viewer.open) return;
    show(position, true);
    returnFocus = trigger;
    updateViewer();
    scrollContainer = gallery.closest('#app') || document.documentElement;
    previousOverflow = scrollContainer.style.overflow;
    scrollContainer.style.overflow = 'hidden';
    viewer.showModal();
    transition(viewer, { opacity: [0, 1] }, { duration: 0.22, ease: 'easeOut' });
    transition(viewerStage, { transform: ['translateY(18px) scale(0.96)', 'translateY(0px) scale(1)'] }, SLIDE_SPRING);
    schedule();
  }

  function closeViewer() {
    if (!viewer.open || closing) return;
    closing = true;
    transition(viewerStage, { transform: 'translateY(8px) scale(0.98)' }, { duration: 0.18, ease: SOFT_EASE });
    const exit = transition(viewer, { opacity: 0 }, { duration: 0.18, ease: 'easeOut' });
    if (!exit) viewer.close();
    else
      exit.then(() => {
        if (!disposed && viewer.open) viewer.close();
      });
  }

  function restoreViewer() {
    closing = false;
    if (scrollContainer) {
      scrollContainer.style.overflow = previousOverflow;
      scrollContainer = null;
    }
    if (!disposed && returnFocus?.isConnected) {
      // The original slide can be inert after navigating inside the viewer.
      slides[index].querySelector('button').focus({ preventScroll: true });
    }
    returnFocus = null;
    schedule();
  }

  listen(find('[data-previous]'), 'click', () => show(index - 1, true));
  listen(find('[data-next]'), 'click', () => show(index + 1, true));
  for (const [position, dot] of dots.entries()) {
    listen(dot, 'click', () => show(position, true));
  }
  for (const button of gallery.querySelectorAll('[data-expand]')) {
    listen(button, 'click', () => openViewer(Number(button.dataset.expand), button));
  }
  listen(playback, 'click', () => {
    paused = !paused;
    if (!paused) {
      hovered = false;
      focused = false;
    }
    schedule();
  });
  listen(gallery, 'pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    hovered = true;
    schedule();
  });
  listen(gallery, 'pointerleave', () => {
    hovered = false;
    schedule();
  });
  listen(gallery, 'focusin', () => {
    focused = true;
    schedule();
  });
  listen(gallery, 'focusout', (event) => {
    focused = gallery.contains(event.relatedTarget);
    schedule();
  });
  listen(gallery, 'keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const focusedSlide = slides.some((slide) => slide.contains(document.activeElement));
    show(index + (event.key === 'ArrowRight' ? 1 : -1), true);
    if (focusedSlide) slides[index].querySelector('button').focus({ preventScroll: true });
  });

  function enableSwipe(surface) {
    let start;
    let swiped = false;
    listen(surface, 'pointerdown', (event) => {
      if (!event.isPrimary || event.pointerType === 'mouse') return;
      start = { x: event.clientX, y: event.clientY };
      swiped = false;
    });
    listen(surface, 'pointerup', (event) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      swiped = true;
      show(index + (dx < 0 ? 1 : -1), true);
    });
    listen(surface, 'pointercancel', () => {
      start = null;
    });
    listen(
      surface,
      'click',
      (event) => {
        if (!swiped) return;
        event.preventDefault();
        event.stopPropagation();
        swiped = false;
      },
      { capture: true },
    );
  }

  enableSwipe(viewport);
  enableSwipe(viewerStage);
  listen(find('[data-viewer-previous]'), 'click', () => show(index - 1, true));
  listen(find('[data-viewer-next]'), 'click', () => show(index + 1, true));
  listen(find('[data-close]'), 'click', closeViewer);
  listen(viewer, 'keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeViewer();
  });
  listen(viewer, 'cancel', (event) => {
    event.preventDefault();
    closeViewer();
  });
  listen(viewer, 'close', restoreViewer);
  listen(viewer, 'click', (event) => {
    if (event.target === viewer || event.target === viewerStage) closeViewer();
  });
  listen(document, 'visibilitychange', schedule);
  listen(motion, 'change', () => {
    if (motion.matches) {
      paused = true;
      for (const animation of animations.values()) animation.complete();
    }
    schedule();
  });

  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      schedule();
    },
    { threshold: [0, 0.5] },
  );
  observer.observe(viewport);
  show(0);
  schedule();

  return () => {
    disposed = true;
    clearTimeout(timer);
    observer.disconnect();
    listeners.abort();
    for (const animation of animations.values()) animation.stop();
    animations.clear();
    if (viewer.open) viewer.close();
    restoreViewer();
  };
}
