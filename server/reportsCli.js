/* eslint-disable no-console */
const downloadGrCsv = require('./lib/downloadSalesCsv');

const args = process.argv.slice(2);

// Month name mappings (short and full)
const monthNames = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Parse month input - accepts number (1-12) or name (jan, january, etc.)
 */
function parseMonth(input) {
  if (!input) return null;
  const lower = input.toLowerCase();
  if (monthNames[lower]) return monthNames[lower];
  const num = Number(input);
  if (num >= 1 && num <= 12) return num;
  return null;
}

// Show help if -h or --help is passed
if (args.includes('-h') || args.includes('--help')) {
  console.log(`
Reports CLI - Download sales or earnings reports

USAGE:
  node reportsCli.js <month> <year> [type]

ARGUMENTS:
  <month>   Month number (1-12) or name (jan, january, feb, february, etc.)
  <year>    Full year (e.g., 2025)
  [type]    Report type: 'sales' or 'earnings' (default: sales)

OPTIONS:
  -h, --help    Show this help message

MONTH NAMES:
  Short: jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec
  Full:  january, february, march, april, may, june, july,
         august, september, october, november, december

EXAMPLES:
  node reportsCli.js jan 2025           # Download sales report for January 2025
  node reportsCli.js january 2025       # Same as above
  node reportsCli.js 01 2025            # Same as above (using number)
  node reportsCli.js dec 2025 earnings  # Download earnings report for December 2025
`);
  process.exit(0);
}

const monthInput = args[0];
const year = args[1];
const type = args[2] || 'sales';

if (!monthInput || !year) {
  console.error('Usage: node reportsCli.js <month> <year> [type]');
  console.error('Run with -h or --help for more information.');
  process.exit(1);
}

const month = parseMonth(monthInput);
if (!month) {
  console.error(`Invalid month: "${monthInput}"`);
  console.error('Use a number (1-12) or name (jan, january, feb, february, etc.)');
  process.exit(1);
}

downloadGrCsv(Number(year), month, type)
  .then((filePath) => {
    console.log(`Report downloaded to ${filePath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
