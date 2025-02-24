import AjaxForm from 'components/ajaxForm';
import Input from 'components/input';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { loadingEnd, loadingStart } from 'lib/helpers';

export default async function AddPaymentMethod({ mode }) {
  const form = Ref();
  const errorText = Reactive('');
  const successText = Reactive('');
  const buttonText = Reactive('Save');
  let title = 'Add New Bank Account';

  if (mode === 'paypal') {
    title = 'Add New Paypal Account';
    form.append(
      <div>
        <Input type='email' name='paypal_email' placeholder='e.g. johndoe@gmail.com' label='Paypal Email' />
        <span className='error'>{errorText}</span>
        <span className='success'>{successText}</span>
        <div className='buttons-container'>
          <button type='submit'>Save</button>
        </div>
      </div>,
    );
  } else if (mode === 'bank-account') {
    form.append(
      <div>
        <Input type='text' name='bank_account_holder' placeholder='e.g. John Doe' label='* Account holder' required={true} />
        <Input type='text' name='bank_account_number' placeholder='e.g. 98765643210' label='* Account Number' required={true} />
        <Input type='text' name='bank_name' placeholder='e.g. ICICI Bank' label='* Bank Name' required={true} />
        <Input type='text' name='bank_ifsc_code' placeholder='e.g. ICIC0000282' label='* Bank IFSC Code' required={true} />
        <Input type='text' name='bank_swift_code' placeholder='e.g. ICICINBBNRI' label='Bank Swift Code' />

        <fieldset>
          <legend>Account type</legend>
          <Input type='radio' name='bank_account_type' value='savings' label='Savings' checked={true} />
          <Input type='radio' name='bank_account_type' value='current' label='Current' />
        </fieldset>

        <span className='error'>{errorText}</span>
        <span className='success'>{successText}</span>

        <div style={{ marginTop: '20px' }}>
          <sup>*</sup> are required.
        </div>
        <div className='buttons-container'>
          <button type='submit'>{buttonText}</button>
          <button type='reset' className='danger'>
            Reset
          </button>
        </div>
      </div>,
    );
  } else if (mode === 'crypto') {
    title = 'Add New Wallet';
    form.append(
      <div>
        <Input required={true} type='text' name='wallet_address' placeholder='e.g. 0x1234567890abcdef' label='Wallet Address' />
        <Input required={true} type='text' name='wallet_type' placeholder='e.g. Ethereum' label='Wallet Type' />
        <span className='error'>{errorText}</span>
        <span className='success'>{successText}</span>
        <div className='buttons-container'>
          <button type='submit'>{buttonText}</button>
        </div>
      </div>,
    );
  }

  return (
    <section id='add-payment-method'>
      <h1>{title}</h1>
      <AjaxForm
        ref={form}
        action='/api/user/payment-method'
        method='POST'
        loading={(thisForm) => loadingStart(thisForm, errorText, successText, buttonText)}
        loadingEnd={(thisForm) => loadingEnd(thisForm, buttonText, 'Save')}
        onloadend={(res) => {
          if (res.error) errorText.value = res.error;
          else successText.value = 'Payment method added successfully.';
        }}
        onerror={(error) => {
          errorText.value = error;
        }}
      />
    </section>
  );
}
