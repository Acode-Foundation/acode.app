module.exports = {
  version: 8,
  name: 'add_refunding_status',
  up(db) {
    db.exec(`
      CREATE TABLE razorpay_order_new (
        id INTEGER PRIMARY KEY,
        razorpay_order_id VARCHAR(255) NOT NULL UNIQUE,
        razorpay_payment_id VARCHAR(255),
        user_id INTEGER NOT NULL,
        plugin_id INTEGER,
        product_type TEXT NOT NULL CHECK (product_type IN ('plugin', 'acode_pro')),
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        amount_inr INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'refunding', 'refunded', 'cancelled')),
        receipt TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES user(id),
        FOREIGN KEY (plugin_id) REFERENCES plugin(id)
      )
    `);
    db.exec('INSERT INTO razorpay_order_new SELECT * FROM razorpay_order');
    db.exec('DROP TABLE razorpay_order');
    db.exec('ALTER TABLE razorpay_order_new RENAME TO razorpay_order');
    db.exec(`CREATE TRIGGER IF NOT EXISTS razorpay_order_updated_at
      AFTER UPDATE ON razorpay_order
      FOR EACH ROW
      BEGIN
        UPDATE razorpay_order SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
      END`);
  },
};
