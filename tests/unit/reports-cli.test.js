const path = require('node:path');
const { formatDateFolderName, getReportsOutputDirectory, parseMonth } = require('../../server/reportsCli');

describe('reports CLI', () => {
  it('formats the output folder using the current date', () => {
    expect(formatDateFolderName(new Date(2026, 6, 6))).toBe('6-jul-2026');
  });

  it('places reports inside the dated folder', () => {
    expect(getReportsOutputDirectory(new Date(2026, 6, 6), '/tmp/Acode-reports')).toBe(path.join('/tmp/Acode-reports', '6-jul-2026'));
  });

  it('parses month names and numbers', () => {
    expect(parseMonth('jul')).toBe(7);
    expect(parseMonth('july')).toBe(7);
    expect(parseMonth('07')).toBe(7);
  });
});
