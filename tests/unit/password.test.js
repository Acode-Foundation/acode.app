const { isValidPassword } = require('../../server/password');

describe('isValidPassword', () => {
  it('rejects empty, whitespace-only, and short passwords', () => {
    expect(isValidPassword('')).toBe(false);
    expect(isValidPassword('      ')).toBe(false);
    expect(isValidPassword('abc12')).toBe(false);
  });

  it('accepts passwords with at least six non-whitespace characters', () => {
    expect(isValidPassword('abc123')).toBe(true);
    expect(isValidPassword('  abc123  ')).toBe(true);
  });
});
