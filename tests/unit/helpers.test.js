const { getPluginSKU, detectUserCurrency, formatAmount } = require('../../server/lib/helpers');

describe('getPluginSKU', () => {
  it('generates deterministic SKU for a given ID', () => {
    const sku1 = getPluginSKU('my.plugin.id');
    const sku2 = getPluginSKU('my.plugin.id');
    expect(sku1).toBe(sku2);
    expect(sku1).toMatch(/^plugin_[a-f0-9n]+$/i);
  });

  it('produces different SKUs for different IDs', () => {
    expect(getPluginSKU('plugin.a')).not.toBe(getPluginSKU('plugin.b'));
  });

  it('lowercases hash', () => {
    expect(getPluginSKU('TestPlugin')).toBe(getPluginSKU('TestPlugin').toLowerCase());
  });

  it('handles empty string', () => {
    expect(getPluginSKU('')).toBe('plugin_0');
  });

  it('handles very long ID', () => {
    expect(getPluginSKU('a'.repeat(1000))).toMatch(/^plugin_/);
  });
});

describe('detectUserCurrency', () => {
  it('returns fallback USD without geo-ip or cookie', () => {
    const currency = detectUserCurrency({ cookies: {}, ip: '127.0.0.1' });
    expect(currency.code).toBe('USD');
  });
});

describe('formatAmount', () => {
  it('formats INR correctly', () => {
    expect(formatAmount(150, 'INR')).toBe('150.00');
    expect(formatAmount(10, 'INR')).toBe('10.00');
  });

  it('works with currency object', () => {
    const usd = { code: 'USD', subunitDigits: 2, symbol: '$' };
    expect(formatAmount(9.99, usd)).toBe('9.99');
  });
});
