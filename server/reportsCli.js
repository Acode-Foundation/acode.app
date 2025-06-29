/* eslint-disable no-console */
const downloadGrCsv = require('./lib/downloadSalesCsv');

const month = process.argv[2];
const year = process.argv[3];
const type = process.argv[4] || 'sales';

if (!month || !year) {
  console.error('Usage: node reportsCli.js <mm> <yyyy> <sales|earnings>');
  process.exit(1);
}

downloadGrCsv(Number(year), Number(month), type)
  .then((filePath) => {
    console.log(`Report downloaded to ${filePath}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
