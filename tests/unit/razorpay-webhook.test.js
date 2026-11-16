import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { Router } from 'express';

const filename = path.resolve(import.meta.dirname, '../../server/apis/razorpay.js');
const source = fs.readFileSync(filename, 'utf8');
let record;
let razorpayOrder;
let purchaseOrder;
let fetchPayments;
let webhook;
let db;
let sendEmail;
let execSql;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE razorpay_order (
    razorpay_order_id TEXT, status TEXT, user_id INTEGER, plugin_id TEXT, product_type TEXT, razorpay_payment_id TEXT
  );
    INSERT INTO razorpay_order VALUES ('order_1', 'created', 7, 'test.plugin', 'plugin', NULL);`);
  record = {
    get status() {
      return db.prepare('SELECT status FROM razorpay_order').get().status;
    },
    set status(value) {
      db.prepare('UPDATE razorpay_order SET status = ?').run(value);
    },
  };
  execSql = vi.fn(async (sql, values) => db.prepare(sql).all(...values));
  sendEmail = vi.fn().mockResolvedValue();
  razorpayOrder = {
    ID: 'id',
    STATUS: 'status',
    RAZORPAY_ORDER_ID: 'razorpay_order_id',
    RAZORPAY_PAYMENT_ID: 'razorpay_payment_id',
    STATUS_CREATED: 'created',
    STATUS_PENDING: 'pending',
    STATUS_FAILED: 'failed',
    STATUS_PAID: 'paid',
    get: vi.fn(async () => [db.prepare('SELECT * FROM razorpay_order').get()]),
    update: vi.fn(),
  };
  purchaseOrder = { get: vi.fn(), update: vi.fn() };
  fetchPayments = vi.fn().mockResolvedValue({ items: [{ status: 'failed' }] });
  const dependencies = {
    'node:crypto': {},
    'node:fs': {},
    'node:path': path,
    express: { Router },
    '../entities/entity': { execSql },
    '../entities/plugin': { ID: 'id', NAME: 'name', get: vi.fn().mockResolvedValue([{ name: 'Test plugin' }]) },
    '../entities/purchaseOrder': purchaseOrder,
    '../entities/user': { ID: 'id', EMAIL: 'email', NAME: 'name', get: vi.fn().mockResolvedValue([{ email: 'test@example.com', name: 'Test' }]) },
    '../entities/razorpayOrder': razorpayOrder,
    '../entities/appConfig': {},
    '../entities/sponsor': {},
    '../lib/helpers': {},
    '../lib/sendEmail': sendEmail,
    '../../constants.mjs': {},
    '../lib/razorpay': () => ({ orders: { fetchPayments } }),
    '../lib/currencyMap': {},
    '../lib/exchangeRates': {},
    '../lib/ensurePurchaseOwnership': vi.fn(),
    '../lib/notifyRefund': vi.fn(),
    '../lib/notifyPurchase': vi.fn(),
    '../lib/sponsorImage': {},
  };
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      module,
      Buffer,
      process: { env: { NODE_ENV: 'test' } },
      console,
      require(name) {
        if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
        return dependencies[name];
      },
    },
    { filename },
  );
  webhook = module.exports.stack.find((layer) => layer.route?.path === '/webhook').route.stack[0].handle;
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

async function failPayment(expectedStatus = 200) {
  const req = { body: { event: 'payment.failed', payload: { payment: { entity: { order_id: 'order_1' } } } } };
  const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
  await webhook(req, res);
  expect(res.status).toHaveBeenCalledWith(expectedStatus);
  if (expectedStatus === 200) expect(res.send).toHaveBeenCalledWith({ status: 'ok' });
}

it('ignores a failed attempt when Razorpay already captured another attempt', async () => {
  fetchPayments.mockResolvedValue({ items: [{ status: 'failed' }, { status: 'captured' }] });
  await failPayment();
  expect(razorpayOrder.update).not.toHaveBeenCalled();
  expect(purchaseOrder.update).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
});

it.each(['paid', 'refunding', 'refunded', 'cancelled', 'failed'])('does not downgrade a locally %s order', async (status) => {
  record.status = status;
  await failPayment();
  expect(razorpayOrder.update).not.toHaveBeenCalled();
  expect(purchaseOrder.update).not.toHaveBeenCalled();
  expect(fetchPayments).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
});

it('records a failed attempt without cancelling purchase ownership or blocking a later retry', async () => {
  await failPayment();
  expect(record.status).toBe('failed');
  expect(purchaseOrder.update).not.toHaveBeenCalled();
  expect(sendEmail).toHaveBeenCalledOnce();
  await failPayment();
  expect(sendEmail).toHaveBeenCalledOnce();
});

it('guards the update when a captured webhook races the failed attempt', async () => {
  razorpayOrder.get.mockImplementationOnce(async () => {
    const beforeCapture = { ...record };
    record.status = 'paid';
    return [beforeCapture];
  });
  await failPayment();
  expect(record.status).toBe('paid');
  expect(purchaseOrder.update).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
});

it('does not email when capture arrives after the failure update', async () => {
  execSql.mockImplementationOnce(async (sql, values) => {
    const rows = db.prepare(sql).all(...values);
    record.status = 'paid';
    return rows;
  });
  await failPayment();
  expect(sendEmail).not.toHaveBeenCalled();
});

it('requests a retry on provider errors without changing state or emailing', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchPayments.mockRejectedValue(new Error('Provider unavailable'));
  await failPayment(503);
  expect(record.status).toBe('created');
  expect(execSql).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
});

it('ignores unknown orders without contacting the provider', async () => {
  razorpayOrder.get.mockResolvedValue([]);
  await failPayment();
  expect(fetchPayments).not.toHaveBeenCalled();
  expect(execSql).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
});

it.each(['created', 'authorized', 'captured'])('preserves a pending order with another %s attempt', async (status) => {
  record.status = 'pending';
  fetchPayments.mockResolvedValue({ items: [{ status: 'failed' }, { status }] });
  await failPayment();
  expect(record.status).toBe('pending');
  expect(execSql).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
});

it('preserves a newer pending attempt recorded while provider requests are in flight', async () => {
  record.status = 'pending';
  db.prepare('UPDATE razorpay_order SET razorpay_payment_id = ?').run('old-attempt');
  fetchPayments.mockImplementation(async () => {
    db.prepare('UPDATE razorpay_order SET razorpay_payment_id = ?').run('new-attempt');
    return { items: [{ status: 'failed' }] };
  });
  await failPayment();
  expect(record.status).toBe('pending');
  expect(sendEmail).not.toHaveBeenCalled();
});

it.each([400, 404])('acknowledges a permanent provider %i without modifying the order', async (statusCode) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchPayments.mockRejectedValue(Object.assign(new Error('Invalid order'), { statusCode }));
  await failPayment();
  expect(record.status).toBe('created');
  expect(execSql).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
});

it.each([401, 403, 429, 500])('requests retry on provider %i while listing attempts', async (statusCode) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchPayments.mockRejectedValue(Object.assign(new Error('Provider unavailable'), { statusCode }));
  await failPayment(503);
  expect(record.status).toBe('created');
  expect(execSql).not.toHaveBeenCalled();
  expect(sendEmail).not.toHaveBeenCalled();
});

it.each([{}, { items: [] }, { count: 2, items: [{ status: 'failed' }] }])(
  'requests retry for an incomplete attempts response %j',
  async (response) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchPayments.mockResolvedValue(response);
    await failPayment(503);
    expect(execSql).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  },
);
