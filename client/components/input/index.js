import './style.scss';
import Reactive from 'html-tag-js/reactive';

/**
 * @typedef {
 * 'text'|
 * 'textarea'|
 * 'password'|
 * 'email'|
 * 'url'|
 * 'tel'|
 * 'date'|
 * 'color'|
 * 'checkbox'|
 * 'radio'|
 * 'file'|
 * 'image'|
 * 'range'|
 * 'reset'|
 * 'search'|
 * 'time'|
 * 'week'|
 * 'datetime-local'|
 * 'button'
 * } InputTypes
 */

/**
 *
 * @param {Object} param0
 * @param {number} param0.maxlength
 * @param {Ref} param0.ref
 * @param {boolean} param0.autofill
 * @param {Function} param0.onkeydown
 * @param {Function} param0.oninput
 * @param {boolean} param0.checked
 * @param {boolean} param0.required
 * @param {Function} param0.onchange
 * @param {string|number} param0.value
 * @param {string} param0.placeholder
 * @param {string} param0.label
 * @param {string} param0.name
 * @param {string} param0.id
 * @param {InputTypes} param0.type
 */
export default function Input({
  maxlength,
  ref,
  autofill = true,
  onkeydown,
  oninput,
  checked,
  required,
  onchange,
  value,
  placeholder,
  label,
  name,
  id,
  type = 'text',
  style,
}) {
  label = label || placeholder || name || id || type;

  const cross = <span onclick={oncancel} className='icon clear' />;
  const labelText = Reactive(label);
  const labelContainer = <span className='label'>{labelText}</span>;
  /** @type {HTMLInputElement | HTMLTextAreaElement} */
  const inputField = type === 'textarea' ? <textarea /> : <input checked={checked} type={type} />;
  const input = (
    <div className={`custom-input ${type}`} style={style}>
      <label
        className={checked ? 'checked' : undefined}
        onfocus={() => {
          inputField.disabled = false;
          inputField.focus();
        }}
      >
        {inputField}
        {labelContainer}
      </label>
    </div>
  );

  if (ref) ref.el = inputField;
  if (id) inputField.id = id;
  if (name) inputField.name = name;
  if (value) inputField.value = value;
  if (required) inputField.required = true;
  if (oninput) inputField.oninput = oninput;
  if (onchange) inputField.onchange = onchange;
  if (onkeydown) inputField.onkeydown = onkeydown;
  if (maxlength) inputField.maxLength = maxlength;
  if (placeholder) inputField.placeholder = placeholder;

  if (!autofill) {
    inputField.disabled = true;
  }

  if (type === 'file') {
    inputField.addEventListener('change', () => {
      const [file] = inputField.files;
      const sizeInMB = (file.size / 1024 / 1024).toFixed(2);
      labelText.value = `${file.name} (${sizeInMB} MB)`;
      labelContainer.appendChild(cross);
    });

    input.addEventListener('dragover', (e) => {
      e.stopPropagation();
      e.preventDefault();
      e.dataTransfer.dropEffect = 'Drop here';
      input.classList.add('drop-effect');
    });

    input.addEventListener('dragleave', (e) => {
      e.stopPropagation();
      e.preventDefault();
      input.classList.remove('drop-effect');
    });

    input.addEventListener('drop', (e) => {
      e.stopPropagation();
      e.preventDefault();

      inputField.disabled = false;
      const [file] = e.dataTransfer.files;
      const sizeInMB = (file.size / 1024 / 1024).toFixed(2);
      labelText.value = `${file.name} (${sizeInMB} MB)`;
      labelContainer.appendChild(cross);
      inputField.files = e.dataTransfer.files;
      onchange.call(inputField);
    });
  }

  if (['radio', 'checkbox'].includes(type)) {
    inputField.addEventListener('change', (e) => {
      const { target } = e;
      document.body.getAll(`input[name="${target.name}"]`).forEach(($el) => {
        $el.parentElement.classList.remove('checked');
      });
      target.parentElement.classList.add('checked');
    });
  }

  Object.defineProperties(input, {
    value: {
      get() {
        return inputField.value;
      },
      set(arg) {
        inputField.value = arg;
      },
    },
    placeholder: {
      get() {
        return inputField.placeholder;
      },
      set(arg) {
        inputField.placeholder = arg;
      },
    },
    label: {
      get() {
        return input.get('.label').textContent;
      },
      set(arg) {
        input.get('.label').textContent = arg;
      },
    },
    name: {
      get() {
        return inputField.name;
      },
      set(arg) {
        inputField.name = arg;
      },
    },
    id: {
      get() {
        return inputField.id;
      },
      set(arg) {
        inputField.id = arg;
      },
    },
    className: {
      get() {
        return inputField.className;
      },
      set(arg) {
        inputField.className = arg;
      },
    },
    type: {
      get() {
        return inputField.type;
      },
      set(arg) {
        inputField.type = arg;
      },
    },
  });

  return input;

  function oncancel(e) {
    e.stopPropagation();
    e.preventDefault();
    inputField.files = (<input type='file' />).files;
    labelText.value = label;
    this.remove();
    onchange.call(inputField);
  }
}
