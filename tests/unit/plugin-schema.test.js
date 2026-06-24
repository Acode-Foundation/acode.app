const path = require('node:path');
const fs = require('node:fs');
const { getMatchingModeEntries, getModePluginIds, isValidPrice, matchScore } = require('../../server/apis/plugin');

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

describe('mode plugin matching', () => {
  it('matches multiple extensions with regex entries', () => {
    const entry = { regex: '^(csv|tsv)$', pluginIds: ['table.plugin'] };

    expect(matchScore(entry, 'csv')).toBeGreaterThan(0);
    expect(matchScore(entry, 'tsv')).toBeGreaterThan(0);
    expect(matchScore(entry, 'json')).toBe(0);
  });

  it('keeps legacy mode strings working', () => {
    expect(matchScore({ mode: 'csv' }, 'csv')).toBeGreaterThan(0);
    expect(matchScore({ mode: 'csv' }, 'json')).toBe(0);
    expect(matchScore({ mode: 'c' }, 'csv')).toBe(0);
  });

  it('orders matching mode entries by score', () => {
    const modes = [
      { regex: 'c', pluginIds: ['c.plugin'] },
      { regex: '^(csv|tsv)$', pluginIds: ['table.plugin'] },
    ];

    expect(getMatchingModeEntries(modes, 'csv').map((entry) => entry.pluginIds[0])).toEqual(['table.plugin', 'c.plugin']);
  });

  it('includes plugins from every matching mode entry', () => {
    const modes = [
      { regex: 'c', pluginIds: ['c.plugin', 'shared.plugin'] },
      { regex: '^(csv|tsv)$', pluginIds: ['table.plugin', 'shared.plugin'] },
    ];

    expect(getModePluginIds(modes, 'csv')).toEqual(['table.plugin', 'shared.plugin', 'c.plugin']);
  });
});
