const { LICENSES, normalizeLicense } = require('../../server/lib/pluginLicense');

describe('normalizeLicense', () => {
  it('accepts UNLICENSED and Proprietary for closed-source plugins', () => {
    expect(normalizeLicense('UNLICENSED')).toBe('UNLICENSED');
    expect(normalizeLicense('Proprietary')).toBe('Proprietary');
  });

  it('accepts common SPDX identifiers, including -only/-or-later forms', () => {
    for (const license of ['MIT', 'ISC', 'Apache-2.0', 'GPL-3.0-or-later', 'LGPL-2.1-only', 'Unlicense', 'CC0-1.0']) {
      expect(normalizeLicense(license)).toBe(license);
    }
  });

  it('matches case-insensitively and returns the canonical spelling', () => {
    expect(normalizeLicense('mit')).toBe('MIT');
    expect(normalizeLicense(' apache-2.0 ')).toBe('Apache-2.0');
    expect(normalizeLicense('unlicensed')).toBe('UNLICENSED');
  });

  it('rejects unknown values and non-strings', () => {
    expect(normalizeLicense('WTFPL-ish')).toBeNull();
    expect(normalizeLicense('')).toBeNull();
    expect(normalizeLicense({ type: 'MIT' })).toBeNull();
  });

  it('keeps every license the site accepted before', () => {
    const previous = [
      'MIT',
      'GPL-3.0',
      'Apache-2.0',
      'BSD-2-Clause',
      'BSD-3-Clause',
      'LGPL-3.0',
      'MPL-2.0',
      'CDDL-1.0',
      'EPL-2.0',
      'AGPL-3.0',
      'Proprietary',
    ];
    for (const license of previous) expect(LICENSES).toContain(license);
  });
});
