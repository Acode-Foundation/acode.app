// Licenses accepted in plugin.json `license`. SPDX identifiers, plus
// `Proprietary` and npm's `UNLICENSED` (all rights reserved, not open source).
const LICENSES = [
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'MPL-2.0',
  'GPL-2.0',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'LGPL-2.1',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'CDDL-1.0',
  'EPL-2.0',
  'BSL-1.0',
  'Zlib',
  'Unlicense',
  'CC0-1.0',
  'Proprietary',
  'UNLICENSED',
];

const byLowerCase = new Map(LICENSES.map((license) => [license.toLowerCase(), license]));

/**
 * Canonical spelling of an accepted license, or null if it isn't accepted.
 * Matching ignores case and surrounding whitespace (`mit` -> `MIT`).
 * @param {unknown} license
 */
function normalizeLicense(license) {
  if (typeof license !== 'string') return null;
  return byLowerCase.get(license.trim().toLowerCase()) || null;
}

module.exports = { LICENSES, normalizeLicense };
