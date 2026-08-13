const { getRates } = require('./exchangeRates');

function createExchangeRateSnapshot(result, currency = 'USD') {
  const normalizedCurrency = String(currency).toUpperCase();
  const rate = Number(result?.rates?.[normalizedCurrency]);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  return {
    currency: normalizedCurrency,
    rate,
    cached: Boolean(result.cached),
    stale: Boolean(result.stale),
  };
}

async function getAdminExchangeRate(currency = 'USD', getRatesFn = getRates) {
  return createExchangeRateSnapshot(await getRatesFn(), currency);
}

async function getAdminExchangeRateResponse(currency = 'USD', getRatesFn = getRates) {
  try {
    const exchangeRate = await getAdminExchangeRate(currency, getRatesFn);
    if (exchangeRate) return { status: 200, body: exchangeRate };
  } catch {
    // A missing live or cached rate is a presentation-only failure.
  }
  return { status: 503, body: { error: `${String(currency).toUpperCase()} exchange rate is unavailable` } };
}

module.exports = {
  createExchangeRateSnapshot,
  getAdminExchangeRate,
  getAdminExchangeRateResponse,
};
