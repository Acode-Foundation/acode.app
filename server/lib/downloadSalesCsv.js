/* eslint-disable dot-notation */
const path = require('node:path');
const os = require('node:os');
const fileSystem = require('node:fs');
const Decimal = require('decimal.js');
const downloadReport = require('./downloadGr');

const documentsDirectory = `${os.homedir()}/Documents`;
const defaultPath = path.resolve(documentsDirectory, 'Acode-reports');

/**
 * Download a Google Earnings report from Google Cloud Storage
 * @param {number} year Year to download
 * @param {number} month Month of the year to download, 1-12
 */
async function downloadSalesReportCsv(year, month, type = 'sales', dir = defaultPath) {
  const json = await downloadReport(year, month, type);
  const orders = {};

  for (const row of json) {
    if (type === 'sales') {
      sales(row, orders);
    } else {
      earnings(row, orders);
    }
  }

  let csv;

  if (type === 'earnings') {
    csv = 'ID,Date,Product,Amount\n';

    for (const order of Object.values(orders)) {
      csv += `${order.id},${order.date},${order.product},${order.amount}\n`;
    }
  } else {
    csv = 'Order Id,Date,Product,Product Id,Country of Buyer,State of Buyer,City of Buyer,Amount in Buyer Currency\n';

    for (const order of Object.values(orders)) {
      csv += `${order.id},${order.date},${order.product},${order.productId},${order.countryOfBuyer},${order.stateOfBuyer},${order.cityOfBuyer},${order.chargedAmount}\n`;
    }
  }

  const fileName = `${type}-${year}-${month}.csv`;
  const file = path.join(dir, fileName);
  if (!fileSystem.existsSync(dir)) {
    fileSystem.mkdirSync(dir);
  }

  fileSystem.writeFileSync(file, csv);
  return file;
}

function sales(row, orders) {
  const id = row['Order Number'];
  const date = row['Order Charged Date'];
  const product = row['Product Title'];
  const productId = row['SKU ID'];
  const cityOfBuyer = row['City of Buyer'];
  const stateOfBuyer = row['State of Buyer'];
  const countryOfBuyer = row['Country of Buyer'];
  const chargedAmount = row['Charged Amount'].replace(',', '');

  if (orders[id]) {
    const order = orders[id];
    order.chargedAmount = new Decimal(order.chargedAmount).add(chargedAmount).toString();
    return;
  }

  orders[id] = {
    id,
    date: date.replace(/,/g, ''),
    product,
    productId,
    cityOfBuyer,
    stateOfBuyer,
    countryOfBuyer,
    chargedAmount,
  };
}

function earnings(row, orders) {
  // biome-ignore lint/complexity/useLiteralKeys: <explanation>
  const id = row['Description'];
  const date = row['Transaction Date'];
  const product = row['Product Title'];
  const amount = row['Amount (Merchant Currency)'];

  if (orders[id]) {
    const order = orders[id];
    order.amount = new Decimal(order.amount).add(amount).toString();
    return;
  }

  orders[id] = {
    id,
    date: date.replace(/,/g, ''),
    product,
    amount,
  };
}

module.exports = downloadSalesReportCsv;
