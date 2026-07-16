const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');

function option(name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

const dbPath = path.resolve(option('--db', path.resolve(__dirname, '../data/db.sqlite3')));
const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
db.pragma('foreign_keys = ON');

const hasRepairLedger = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'razorpay_earnings_repair'").get());
const repairedOrderFilter = hasRepairLedger ? 'AND NOT EXISTS (SELECT 1 FROM razorpay_earnings_repair rer WHERE rer.purchase_order_id = po.id)' : '';

const orderCorrections = db
  .prepare(
    `SELECT po.id AS purchase_order_id,
            p.user_id,
            u.name AS user_name,
            CAST(strftime('%Y', po.created_at) AS INTEGER) AS year,
            CAST(strftime('%m', po.created_at) AS INTEGER) - 1 AS month,
            ROUND((ro.amount_inr - po.amount) * 0.7, 2) AS difference
       FROM purchase_order po
       JOIN plugin p ON p.id = po.plugin_id
       LEFT JOIN user u ON u.id = p.user_id
       JOIN razorpay_order ro ON ro.razorpay_order_id = po.order_id
      WHERE po.provider = 'razorpay'
        AND po.currency <> 'INR'
        AND CAST(po.state AS INTEGER) <> 1
        AND ro.amount_inr > 0
        AND ABS(ROUND((ro.amount_inr - po.amount) * 0.7, 2)) >= 0.01
        ${repairedOrderFilter}
      ORDER BY ABS(difference) DESC`,
  )
  .all();
const orderDifferences = new Map(orderCorrections.map((row) => [row.purchase_order_id, row.difference]));

const correctionsByMonth = new Map();
for (const row of orderCorrections) {
  const key = `${row.user_id}:${row.year}:${row.month}`;
  const correction = correctionsByMonth.get(key) || {
    user_id: row.user_id,
    user_name: row.user_name || '(unknown)',
    year: row.year,
    month: row.month,
    difference: 0,
    orderIds: [],
  };
  correction.difference = Math.round((correction.difference + row.difference) * 100) / 100;
  correction.orderIds.push(row.purchase_order_id);
  correctionsByMonth.set(key, correction);
}

const getEarnings = db.prepare(
  `SELECT ue.id, ue.payment_id, payment.status AS payment_status
     FROM user_earnings ue
     LEFT JOIN payment ON payment.id = ue.payment_id
    WHERE ue.user_id = ? AND ue.year = ? AND ue.month = ?
    ORDER BY ue.id`,
);
const corrections = [...correctionsByMonth.values()];
for (const correction of corrections) {
  const earningsRows = getEarnings.all(correction.user_id, correction.year, correction.month);
  correction.earnings = earningsRows.length === 1 ? earningsRows[0] : null;
  if (earningsRows.length === 0) {
    correction.action = 'future calculation';
  } else if (earningsRows.length > 1) {
    correction.action = 'manual: duplicate earnings rows';
  } else if (correction.earnings.payment_status === 1) {
    correction.action = 'manual: settled payment';
  } else if (correction.earnings.payment_status === 2) {
    correction.action = 'update initiated payment';
  } else if (correction.earnings.payment_id) {
    correction.action = 'manual: unknown payment status';
  } else {
    correction.action = 'update unpaid earnings';
  }
}

if (!apply) {
  console.table(
    corrections.map(({ orderIds, earnings: _earnings, ...correction }) => ({
      ...correction,
      orders: orderIds.length,
    })),
  );
  db.close();
  console.log(`Previewed ${corrections.length} correction(s). Run with --apply to apply safe corrections.`);
  process.exit(0);
}

const stamp = new Date().toISOString().replaceAll(':', '-');
const backupPath = `${dbPath}.before-razorpay-earnings-${stamp}-${process.pid}`;
db.close();
fs.copyFileSync(dbPath, backupPath, fs.constants.COPYFILE_EXCL);

const writableDb = new Database(dbPath, { fileMustExist: true });
writableDb.pragma('foreign_keys = ON');
const deletedPayments = [];
const manualCorrections = [];

const repair = writableDb.transaction(() => {
  writableDb.exec(`CREATE TABLE IF NOT EXISTS razorpay_earnings_repair (
    purchase_order_id INTEGER PRIMARY KEY,
    difference REAL NOT NULL,
    action TEXT NOT NULL,
    repaired_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const threshold = Number(writableDb.prepare("SELECT value FROM app_config WHERE key = 'payment_threshold'").pluck().get()) || 15000;
  const updateEarnings = writableDb.prepare('UPDATE user_earnings SET amount = ROUND(amount + ?, 2) WHERE id = ?');
  const updatePayment = writableDb.prepare('UPDATE payment SET amount = ROUND(amount + ?, 2) WHERE id = ? AND status = 2');
  const getPayment = writableDb.prepare('SELECT amount, status FROM payment WHERE id = ?');
  const unlinkEarnings = writableDb.prepare('UPDATE user_earnings SET payment_id = NULL WHERE payment_id = ?');
  const deletePayment = writableDb.prepare('DELETE FROM payment WHERE id = ? AND status = 2');
  const markOrder = writableDb.prepare('INSERT OR IGNORE INTO razorpay_earnings_repair (purchase_order_id, difference, action) VALUES (?, ?, ?)');
  const paymentCorrections = new Map();

  for (const correction of corrections) {
    if (correction.action.startsWith('manual:')) {
      manualCorrections.push(correction);
      continue;
    }

    if (correction.earnings) {
      updateEarnings.run(correction.difference, correction.earnings.id);
      if (correction.earnings.payment_status === 2) {
        const paymentId = correction.earnings.payment_id;
        const paymentCorrection = paymentCorrections.get(paymentId) || {
          difference: 0,
          user_id: correction.user_id,
          user_name: correction.user_name,
        };
        paymentCorrection.difference = Math.round((paymentCorrection.difference + correction.difference) * 100) / 100;
        paymentCorrections.set(paymentId, paymentCorrection);
      }
    }

    for (const orderId of correction.orderIds) {
      markOrder.run(orderId, orderDifferences.get(orderId), correction.action);
    }
  }

  for (const [paymentId, correction] of paymentCorrections) {
    updatePayment.run(correction.difference, paymentId);
    const payment = getPayment.get(paymentId);
    if (payment?.status !== 2) {
      throw new Error(`Initiated payment ${paymentId} disappeared or changed status during repair`);
    }
    if (payment.amount < threshold) {
      unlinkEarnings.run(paymentId);
      deletePayment.run(paymentId);
      deletedPayments.push({ id: paymentId, amount: payment.amount, threshold, user_id: correction.user_id, user_name: correction.user_name });
    }
  }
});

repair();
writableDb.close();

const applied = corrections.length - manualCorrections.length;
console.log(`Applied ${applied} correction(s) without changing purchase amounts. Backup: ${backupPath}`);
for (const payment of deletedPayments) {
  console.log(
    `Deleted initiated payment ${payment.id} for ${payment.user_name} (user ${payment.user_id}): ₹${payment.amount.toFixed(2)} is below the ₹${payment.threshold.toFixed(2)} threshold.`,
  );
}
for (const correction of manualCorrections) {
  console.error(
    `Skipped ${correction.user_name} (user ${correction.user_id})/${correction.year}-${correction.month + 1}: ₹${correction.difference.toFixed(2)} requires manual settlement (${correction.action}).`,
  );
}
if (manualCorrections.length) process.exitCode = 2;
