import './style.scss';
import Router from 'lib/Router';

let nextDialogId = 0;

/**
 * @typedef {(hide: ()=>void, $box: HTMLElement) => void} DialogBoxCallback
 * @typedef {HTMLElement & {hide: () => void}} DialogBox
 */

/**
 *
 * @param {object} props
 * @param {HTMLElement} [props.body]
 * @param {string} [props.title]
 * @param {DialogBoxCallback} [props.onok]
 * @param {DialogBoxCallback} [props.oncancel]
 * @param {(i: number, hide: () => void) => void} [props.onselect]
 * @param {() => void} [props.onhide]
 * @param {string} [props.options]
 * @param {string} [props.message]
 * @param {string} [props.body]
 * @param {boolean} [props.keep]
 * @param {string} [props.icon]
 * @param {'success'} [props.variant]
 * @param {HTMLElement[]} [children]
 * @returns {DialogBox}
 */
export default function DialogBox({ title = '', onhide, onok, oncancel, onselect, options, message, body, keep = false, icon, variant }, children) {
  const titleId = `dialog-title-${++nextDialogId}`;
  const buttons = [];

  if (onok && typeof onok === 'function') {
    buttons.push(
      <button type='button' onclick={() => onok(hide, $box)}>
        {variant === 'success' ? 'Done' : 'OK'}
      </button>,
    );
  }

  if (oncancel && typeof oncancel === 'function') {
    buttons.push(
      <button type='button' onclick={() => oncancel(hide, $box)}>
        Cancel
      </button>,
    );
  }

  if (message || children.length) {
    body = <p>{message || children}</p>;
  }

  if (options && Array.isArray(options)) {
    body = (
      <ul className='options'>
        {options.map((option, index) => (
          <li onclick={() => onselect(index, hide)}>{option}</li>
        ))}
      </ul>
    );
  }

  const $box = (
    <div className='dialog-box-container'>
      <div onclick={hide} className='dialog-box-overlay' />
      <div className={`dialog-box${variant ? ` dialog-box--${variant}` : ''}`} role='dialog' aria-labelledby={titleId}>
        {icon && (
          <div className='dialog-icon' aria-hidden='true'>
            <span className={`icon ${icon}`} />
            {variant === 'success' && <span className='icon check_circle dialog-status' />}
          </div>
        )}
        <h2 id={titleId} className='title'>
          {title}
        </h2>
        <div className='body'>{body}</div>
        <div className='buttons'>{buttons}</div>
      </div>
    </div>
  );

  if (!keep) {
    Router.on('navigate', hide);
  }

  function hide(callOnhide = true) {
    if (typeof onhide === 'function' && callOnhide) {
      onhide();
    }
    $box.classList.add('hide');
    setTimeout(() => {
      $box.remove();
      $box.classList.remove('hide');
    }, 300);
  }

  $box.hide = hide;

  return $box;
}
