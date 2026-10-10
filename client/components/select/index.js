import './style.scss';

/**
 * Custom select component
 * @param {object} props
 * @param {Array<{label: string, value: any}>} props.options
 * @param {any} props.value
 * @param {Function} [props.onChange]
 * @param {object} [props.ref]
 * @param {string} [props.title]
 * @param {string} [props.className]
 * @param {object} [props.style]
 */
export default function Select({ options, value, onChange, ref, title, name, className = '', style = {} }) {
  let currentValue = value !== undefined ? value : options[0]?.value;
  let hiddenInput = null;

  const currentLabel = () => options.find((o) => String(o.value) === String(currentValue))?.label || '';
  const labelEl = <span>{currentLabel()}</span>;
  
  let isOpen = false;

  const closeDropdown = () => {
    isOpen = false;
    container.classList.remove('open');
    document.removeEventListener('click', closeDropdown);
  };

  const toggleOpen = (e) => {
    e.stopPropagation();
    if (isOpen) {
      closeDropdown();
      return;
    }
    isOpen = true;
    container.classList.add('open');
    
    // Highlight the selected option and scroll it into view if needed
    listEl.querySelectorAll('.select-option').forEach((el, i) => {
      if (String(options[i].value) === String(currentValue)) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });

    document.addEventListener('click', closeDropdown);
  };

  const selectOption = (opt, e) => {
    e.stopPropagation();
    currentValue = opt.value;
    if (hiddenInput) hiddenInput.value = opt.value;
    labelEl.textContent = opt.label;
    closeDropdown();
    if (onChange) onChange({ target: container });
  };

  const listEl = (
    <div className='select-dropdown'>
      {options.map((opt) => (
        <div className='select-option' onclick={(e) => selectOption(opt, e)}>
          {opt.label}
        </div>
      ))}
    </div>
  );

  if (name) {
    hiddenInput = <input type='hidden' name={name} value={currentValue} />;
  }

  const prefixEl = title ? <span className='select-prefix'>{title}</span> : null;

  const container = (
    <div className={`custom-select-container ${className}`} style={style} onclick={toggleOpen}>
      {hiddenInput}
      <div className='select-value'>
        <div className='select-value-text'>
          {prefixEl}
          {labelEl}
        </div>
        <span className='icon expand_more' />
      </div>
      {listEl}
    </div>
  );

  Object.defineProperty(container, 'value', {
    get: () => currentValue,
    set: (v) => {
      currentValue = v;
      if (hiddenInput) hiddenInput.value = v;
      labelEl.textContent = currentLabel();
    },
  });

  if (ref) ref.el = container;

  return container;
}
