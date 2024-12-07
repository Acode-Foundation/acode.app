/* eslint-disable no-console */
const downloadGrCsv = require('./downloadSalesCsv');

const month = process.argv[2];
const year = process.argv[3];

if (!month || !year) {
  console.error('Usage: node reportsCli.js <month> <year>');
  process.exit(1);
}

downloadGrCsv(Number(year), Number(month))
  .then((filePath) => {
    console.log(`Report downloaded to ${filePath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
