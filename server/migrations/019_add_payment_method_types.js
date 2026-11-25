const COLUMNS = ['type', 'bank_country', 'bank_routing_code', 'bank_address', 'bank_account_holder_address'];

module.exports = {
  version: 19,
  name: 'add_payment_method_types',
  up(db) {
    const existing = db
      .prepare('PRAGMA table_info(payment_method)')
      .all()
      .map((column) => column.name);
    for (const column of COLUMNS) {
      if (!existing.includes(column)) db.exec(`ALTER TABLE payment_method ADD COLUMN ${column} TEXT`);
    }

    db.exec(`UPDATE payment_method
      SET type = CASE
        WHEN paypal_email IS NOT NULL AND paypal_email != '' THEN 'paypal'
        WHEN wallet_address IS NOT NULL AND wallet_address != '' THEN 'wallet'
        ELSE 'bank_india'
      END
      WHERE type IS NULL`);

    // Deleting a default method that had payments used to leave it as the default, so payouts kept
    // going to it and its replacement never became the default.
    db.exec('UPDATE payment_method SET is_default = 0 WHERE is_deleted = 1 AND is_default = 1');
    db.exec(`UPDATE payment_method SET is_default = 1
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY user_id ORDER BY (type = 'bank_india') DESC, created_at DESC, id DESC
          ) AS position
          FROM payment_method
          WHERE is_deleted = 0
            AND user_id NOT IN (SELECT user_id FROM payment_method WHERE is_default = 1 AND is_deleted = 0)
        )
        WHERE position = 1
      )`);

    // Payouts join on the default, so a user must not have more than one.
    db.exec(`UPDATE payment_method SET is_default = 0
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY user_id ORDER BY (type = 'bank_india') DESC, created_at DESC, id DESC
          ) AS position
          FROM payment_method
          WHERE is_default = 1 AND is_deleted = 0
        )
        WHERE position > 1
      )`);
  },
};
