module.exports = {
  version: 20,
  name: 'add_earnings_indexes',
  up(db) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_payment_method_user ON payment_method (user_id, is_deleted, is_default);
      CREATE INDEX IF NOT EXISTS idx_purchase_order_plugin_created ON purchase_order (plugin_id, created_at);`);

    // A second row for the same month would be paid as well, so two processes must not be able to add one.
    const duplicates = db.prepare('SELECT user_id, year, month FROM user_earnings GROUP BY user_id, year, month HAVING COUNT(*) > 1').all();
    if (!duplicates.length) {
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_earnings_user_period ON user_earnings (user_id, year, month)');
      return;
    }

    // Which row is right is a decision about money, and the server has to start. Existing duplicates are
    // refused by Payment.initiate; this keeps new ones out, as the unique index would.
    console.warn('Earnings saved more than once, their developers are not paid until one row is removed:', JSON.stringify(duplicates));
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_earnings_user_period ON user_earnings (user_id, year, month);
      CREATE TRIGGER IF NOT EXISTS user_earnings_unique_month BEFORE INSERT ON user_earnings
      WHEN EXISTS (SELECT 1 FROM user_earnings WHERE user_id = new.user_id AND year = new.year AND month = new.month)
      BEGIN SELECT RAISE(ABORT, 'Earnings of this month are already saved'); END;`);
  },
};
