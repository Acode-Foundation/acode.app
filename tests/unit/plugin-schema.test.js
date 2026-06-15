const path = require('node:path');
const fs = require('node:fs');
const { isValidPrice } = require('../../server/apis/plugin');

describe('plugin schema', () => {
  it('price field has correct bounds', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'server/schemas/plugin.v0.1.0.json'), 'utf8'));
    expect(schema.properties.price.minimum).toBe(0);
    expect(schema.properties.price.maximum).toBe(10000);
  });
});

describe('isValidPrice', () => {
  it('rejects values below MIN_PRICE', () => {
    expect(isValidPrice(0)).toBe(false);
    expect(isValidPrice(5)).toBe(false);
    expect(isValidPrice(-1)).toBe(false);
    expect(isValidPrice(NaN)).toBe(false);
  });

  it('accepts values in range', () => {
    expect(isValidPrice(10)).toBe(true);
    expect(isValidPrice(100)).toBe(true);
    expect(isValidPrice(10000)).toBe(true);
  });

  it('rejects values above MAX_PRICE', () => {
    expect(isValidPrice(10001)).toBe(false);
  });
});
