import { convertInrToUsd, formatCompactNumber, formatCompactUsd, formatExactNumber, formatExactUsd } from '../../client/lib/formatNumber';

describe('dashboard number formatting', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1_000, '1K'],
    [1_200, '1.2K'],
    [20_000, '20K'],
    [1_200_000, '1.2M'],
  ])('formats %s compactly as %s', (value, expected) => {
    expect(formatCompactNumber(value)).toBe(expected);
  });

  it('prefixes monetary values without changing compact units', () => {
    expect(formatCompactNumber(1_200_000, { currency: true })).toBe('₹1.2M');
    expect(formatExactNumber(1_200_000, { currency: true })).toBe('₹12,00,000.00');
  });

  it('preserves an exact grouped value for tooltips', () => {
    expect(formatExactNumber(1_234_567)).toBe('12,34,567');
  });

  it('renders invalid input safely without changing its source', () => {
    const value = 'not-a-number';
    expect(formatCompactNumber(value)).toBe('0');
    expect(value).toBe('not-a-number');
  });

  it('converts INR to USD without changing the source value', () => {
    const amount = 100_000;
    expect(convertInrToUsd(amount, 0.012)).toBe(1_200);
    expect(amount).toBe(100_000);
  });

  it('formats compact and exact USD values', () => {
    expect(formatCompactUsd(1_200)).toBe('$1.2K');
    expect(formatExactUsd(1_234.56)).toBe('$1,234.56');
    expect(formatCompactUsd(0)).toBe('$0');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined])('rejects invalid USD rate %s', (rate) => {
    expect(convertInrToUsd(1_000, rate)).toBeNull();
  });
});
