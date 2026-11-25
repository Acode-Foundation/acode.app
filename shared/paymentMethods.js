// Payment method types, their fields and validation. Shared so that the form and the API always agree.
const BANK_INDIA = 'bank_india';
const BANK_OVERSEAS = 'bank_overseas';
const PAYPAL = 'paypal';
// Legacy rows only, cryptocurrency can no longer be added.
const WALLET = 'wallet';

/** Types a developer can add, in display order. */
const PAYMENT_METHOD_TYPES = [BANK_INDIA, BANK_OVERSEAS, PAYPAL];
const PAYMENT_METHOD_LIMIT = 3;

const PAYMENT_METHOD_LABELS = {
  [BANK_INDIA]: 'Indian bank account',
  [BANK_OVERSEAS]: 'Overseas bank account',
  [PAYPAL]: 'PayPal',
  [WALLET]: 'Crypto wallet',
};

const PAYMENT_METHOD_ICONS = {
  [BANK_INDIA]: 'account_balance',
  [BANK_OVERSEAS]: 'earth',
  [PAYPAL]: 'paypal',
  [WALLET]: 'bitcoin',
};

const ACCOUNT_TYPES = ['Savings', 'Current'];

/** ISO 3166-1 alpha-2 codes of every country except India, which has its own bank type. */
const OVERSEAS_COUNTRIES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM ' +
  'CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK ' +
  'HM HN HR HT HU ID IE IL IM IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ' +
  'ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI ' +
  'VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

/**
 * Type of a stored payment method. Rows saved before types existed are inferred from their details.
 * @param {object} row
 * @returns {string}
 */
function getPaymentMethodType(row) {
  if (row.type) return row.type;
  if (row.paypal_email) return PAYPAL;
  if (row.wallet_address) return WALLET;
  return BANK_INDIA;
}

/**
 * Whether payouts can currently be sent to this type.
 * @param {string} type
 * @param {{paypalEnabled: boolean}} settings
 */
function isPaymentMethodTypeAvailable(type, { paypalEnabled }) {
  if (type === PAYPAL) return Boolean(paypalEnabled);
  return PAYMENT_METHOD_TYPES.includes(type);
}

function text(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function code(value) {
  return text(value).replace(/[\s-]/g, '').toUpperCase();
}

function requiredText(label, min = 2, max = 100) {
  return {
    clean: text,
    check(value) {
      if (!value) return `${label} is required`;
      if (value.length < min || value.length > max) return `${label} must be ${min} to ${max} characters long`;
      return '';
    },
  };
}

function optionalText(label, max) {
  return { clean: text, check: (value) => (value.length > max ? `${label} must be at most ${max} characters long` : '') };
}

const email = {
  clean: (value) => text(value).toLowerCase(),
  check(value) {
    if (!value) return 'Email address is required';
    return value.length <= 254 && /^[^\s@<>"]+@[^\s@<>".]+(?:\.[^\s@<>".]+)+$/.test(value) ? '' : 'Enter a valid email address';
  },
};

const indianAccountNumber = {
  clean: code,
  check(value) {
    if (!value) return 'Account number is required';
    return /^\d{9,18}$/.test(value) ? '' : 'Account number must be 9 to 18 digits';
  },
};

const overseasAccountNumber = {
  clean: code,
  check(value, values) {
    if (!value) return 'Account number or IBAN is required';
    if (!/^[A-Z0-9]{5,34}$/.test(value)) return 'Enter a valid account number or IBAN';
    const isIban = /^[A-Z]{2}\d{2}/.test(value) && value.startsWith(values.bank_country);
    return isIban && !isValidIban(value) ? 'This IBAN is not valid, check it for typing mistakes' : '';
  },
};

const ifsc = {
  clean: code,
  check(value) {
    if (!value) return 'IFSC code is required';
    return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value) ? '' : 'Enter a valid 11 character IFSC code, e.g. ICIC0000282';
  },
};

const swift = {
  clean: code,
  check(value) {
    if (!value) return 'SWIFT / BIC code is required';
    return /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(value) ? '' : 'SWIFT / BIC code must be 8 or 11 characters, e.g. CHASUS33';
  },
};

const accountType = {
  clean: (value) => ACCOUNT_TYPES.find((type) => type.toLowerCase() === text(value).toLowerCase()) || text(value),
  check: (value) => (ACCOUNT_TYPES.includes(value) ? '' : 'Select an account type'),
};

const overseasCountry = {
  clean: (value) => text(value).toUpperCase(),
  check: (value) => (OVERSEAS_COUNTRIES.includes(value) ? '' : 'Select the country of your bank'),
};

const routingCode = {
  clean: code,
  check: (value) => (!value || /^[A-Z0-9]{3,20}$/.test(value) ? '' : 'Enter a valid routing number'),
};

/** Fields by type. */
const RULES = {
  [BANK_INDIA]: {
    bank_account_holder: requiredText('Account holder name'),
    bank_account_number: indianAccountNumber,
    bank_ifsc_code: ifsc,
    bank_name: requiredText('Bank name'),
    bank_account_type: accountType,
  },
  [BANK_OVERSEAS]: {
    bank_country: overseasCountry,
    bank_account_holder: requiredText('Account holder name'),
    bank_account_holder_address: requiredText('Account holder address', 5, 250),
    bank_account_number: overseasAccountNumber,
    bank_name: requiredText('Bank name'),
    bank_swift_code: swift,
    bank_routing_code: routingCode,
    bank_address: optionalText('Bank address', 250),
    bank_account_type: accountType,
  },
  [PAYPAL]: { paypal_email: email },
};

/** A user cannot add two methods of a type that share all of these. */
const IDENTITY_FIELDS = {
  [BANK_INDIA]: ['bank_account_number', 'bank_ifsc_code'],
  [BANK_OVERSEAS]: ['bank_account_number', 'bank_swift_code'],
  [PAYPAL]: ['paypal_email'],
};

/**
 * Clean and validate the details of a payment method. Unknown fields are dropped.
 * @param {string} type
 * @param {object} details
 * @returns {{values: Record<string, string>, errors: Record<string, string>}}
 */
function validatePaymentMethod(type, details) {
  if (!PAYMENT_METHOD_TYPES.includes(type)) return { values: {}, errors: { type: 'Select a payment method' } };

  const values = {};
  const errors = {};
  const rules = Object.entries(RULES[type]);
  for (const [name, rule] of rules) values[name] = rule.clean(details?.[name]);
  for (const [name, rule] of rules) {
    const error = rule.check(values[name], values);
    if (error) errors[name] = error;
  }
  return { values, errors };
}

/** ISO 13616 checksum: the rearranged number must leave a remainder of 1 when divided by 97. */
function isValidIban(iban) {
  if (iban.length < 15) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    for (const digit of String(Number.parseInt(char, 36))) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

module.exports = {
  ACCOUNT_TYPES,
  BANK_INDIA,
  BANK_OVERSEAS,
  IDENTITY_FIELDS,
  OVERSEAS_COUNTRIES,
  PAYMENT_METHOD_ICONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_LIMIT,
  PAYMENT_METHOD_TYPES,
  PAYPAL,
  WALLET,
  getPaymentMethodType,
  isPaymentMethodTypeAvailable,
  validatePaymentMethod,
};
