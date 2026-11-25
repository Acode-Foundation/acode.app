import './style.scss';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import Input from 'components/input';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser, hideLoading, loadingEnd, loadingStart, showLoading, withRedirect } from 'lib/helpers';
import Router from 'lib/Router';
import {
  BANK_INDIA,
  BANK_OVERSEAS,
  OVERSEAS_COUNTRIES,
  PAYMENT_METHOD_ICONS,
  PAYMENT_METHOD_LABELS,
  PAYPAL,
  validatePaymentMethod,
} from '../../../shared/paymentMethods';

const SAVE_LABEL = 'Save payment method';
const CONFIRM_FIELD = 'bank_account_number_confirm';

const DESCRIPTIONS = {
  [BANK_INDIA]: 'Paid in INR to any bank in India',
  [BANK_OVERSEAS]: 'SWIFT transfer outside India',
  [PAYPAL]: 'Sent to your PayPal email',
};

// The last part of the URL preselects a method.
const MODES = {
  'bank-account': BANK_INDIA,
  'overseas-bank-account': BANK_OVERSEAS,
  paypal: PAYPAL,
};

export default async function AddPaymentMethod({ mode } = {}) {
  let user;
  let options;

  try {
    showLoading();
    user = await getLoggedInUser();
    if (user) options = await fetchOptions();
  } catch (error) {
    return (
      <section id='add-payment-method'>
        <p className='form-message form-message--error'>{error.message}</p>
      </section>
    );
  } finally {
    hideLoading();
  }

  if (!user) {
    Router.loadUrl(withRedirect('/login', window.location.pathname));
    return 'Redirecting...';
  }

  if (options.count >= options.limit) return <LimitReached limit={options.limit} />;

  const { types, country } = options;
  const isOverseas = OVERSEAS_COUNTRIES.includes(country);
  const initialType = [MODES[mode], isOverseas && BANK_OVERSEAS, types[0]].find((type) => types.includes(type));
  const form = Ref();
  const picker = Ref();
  const formError = Ref();
  const errorText = Reactive('');
  const buttonText = Reactive(SAVE_LABEL);
  const panels = Object.fromEntries(types.map((type) => [type, <FieldsPanel type={type} country={country} onedit={onEdit} />]));
  let currentType = initialType;
  // Show errors as the user types only after the first attempt to save.
  let attempted = false;

  const content = (
    <section id='add-payment-method'>
      <header className='page-head'>
        <h1>Add payment method</h1>
        <p>Choose how you want to receive your earnings. Payouts start once you have earned ₹{options.threshold.toLocaleString('en-IN')} or more.</p>
      </header>

      <AjaxForm
        ref={form}
        autofill={false}
        action='/api/user/payment-method'
        method='POST'
        onbeforesubmit={onBeforeSubmit}
        loading={onLoading}
        loadingEnd={onLoadingEnd}
        onloadend={onSaved}
        onerror={(error) => showFormError(error?.message || String(error))}
      >
        <fieldset ref={picker} className='method-picker'>
          <legend>Payment method</legend>
          {types.map((type) => (
            <label className='method-option'>
              <input type='radio' name='type' value={type} checked={type === initialType} onchange={() => selectType(type)} />
              <span className={`icon ${PAYMENT_METHOD_ICONS[type]}`} aria-hidden='true' />
              <span className='method-text'>
                <strong>{PAYMENT_METHOD_LABELS[type]}</strong>
                <span>{DESCRIPTIONS[type]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {Object.values(panels)}

        <label className='default-option'>
          <input type='checkbox' name='is_default' value='1' checked={!options.hasDefault} disabled={!options.hasDefault} />
          <span>
            <strong>Use as my default</strong>
            <span>{options.hasDefault ? 'Payouts will be sent here instead.' : 'Payouts will be sent here.'}</span>
          </span>
        </label>

        <p ref={formError} className='form-message form-message--error' role='alert' hidden>
          {errorText}
        </p>

        <div className='form-actions'>
          <button type='submit'>{buttonText}</button>
          <a className='cancel' href='/profile'>
            Cancel
          </a>
        </div>
      </AjaxForm>
    </section>
  );

  // Errors are shown next to each field instead of the browser's own popups.
  form.el.noValidate = true;
  selectType(initialType);
  return content;

  /**
   * @param {string} type
   */
  function selectType(type) {
    currentType = type;
    attempted = false;
    hideFormError();
    for (const [panelType, panel] of Object.entries(panels)) {
      const active = panelType === type;
      panel.hidden = !active;
      // Fields of a disabled fieldset are not submitted.
      panel.disabled = !active;
      showErrors(panel, {});
    }
  }

  function getErrors() {
    const details = Object.fromEntries(new FormData(form.el));
    const { errors, values } = validatePaymentMethod(currentType, details);
    const confirmation = details[CONFIRM_FIELD];
    if (confirmation !== undefined && !errors.bank_account_number) {
      if (confirmation.replace(/[\s-]/g, '').toUpperCase() !== values.bank_account_number) errors[CONFIRM_FIELD] = 'Account numbers do not match';
    }
    return errors;
  }

  function onEdit() {
    hideFormError();
    if (attempted) showErrors(panels[currentType], getErrors());
  }

  function onBeforeSubmit(formData) {
    hideFormError();
    attempted = true;
    const errors = getErrors();
    const panel = panels[currentType];
    showErrors(panel, errors);

    if (Object.keys(errors).length) {
      panel.querySelector('[aria-invalid="true"]')?.focus();
      return false;
    }

    formData.delete(CONFIRM_FIELD);
    return true;
  }

  function onLoading(thisForm) {
    // The result is about the submitted method, so it has to stay selected.
    picker.el.disabled = true;
    loadingStart(thisForm, errorText, null, buttonText);
  }

  function onLoadingEnd(thisForm) {
    picker.el.disabled = false;
    loadingEnd(thisForm, buttonText, SAVE_LABEL);
  }

  function onSaved() {
    alert('Payment method added', `${PAYMENT_METHOD_LABELS[currentType]} was added to your account.`, () => Router.loadUrl('/profile'), false, {
      icon: 'payment',
      variant: 'success',
    });
  }

  function showFormError(message) {
    errorText.value = message;
    formError.el.hidden = false;
  }

  function hideFormError() {
    errorText.value = '';
    formError.el.hidden = true;
  }
}

function LimitReached({ limit }) {
  return (
    <section id='add-payment-method'>
      <header className='page-head'>
        <h1>Add payment method</h1>
        <p>You already have {limit} payment methods, which is the maximum. Delete one from your profile to add another.</p>
      </header>
      <div className='form-actions'>
        <a className='cancel' href='/profile'>
          Go to profile
        </a>
      </div>
    </section>
  );
}

/**
 * Fields of one payment method type.
 * @param {object} props
 * @param {string} props.type
 * @param {string | null} props.country Where the user seems to be, as an ISO code
 * @param {() => void} props.onedit
 */
function FieldsPanel({ type, country, onedit }) {
  const id = (name) => `${type}-${name}`;
  const text = (name, label, props) => <Field id={id(name)} name={name} label={label} onedit={onedit} {...props} />;

  const holder = text('bank_account_holder', 'Account holder name', { placeholder: 'As it appears on your bank account', maxlength: 100 });
  const accountType = (
    <Field
      id={id('bank_account_type')}
      name='bank_account_type'
      label='Account type'
      choices={[
        ['Savings', 'Savings'],
        ['Current', type === BANK_OVERSEAS ? 'Current / Checking' : 'Current'],
      ]}
      onedit={onedit}
    />
  );

  let fields;
  let note;

  switch (type) {
    case BANK_INDIA:
      fields = [
        holder,
        text('bank_name', 'Bank name', { placeholder: 'e.g. ICICI Bank', maxlength: 100 }),
        text('bank_account_number', 'Account number', { placeholder: 'e.g. 98765432101', inputmode: 'numeric', maxlength: 26 }),
        text(CONFIRM_FIELD, 'Confirm account number', { placeholder: 'Enter it again', inputmode: 'numeric', maxlength: 26 }),
        text('bank_ifsc_code', 'IFSC code', {
          placeholder: 'e.g. ICIC0000282',
          hint: 'Printed on your cheque book and passbook',
          uppercase: true,
          maxlength: 14,
        }),
        accountType,
      ];
      break;

    case BANK_OVERSEAS:
      fields = [
        <Field
          id={id('bank_country')}
          name='bank_country'
          label='Bank country'
          placeholder='Select a country'
          choices={countries()}
          suggested={country}
          onedit={onedit}
        />,
        holder,
        text('bank_account_holder_address', 'Account holder address', {
          placeholder: 'Street, city, postal code, country',
          hint: 'Required by banks for international transfers',
          wide: true,
          maxlength: 250,
        }),
        text('bank_account_number', 'Account number or IBAN', { placeholder: 'e.g. DE89 3704 0044 0532 0130 00', uppercase: true, maxlength: 50 }),
        text(CONFIRM_FIELD, 'Confirm account number or IBAN', { placeholder: 'Enter it again', uppercase: true, maxlength: 50 }),
        text('bank_name', 'Bank name', { placeholder: 'e.g. Deutsche Bank', maxlength: 100 }),
        text('bank_swift_code', 'SWIFT / BIC code', { placeholder: 'e.g. DEUTDEFF', uppercase: true, maxlength: 14 }),
        text('bank_routing_code', 'Routing number', {
          placeholder: 'e.g. 021000021',
          hint: 'ABA, sort code, BSB or transit number, if your bank uses one',
          optional: true,
          maxlength: 24,
        }),
        text('bank_address', 'Bank branch address', { placeholder: 'Street, city, country', optional: true, maxlength: 250 }),
        accountType,
      ];
      note = 'Your bank or an intermediary bank may deduct fees and convert the amount to your currency.';
      break;

    case PAYPAL:
      fields = [
        text('paypal_email', 'PayPal email', {
          type: 'email',
          placeholder: 'you@example.com',
          hint: 'The email address of a PayPal account that can receive payments',
          wide: true,
          maxlength: 254,
        }),
      ];
      note = 'PayPal may deduct fees and convert the amount to your currency.';
      break;

    default:
      break;
  }

  return (
    <fieldset className='method-fields' data-type={type}>
      <legend>{PAYMENT_METHOD_LABELS[type]} details</legend>
      <div className='fields-grid'>{fields}</div>
      {note && (
        <p className='method-note'>
          <span className='icon info' aria-hidden='true' />
          <span>{note}</span>
        </p>
      )}
    </fieldset>
  );
}

/**
 * Acode input, or a select that looks like one, with a hint and an inline error.
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.name
 * @param {string} props.label
 * @param {string} [props.placeholder]
 * @param {string} [props.hint]
 * @param {boolean} [props.optional]
 * @param {boolean} [props.wide] Take the full width of the form
 * @param {boolean} [props.uppercase] Show the value in capital letters
 * @param {Array<[string, string]>} [props.choices] Render a select with these values
 * @param {string | null} [props.suggested] Choice to preselect, if it is one of them
 * @param {() => void} props.onedit
 */
function Field({ id, name, label, type = 'text', placeholder, hint, optional, wide, uppercase, inputmode, maxlength, choices, suggested, onedit }) {
  const controlRef = Ref();
  const isSuggested = Boolean(suggested && choices?.some(([value]) => value === suggested));
  if (isSuggested) hint = 'Selected from your location';
  const text = optional ? `${label} (optional)` : label;
  const field = choices ? (
    <div className='custom-input select'>
      <label>
        <select ref={controlRef} id={id} attr-name={name} onchange={onedit}>
          {placeholder && <option value=''>{placeholder}</option>}
          {choices.map(([value, choice]) => (
            <option value={value}>{choice}</option>
          ))}
        </select>
        <span className='label'>{text}</span>
      </label>
    </div>
  ) : (
    <Input
      inputRef={controlRef}
      id={id}
      name={name}
      type={type}
      label={text}
      placeholder={placeholder}
      inputmode={inputmode}
      maxlength={maxlength}
      autocomplete='off'
      oninput={onedit}
    />
  );

  const control = controlRef.el;
  control.setAttribute('aria-describedby', hint ? `${id}-hint ${id}-error` : `${id}-error`);
  control.setAttribute('aria-required', String(!optional));
  control.spellcheck = false;
  if (uppercase) control.classList.add('uppercase');
  if (isSuggested) control.value = suggested;

  const root = (
    <div className={`field${wide ? ' field--wide' : ''}`} data-field={name}>
      {field}
      {hint && (
        <span className='field-hint' id={`${id}-hint`}>
          {hint}
        </span>
      )}
      <span className='field-error' id={`${id}-error`} aria-live='polite' />
    </div>
  );

  // Once the user has chosen, the choice is theirs.
  if (isSuggested) control.addEventListener('change', () => root.querySelector('.field-hint')?.remove(), { once: true });
  return root;
}

/**
 * @param {HTMLElement} panel
 * @param {Record<string, string>} errors
 */
function showErrors(panel, errors) {
  for (const field of panel.querySelectorAll('[data-field]')) {
    const error = errors[field.dataset.field] || '';
    field.classList.toggle('field--invalid', Boolean(error));
    field.querySelector('input, select').setAttribute('aria-invalid', String(Boolean(error)));
    field.querySelector('.field-error').textContent = error;
  }
}

function countries() {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  return OVERSEAS_COUNTRIES.map((code) => [code, names.of(code)]).sort((a, b) => a[1].localeCompare(b[1]));
}

async function fetchOptions() {
  const res = await fetch('/api/user/payment-method-options', { cache: 'no-store' });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}
