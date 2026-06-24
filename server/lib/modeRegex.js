const MAX_MODE_REGEX_LENGTH = 1024;
const MAX_MODE_KEYWORD_LENGTH = 128;
const GROUP_QUANTIFIER_REGEX = /\(([^()]*)\)\s*(?:[+*]|\{\d+(?:,\d*)?\})/g;
const NESTED_QUANTIFIER_REGEX = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+(?:,\d*)?\})(?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+(?:,\d*)?\})/;

function validateModeRegex(pattern) {
  if (typeof pattern !== 'string' || !pattern.trim()) {
    return { valid: false, error: 'regex is required' };
  }

  if (pattern.length > MAX_MODE_REGEX_LENGTH) {
    return { valid: false, error: `regex must be ${MAX_MODE_REGEX_LENGTH} characters or fewer` };
  }

  try {
    new RegExp(pattern);
  } catch (err) {
    return { valid: false, error: err.message };
  }

  if (NESTED_QUANTIFIER_REGEX.test(pattern)) {
    return { valid: false, error: 'regex contains nested quantifiers' };
  }

  for (const match of pattern.matchAll(GROUP_QUANTIFIER_REGEX)) {
    const alternatives = match[1].split('|');
    if (alternatives.length < 2) continue;

    const uniqueAlternatives = new Set(alternatives);
    if (uniqueAlternatives.size !== alternatives.length) {
      return { valid: false, error: 'regex contains ambiguous repeated alternatives' };
    }

    for (const a of alternatives) {
      for (const b of alternatives) {
        if (a && b && a !== b && b.startsWith(a)) {
          return { valid: false, error: 'regex contains ambiguous repeated alternatives' };
        }
      }
    }
  }

  return { valid: true };
}

function isModeKeywordSafe(keyword) {
  return String(keyword || '').trim().length <= MAX_MODE_KEYWORD_LENGTH;
}

module.exports = {
  MAX_MODE_KEYWORD_LENGTH,
  MAX_MODE_REGEX_LENGTH,
  isModeKeywordSafe,
  validateModeRegex,
};
