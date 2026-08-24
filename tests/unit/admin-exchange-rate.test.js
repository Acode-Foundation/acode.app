const { createExchangeRateSnapshot, getAdminExchangeRate, getAdminExchangeRateResponse } = require('../../server/lib/adminExchangeRate');

describe('admin USD exchange rate', () => {
  it('returns a current USD rate without changing its value', async () => {
    const result = await getAdminExchangeRate('USD', async () => ({ rates: { USD: 0.0119 }, cached: false }));

    expect(result).toEqual({ currency: 'USD', rate: 0.0119, cached: false, stale: false });
  });

  it('preserves cached and stale rate state', () => {
    const result = createExchangeRateSnapshot({ rates: { USD: 0.012 }, cached: true, stale: true });

    expect(result).toEqual({ currency: 'USD', rate: 0.012, cached: true, stale: true });
  });

  it.each([null, {}, { rates: {} }, { rates: { USD: 0 } }, { rates: { USD: 'invalid' } }])('returns no snapshot for unavailable rates', (value) => {
    expect(createExchangeRateSnapshot(value)).toBeNull();
  });

  it('returns the read-only endpoint response contract', async () => {
    const response = await getAdminExchangeRateResponse('USD', async () => ({ rates: { USD: 0.0119 }, cached: true }));

    expect(response).toEqual({
      status: 200,
      body: { currency: 'USD', rate: 0.0119, cached: true, stale: false },
    });
  });

  it.each([async () => null, async () => ({ rates: {} }), async () => Promise.reject(new Error('offline'))])(
    'returns 503 when no current or stale rate is available',
    async (getRatesFn) => {
      await expect(getAdminExchangeRateResponse('USD', getRatesFn)).resolves.toEqual({
        status: 503,
        body: { error: 'USD exchange rate is unavailable' },
      });
    },
  );
});
