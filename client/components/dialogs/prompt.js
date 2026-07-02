import autosize from 'autosize';
import DialogBox from './dialogBox';

/**
 *
 * @param {string} title
 * @param {object} [options]
 * @param {'text'|'number'|'tel'|'password'|'textarea'} [options.type]
 * @param {string} [options.defaultValue]
 * @param {string} [options.placeholder]
 * @param {boolean} [options.required]
 * @param {RegExp} [options.match]
 * @returns
 */
export default function prompt(title, options = {}) {
  const { type = 'text', defaultValue, placeholder = '', required, match } = options;
  return new Promise((resolve) => {
    const $error = <div className='error' />;
    let $input;
    let body;

    if (type === 'textarea') {
      $input = <textarea placeholder={placeholder} defaultValue={defaultValue} />;
      autosize($input);
      body = (
        <div className='prompt-body'>
          {$input}
          {$error}
        </div>
      );
    } else {
      const label = placeholder || title;
      $input = <input type={type} placeholder={label} defaultValue={defaultValue} autocomplete={type === 'password' ? 'current-password' : 'off'} />;
      body = (
        <div className='prompt-body'>
          <div className={`prompt-input ${type}`}>
            <label>
              {$input}
              <span className='label'>{label}</span>
            </label>
          </div>
          {$error}
        </div>
      );
    }

    $input.onchange = $error.remove.bind($error);

    const $box = (
      <DialogBox
        title={title}
        body={body}
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
        }}
      />
    );

    document.body.append($box);
  });
}
