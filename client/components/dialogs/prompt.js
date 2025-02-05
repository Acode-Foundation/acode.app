import autosize from 'autosize';
import DialogBox from './dialogBox';

/**
 *
 * @param {string} title
 * @param {object} [options]
 * @param {'text'|'number'|'tel'|'textarea'} [options.type]
 * @param {string} [options.defaultValue]
 * @param {string} [options.placeholder]
 * @param {boolean} [options.required]
 * @param {RegExp} [options.match]
 * @returns
 */
export default function prompt(title, options = {}) {
  const {
    type = 'text', defaultValue, placeholder = '', required, match,
  } = options;
  return new Promise((resolve) => {
    const $error = <div className='error'></div>;
    let $input;

    if (type === 'textarea') {
      $input = <textarea placeholder={placeholder} defaultValue={defaultValue} />;
      autosize($input);
    } else {
      $input = <input type={type} placeholder={placeholder} defaultValue={defaultValue} />;
    }

    $input.onchange = $error.remove.bind($error);

    const $box = <DialogBox
      title={title}
      body={<div>{$input}{$error}</div>}
      oncancel={(hide) => {
        resolve(null);
        hide();
      }}
      onok={(hide, this$Box) => {
        if (required && !$input.value) {
          $error.textContent = 'This field is required.';
          this$Box.get('.body').append($error);
          return;
        }
        if (match && !match.test($input.value)) {
          $error.textContent = 'Invalid input.';
          this$Box.get('.body').append($error);
          return;
        }
        resolve($input.value);
        hide();
      }} />;

    document.body.append($box);
  });
}
