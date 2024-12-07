import Router from 'lib/Router';
import './style.scss';

/**
 * @typedef {(hide: ()=>void, $box: HTMLElement) => void} DialogBoxCallback
 */

/**
 *
 * @param {object} param0
 * @param {HTMLElement} [param0.body]
 * @param {string} [param0.title]
 * @param {DialogBoxCallback} [param0.onok]
 * @param {DialogBoxCallback} [param0.oncancel]
 * @param {(i: number, hide: () => void) => void} [param0.onselect]
 * @param {() => void} [param0.onhide]
 * @param {string} [param0.options]
 * @param {string} [param0.message]
 * @param {string} [param0.body]
 * @param {HTMLElement[]} [children]
 * @returns
 */
export default function DialogBox({
  title = '', onhide, onok, oncancel, onselect, options, message, body,
}, children) {
  const buttons = [];
  let $box;

  if (onok && typeof onok === 'function') {
    buttons.push(<button onclick={() => onok(hide, $box)}>OK</button>);
  }

  if (oncancel && typeof oncancel === 'function') {
    buttons.push(<button onclick={() => oncancel(hide, $box)}>Cancel</button>);
  }

  if (message || children.length) {
    body = <p>{message || children}</p>;
  }

  if (options && Array.isArray(options)) {
    body = <ul className='options'>
      {options.map((option, index) => <li onclick={() => onselect(index, hide)}>{option}</li>)}
    </ul>;
  }

  $box = <div className="dialog-box-container">
    <div onclick={hide} className="dialog-box-overlay"></div>
    <div className="dialog-box">
      <h2 className='title'>{title}</h2>
      <div className="body">{body}</div>
      <div className="buttons">{buttons}</div>
    </div>
  </div>;

  Router.on('navigate', hide);

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

  return $box;
}
