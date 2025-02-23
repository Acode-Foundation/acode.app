import Ref from 'html-tag-js/ref';
import './styles.scss';

/**
 * @typedef {object} CircularLoaderProps
 * @property {number} rotation - rotation in degrees
 */

/**
 * Circular loader
 * @param {obj} param0
 * @param {string|number} param0.top
 * @returns {HTMLElement & CircularLoaderProps}
 */
export default function CircularLoader({ top }) {
  const $circle = Ref();
  const $el = (
    <div id='circular-loader' style={{ top }}>
      <div ref={$circle} className='circle' />
    </div>
  );

  Object.defineProperty($el, 'rotation', {
    set(value) {
      if (value === null) {
        $circle.style.removeProperty('transform');
        return;
      }
      $circle.style.transform = `rotate(${value}deg)`;
    },
    get() {
      const { transform } = $circle.style;
      return transform ? Number.parseInt(transform.match(/rotate\((\d+)deg\)/)[1], 10) : 0;
    },
  });

  return $el;
}
