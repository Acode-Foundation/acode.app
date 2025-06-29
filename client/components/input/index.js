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
 * @param {Object} props
 * @param {Ref} props.ref
 * @param {number} props.maxlength
 * @param {string} props.autocomplete
 * @param {boolean} props.autofill
 * @param {Function} props.onkeydown
 * @param {Function} props.oninput
 * @param {boolean} props.checked
 * @param {boolean} props.required
 * @param {Function} props.onchange
 * @param {string|number} props.value
 * @param {string} props.placeholder
 * @param {string} props.label
 * @param {string} props.name
 * @param {string} props.id
 * @param {InputTypes} props.type
 */
export default function Input({
  maxlength,
  ref,
  autocomplete = 'on',
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

  inputField.autocomplete = autocomplete;

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
      for (const $el of tag.getAll(`input[name="${target.name}"]`)) {
        $el.parentElement.classList.remove('checked');
      }
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
