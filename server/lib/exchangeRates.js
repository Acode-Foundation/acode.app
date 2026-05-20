const { FALLBACK_CURRENCY } = require('./currencyMap');
const { getSubunitDigits } = require('./currencyMap');

const CACHE_TTL = 3600000;
const API_URL = `https://v6.exchangerate-api.com/v6/${process.env.EXCHANGERATE_API}/latest/INR`;

let cache = {
  rates: null,
  timestamp: 0,
};

async function fetchRates() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(API_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`ExchangeRate-API responded with status ${response.status}`);
    }

    const data = await response.json();
    if (!data.conversion_rates || typeof data.conversion_rates !== 'object') {
      throw new Error('Invalid response format from ExchangeRate-API');
    }

    cache = {
      rates: data.conversion_rates,
      timestamp: Date.now(),
    };

    return data.conversion_rates;
  } catch (error) {
    console.error('ExchangeRate-API request failed:', error.message);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getRates() {
  if (cache.rates && Date.now() - cache.timestamp < CACHE_TTL) {
    return { rates: cache.rates, cached: true };
  }

  try {
    const rates = await fetchRates();
    return { rates, cached: false };
  } catch (error) {
    if (cache.rates) {
      console.warn('Failed to refresh exchange rates, using stale cache:', error.message);
      return { rates: cache.rates, cached: true, stale: true };
    }

    console.error('Failed to fetch exchange rates and no cache available:', error.message);
    return null;
  }
}

async function convertPrice(amountInINR, targetCurrency) {
  if (amountInINR == null || Number.isNaN(Number(amountInINR))) {
    throw new Error(`Invalid amount: ${amountInINR}`);
  }

  const amount = Number(amountInINR);
  if (amount <= 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  if (!targetCurrency || typeof targetCurrency !== 'string') {
    throw new Error(`Invalid target currency: ${targetCurrency}`);
  }

  const target = targetCurrency.toUpperCase();

  if (target === 'INR') {
    return {
      rate: 1,
      amount,
      cached: true,
      currency: 'INR',
    };
  }

  const result = await getRates();
  if (!result) {
    throw new Error('Error fetching exchange rates');
  }

  const rate = result.rates[target];
  if (!rate || Number.isNaN(Number(rate))) {
    if (target === FALLBACK_CURRENCY) {
      throw new Error(`Exchange rate not available for ${FALLBACK_CURRENCY}`);
    }
    return convertPrice(amountInINR, FALLBACK_CURRENCY);
  }

  const subunitDigits = getSubunitDigits(target) ?? 2;
  const multiplier = 10 ** subunitDigits;
  const raw = amount * Number(rate);
  const convertedAmount = Math.max(Math.round(raw * multiplier) / multiplier, 1);

  return {
    currency: target,
    rate: Number(rate),
    cached: result.cached,
    amount: convertedAmount,
  };
}

async function refreshRates() {
  try {
    await fetchRates();
  } catch (error) {
    console.error('refreshRates: failed to refresh rates:', error.message);
    throw error;
  }
}

function clearCache() {
  cache = {
    rates: null,
    timestamp: 0,
  };
}

module.exports = {
  convertPrice,
  refreshRates,
  clearCache,
  getRates,
  CACHE_TTL,
};
