const Database = require('better-sqlite3');
const { getPluginSalesInr } = require('../../server/lib/adminDashboardMetrics');

let db;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE purchase_order (
    id INTEGER PRIMARY KEY,
    amount REAL,
    currency TEXT,
    provider TEXT,
    order_id TEXT,
    state INTEGER
  );
  CREATE TABLE razorpay_order (
    id INTEGER PRIMARY KEY,
    razorpay_order_id TEXT,
    product_type TEXT,
    amount_inr REAL
  );`);
});

afterEach(() => {
  db.close();
});

function insertPurchase({ amount, currency = 'INR', provider, orderId, state = 0 }) {
  db.prepare('INSERT INTO purchase_order (amount, currency, provider, order_id, state) VALUES (?, ?, ?, ?, ?)').run(
    amount,
    currency,
    provider,
    orderId,
    state,
  );
}

function insertRazorpayOrder({ orderId, amountInr, productType = 'plugin' }) {
  db.prepare('INSERT INTO razorpay_order (razorpay_order_id, product_type, amount_inr) VALUES (?, ?, ?)').run(orderId, productType, amountInr);
}

function calculatePluginSales() {
  return getPluginSalesInr((sql, values) => Promise.resolve([db.prepare(sql).get(...values)]));
}

describe('admin dashboard plugin sales', () => {
  it('normalizes foreign Razorpay sales to INR without changing row inclusion semantics', async () => {
    insertPurchase({ amount: 100, provider: 'google_play', orderId: 'google-inr' });
    insertPurchase({ amount: 50, provider: 'razorpay', orderId: 'razorpay-inr' });
    insertPurchase({ amount: 2, currency: 'USD', provider: 'razorpay', orderId: 'razorpay-usd' });
    insertRazorpayOrder({ orderId: 'razorpay-usd', amountInr: 160 });

    // Existing dashboard semantics include every row, regardless of order state.
    insertPurchase({ amount: 20, provider: 'google_play', orderId: 'google-pending', state: 2 });

    expect(await calculatePluginSales()).toEqual({ total: 330, omitted: 0 });
  });

  it('preserves zeroed foreign orders and omits legacy foreign rows without authoritative INR data', async () => {
    insertPurchase({ amount: 0, currency: 'EUR', provider: 'razorpay', orderId: 'razorpay-refunded', state: 1 });
    insertRazorpayOrder({ orderId: 'razorpay-refunded', amountInr: 90 });
    insertPurchase({ amount: 10, currency: 'BRL', provider: 'razorpay', orderId: 'razorpay-legacy' });
    insertPurchase({ amount: 4, currency: 'USD', provider: 'razorpay', orderId: 'razorpay-other-product' });
    insertRazorpayOrder({ orderId: 'razorpay-other-product', amountInr: 320, productType: 'acode_pro' });

    expect(await calculatePluginSales()).toEqual({ total: 0, omitted: 2 });
  });

  it('returns numeric zeroes when there are no plugin sales', async () => {
    expect(await calculatePluginSales()).toEqual({ total: 0, omitted: 0 });
  });
});
