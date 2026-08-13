const compactNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

const exactNumber = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
});

const exactCurrency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  currencyDisplay: 'narrowSymbol',
  maximumFractionDigits: 2,
});

const exactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function formatCompactNumber(value, { currency = false } = {}) {
  const number = toFiniteNumber(value);
  const formatted = compactNumber.format(number);
  return currency ? `₹${formatted}` : formatted;
}

export function formatExactNumber(value, { currency = false } = {}) {
  const number = toFiniteNumber(value);
  return (currency ? exactCurrency : exactNumber).format(number);
}

export function convertInrToUsd(value, rate) {
  const amount = Number(value);
  const usdRate = Number(rate);
  if (!Number.isFinite(amount) || !Number.isFinite(usdRate) || usdRate <= 0) return null;
  return amount * usdRate;
}

export function formatCompactUsd(value) {
  return `$${compactNumber.format(toFiniteNumber(value))}`;
}

export function formatExactUsd(value) {
  return exactUsd.format(toFiniteNumber(value));
}
