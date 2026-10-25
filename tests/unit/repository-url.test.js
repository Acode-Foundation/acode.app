const { safeRepositoryUrl } = require('../../shared/repositoryUrl');

// The plugin page links only what this returns, which also covers repositories stored before uploads were validated.
describe('safeRepositoryUrl', () => {
  it('keeps http(s) URLs', () => {
    expect(safeRepositoryUrl('https://github.com/dev/test')).toBe('https://github.com/dev/test');
    expect(safeRepositoryUrl('http://example.com/repo')).toBe('http://example.com/repo');
    expect(safeRepositoryUrl('HTTPS://GitHub.com/dev/test')).toBe('https://github.com/dev/test');
  });

  it('drops script and data URLs in any spelling', () => {
    for (const value of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      '\tjavascript:alert(1)',
      'data:text/html,x',
      'vbscript:x',
    ]) {
      expect(safeRepositoryUrl(value)).toBe('');
    }
  });

  it('drops missing, malformed and non-string values', () => {
    for (const value of [undefined, null, '', 'github.com/dev/test', '//evil.example', 'not a url', 42, { url: 'https://x' }]) {
      expect(safeRepositoryUrl(value)).toBe('');
    }
  });
});
