import './style.scss';
import alert from 'components/dialogs/alert';
import { hideLoading, showLoading } from 'lib/helpers';
import Router from 'lib/Router';

let userCurrency = null;
let currencySymbol = null;

export default async function CurrencySelector({ className }, children) {
  const config = await getCurrencyConfig();
  if (!config) return null;

  const { code } = config;

  let currencies = [];
  try {
    const res = await fetch('/api/razorpay/currencies');
    currencies = await res.json();
  } catch (err) {
    console.error('Failed to fetch currencies list:', err);
  }

  if (!currencies.length) {
    return (
      <div className={`currency-selector${className ? ` ${className}` : ''}`}>
        <button type='button' className='currency-toggle' disabled>
          {children}
        </button>
      </div>
    );
  }

  const mask = <div className='currency-selector-mask' onclick={hide} />;
  const dorpDown = (
    <div className='currency-dropdown'>
      {currencies.map((currency) => (
        <div
          className={`currency-option ${code === currency.code ? 'active' : ''}`}
          data-code={currency.code}
          data-name={currency.name}
          onclick={async () => {
            showLoading();
            try {
              await getCurrencyConfig(currency.code);
              Router.reload();
            } catch (error) {
              console.error(error);
              alert('ERROR', 'Something went wrong while processing your request, please try again later.');
            } finally {
              hideLoading();
            }
          }}
        >
          <span className='currency-symbol'>{currency.symbol}</span>
          <span className='currency-code'>{currency.code}</span>
          <span className='currency-name'>{currency.name}</span>
        </div>
      ))}
    </div>
  );

  return (
    <span is='button' className={`currency-selector${className ? ` ${className}` : ''}`} title={code} onclick={show}>
      {children}
      <span className='icon keyboard_arrow_down' />
    </span>
  );

  /**
   * @param {MouseEvent} e
   */
  function show(e) {
    /** @type {HTMLElement} */
    let target = e.target;

    if (target.className !== 'currency-selector') {
      target = target.closest('.currency-selector');
    }

    const targetRect = target.getBoundingClientRect();

    dorpDown.style.removeProperty('height');
    dorpDown.style.removeProperty('width');
    dorpDown.style.removeProperty('bottom');
    dorpDown.style.removeProperty('left');
    dorpDown.style.top = `${targetRect.bottom}px`;
    dorpDown.style.right = `${window.innerWidth - targetRect.right}px`;

    app.append(mask, dorpDown);
    Router.on('navigate', hide);

    requestAnimationFrame(() => {
      const MAX_RIGHT = window.innerWidth - 10;
      const MAX_BOTTOM = window.innerHeight - 10;
      let { height, width, left, right, top, bottom } = dorpDown.getBoundingClientRect();

      if (width > window.innerWidth - 20) {
        width = window.innerWidth - 20;
        dorpDown.style.width = width;
      }

      if (height > window.innerHeight - 20) {
        height = window.innerHeight - 20;
        dorpDown.style.height = height;
      }

      if (left < 10) {
        left = 10;
        dorpDown.style.left = left;
      }

      if (right > MAX_RIGHT) {
        right = MAX_RIGHT;
        dorpDown.style.right = 10;
      }

      if (top < 10) {
        top = 10;
        dorpDown.style.top = top;
      }

      if (bottom > MAX_BOTTOM) {
        bottom = MAX_BOTTOM;
        dorpDown.style.bottom = 10;
        dorpDown.style.top = window.innerHeight - height;
      }

      dorpDown.classList.add('show');
    });
  }

  function hide() {
    Router.off('navigate', hide);
    mask.remove();
    dorpDown.classList.remove('show');
    dorpDown.classList.add('hide');
    setTimeout(() => {
      dorpDown.remove();
    }, 150);
  }
}

async function getCurrencyConfig(preferredCurrency) {
  if (userCurrency && userCurrency === preferredCurrency) {
    return {
      code: userCurrency,
      symbol: currencySymbol,
    };
  }

  try {
    const url = `/api/razorpay/currency-config?preferred=${preferredCurrency ?? ''}`;
    const res = await fetch(url);
    const config = await res.json();
    if (config.error) throw new Error(config.error);

    userCurrency = config.code;
    currencySymbol = config.symbol;

    return config;
  } catch (err) {
    console.error('Failed to fetch currency config:', err);
    return null;
  }
}
