import CircularLoader from 'components/circularLoader';
import { attachListener } from './helpers';

/**
 * Pull to refresh
 * @param {HTMLElement} $el element to attach pull to refresh to
 * @param {Function} onRefresh callback function to call when refresh is triggered
 */
export default function PullToRefresh($el, onRefresh) {
  let started = false;
  let moveY = 0;
  let lastY;

  const FULL_ROTATION = 360;
  const THRESHOLD = 200;
  /** @type {HTMLElement} */
  const loader = <CircularLoader top='10' />;

  $el.addEventListener('touchstart', ontouchstart);

  function removeListeners() {
    document.removeEventListener('touchmove', ontouchmove);
    document.removeEventListener('touchend', ontouchend);
    document.removeEventListener('touchcancel', ontouchcancel);
  }

  function ontouchend() {
    removeListeners();
    if (moveY > THRESHOLD) {
      loader.rotation = null;
      loader.classList.add('animate');
      attachListener('hideloading', hideLoader);
      onRefresh();
      return;
    }

    hideLoader();
  }

  function ontouchcancel() {
    removeListeners();
    hideLoader();
  }

  /**
   * On touch move event
   * @param {TouchEvent} e touch event
   */
  function ontouchmove(e) {
    const { clientY } = e.touches[0];
    if (lastY === undefined) {
      lastY = clientY;
      return;
    }

    moveY += clientY - lastY;

    if (!started && moveY < 0) {
      ontouchcancel();
      return;
    }

    lastY = clientY;

    const ratio = Math.min(moveY / THRESHOLD, 1);
    loader.style.opacity = ratio;
    loader.style.transform = `scale(${ratio})`;
    loader.rotation = ratio * FULL_ROTATION;
    started = true;
  }

  /**
   * On touch start event
   * @param {TouchEvent} e touch event
   */
  function ontouchstart(e) {
    if (started) return;
    const { target } = e;
    let $next = target;

    if ($next.scrollTop !== 0) {
      return;
    }

    while ($next !== $el) {
      $next = $next.parentElement;
      if ($next.scrollTop !== 0) {
        return;
      }
    }

    document.addEventListener('touchmove', ontouchmove);
    document.addEventListener('touchend', ontouchend);
    document.addEventListener('touchcancel', removeListeners);
    $el.prepend(loader);
  }

  function hideLoader() {
    loader.classList.add('hide');
    setTimeout(() => {
      loader.remove();
      loader.style.removeProperty('opacity');
      loader.style.removeProperty('transform');
      loader.classList.remove('hide', 'animate');
      loader.rotation = 0;
      started = false;
      lastY = undefined;
      moveY = 0;
    }, 300);
  }
}
