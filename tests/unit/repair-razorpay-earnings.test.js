const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const repairScript = path.resolve(__dirname, '../../scripts/repair-razorpay-earnings.js');
let tempDir;

function createDatabase({ state = 0, paymentStatus = null } = {}) {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acode-razorpay-repair-'));
  const dbPath = path.join(tempDir, 'db.sqlite3');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE plugin (id INTEGER, user_id INTEGER);
    CREATE TABLE purchase_order (
      id INTEGER, plugin_id INTEGER, order_id TEXT, provider TEXT,
      currency TEXT, state INTEGER, amount REAL, created_at TEXT
    );
    CREATE TABLE razorpay_order (razorpay_order_id TEXT, amount_inr REAL);
    CREATE TABLE payment (id INTEGER, amount REAL, status INTEGER);
    CREATE TABLE user_earnings (
      id INTEGER, user_id INTEGER, year INTEGER, month INTEGER,
      amount REAL, payment_id INTEGER
    );
    CREATE TABLE app_config (key TEXT, value TEXT);
    CREATE TABLE user (id INTEGER, name TEXT);
    INSERT INTO user VALUES (7, 'Test Developer');
    INSERT INTO plugin VALUES (1, 7);
    INSERT INTO purchase_order VALUES (1, 1, 'order_1', 'razorpay', 'USD', ${state}, ${state === 1 ? 0 : 2}, '2026-06-10');
    INSERT INTO razorpay_order VALUES ('order_1', 200);
    INSERT INTO app_config VALUES ('payment_threshold', '15000');`);

  if (state !== 1) {
    const paymentId = paymentStatus === null ? null : 10;
    db.prepare('INSERT INTO user_earnings VALUES (?, ?, ?, ?, ?, ?)').run(20, 7, 2026, 5, 1.4, paymentId);
    if (paymentId) db.prepare('INSERT INTO payment VALUES (?, ?, ?)').run(paymentId, 1.4, paymentStatus);
  }
  db.close();
  return dbPath;
}

function createSharedPaymentDatabase() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acode-razorpay-repair-'));
  const dbPath = path.join(tempDir, 'db.sqlite3');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE plugin (id INTEGER, user_id INTEGER);
    CREATE TABLE purchase_order (
      id INTEGER, plugin_id INTEGER, order_id TEXT, provider TEXT,
      currency TEXT, state INTEGER, amount REAL, created_at TEXT
    );
    CREATE TABLE razorpay_order (razorpay_order_id TEXT, amount_inr REAL);
    CREATE TABLE payment (id INTEGER, amount REAL, status INTEGER);
    CREATE TABLE user_earnings (
      id INTEGER, user_id INTEGER, year INTEGER, month INTEGER,
      amount REAL, payment_id INTEGER
    );
    CREATE TABLE app_config (key TEXT, value TEXT);
    CREATE TABLE user (id INTEGER, name TEXT);
    INSERT INTO user VALUES (7, 'Test Developer');
    INSERT INTO plugin VALUES (1, 7);
    INSERT INTO purchase_order VALUES
      (1, 1, 'order_1', 'razorpay', 'USD', 0, 30000, '2026-05-10'),
      (2, 1, 'order_2', 'razorpay', 'USD', 0, 2, '2026-06-10');
    INSERT INTO razorpay_order VALUES
      ('order_1', 10000),
      ('order_2', 14287.7142857);
    INSERT INTO payment VALUES (10, 20000, 2);
    INSERT INTO user_earnings VALUES
      (20, 7, 2026, 4, 15000, 10),
      (21, 7, 2026, 5, 1.4, 10);
    INSERT INTO app_config VALUES ('payment_threshold', '15000');`);
  db.close();
  return dbPath;
}

function runRepair(dbPath) {
  return spawnSync(process.execPath, [repairScript, '--db', dbPath, '--apply'], { encoding: 'utf8' });
}

function previewRepair(dbPath) {
  return spawnSync(process.execPath, [repairScript, '--db', dbPath], { encoding: 'utf8' });
}

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('repair Razorpay earnings', () => {
  it('shows the developer name in the preview', () => {
    const dbPath = createDatabase();

    const result = previewRepair(dbPath);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Test Developer');
  });

  it('repairs unpaid earnings once while preserving the charged amount and currency', () => {
    const dbPath = createDatabase();

    expect(runRepair(dbPath).status).toBe(0);
    expect(runRepair(dbPath).status).toBe(0);

    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare('SELECT amount, payment_id FROM user_earnings').get()).toEqual({ amount: 140, payment_id: null });
    expect(db.prepare('SELECT amount, currency FROM purchase_order').get()).toEqual({ amount: 2, currency: 'USD' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM razorpay_earnings_repair').get().count).toBe(1);
    db.close();
  });

  it('does not restore the amount of a canceled order', () => {
    const dbPath = createDatabase({ state: 1 });

    expect(runRepair(dbPath).status).toBe(0);

    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare('SELECT amount, currency, state FROM purchase_order').get()).toEqual({ amount: 0, currency: 'USD', state: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM razorpay_earnings_repair').get().count).toBe(0);
    db.close();
  });

  it('leaves settled payments unchanged and requires manual settlement', () => {
    const dbPath = createDatabase({ paymentStatus: 1 });

    const result = runRepair(dbPath);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('requires manual settlement');
    expect(result.stderr).toContain('Test Developer (user 7)');

    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare('SELECT amount, status FROM payment').get()).toEqual({ amount: 1.4, status: 1 });
    expect(db.prepare('SELECT amount, payment_id FROM user_earnings').get()).toEqual({ amount: 1.4, payment_id: 10 });
    expect(db.prepare('SELECT amount, currency FROM purchase_order').get()).toEqual({ amount: 2, currency: 'USD' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM razorpay_earnings_repair').get().count).toBe(0);
    db.close();
  });

  it('combines corrections across months before evaluating a shared initiated payment', () => {
    const dbPath = createSharedPaymentDatabase();

    const result = runRepair(dbPath);
    expect(result.status).toBe(0);

    const db = new Database(dbPath, { readonly: true });
    expect(db.prepare('SELECT amount, status FROM payment').get()).toEqual({ amount: 16000, status: 2 });
    expect(db.prepare('SELECT amount, payment_id FROM user_earnings ORDER BY month').all()).toEqual([
      { amount: 1000, payment_id: 10 },
      { amount: 10001.4, payment_id: 10 },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM razorpay_earnings_repair').get().count).toBe(2);
    db.close();
  });
});
