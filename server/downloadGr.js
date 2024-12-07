// download Google Earnings reports using google cloud/storage

const path = require('path');
const JsZip = require('jszip');
const csvToJSON = require('csvtojson');
const { Storage } = require('@google-cloud/storage');

const storage = new Storage({
  projectId: 'pc-api-7966583793961491942-480',
  keyFilename: path.resolve(__dirname, '../data/key.json'),
});

// cloud storage URI
// gs://pubsite_prod_7966583793961491942/earnings/

const bucketName = 'pubsite_prod_7966583793961491942';
const bucket = storage.bucket(bucketName);

/**
 * Download a Google Earnings report from Google Cloud Storage
 * @param {number} year Year to download
 * @param {number} month Month of the year to download, 1-12
 * @param {'earnings'|'sales'} type
 * @returns {Promise<Order[]>}
 */
async function downloadReport(year, month, type = 'earnings') {
  if (month < 10) {
    month = `0${month}`;
  }

  // const prefix = `earnings/earnings_${year}02`;
  let prefix;

  if (type === 'earnings') {
    prefix = `earnings/earnings_${year}${month}`;
  } else if (type === 'sales') {
    prefix = `sales/salesreport_${year}${month}`;
  } else {
    throw new Error('Invalid report type');
  }

  const [files] = await bucket.getFiles({ prefix });

  if (files.length === 0) {
    return [];
  }

  const [file] = files;
  const zip = new JsZip();

  const [data] = await file.download();
  const content = await zip.loadAsync(data);
  const [csv] = Object.values(content.files);

  const csvData = await csv.async('string');
  return csvToJSON().fromString(csvData);
}

module.exports = downloadReport;
