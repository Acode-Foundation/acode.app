const Entity = require('./entity');

const table = `CREATE TABLE IF NOT EXISTS razorpay_order (
  id INTEGER PRIMARY KEY,
  razorpay_order_id VARCHAR(255) NOT NULL UNIQUE,
  razorpay_payment_id VARCHAR(255),
  user_id INTEGER NOT NULL,
  plugin_id INTEGER,
  product_type TEXT NOT NULL CHECK (product_type IN ('plugin', 'acode_pro', 'sponsor')),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  amount_inr INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'pending', 'paid', 'failed', 'refunding', 'refunded', 'cancelled')),
  receipt TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id),
  FOREIGN KEY (plugin_id) REFERENCES plugin(id)
);

CREATE TRIGGER IF NOT EXISTS razorpay_order_updated_at
  AFTER UPDATE ON razorpay_order
  FOR EACH ROW
  BEGIN
    UPDATE razorpay_order SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
  END`;

class RazorpayOrder extends Entity {
  ID = 'id';
  RAZORPAY_ORDER_ID = 'razorpay_order_id';
  RAZORPAY_PAYMENT_ID = 'razorpay_payment_id';
  USER_ID = 'user_id';
  PLUGIN_ID = 'plugin_id';
  PRODUCT_TYPE = 'product_type';
  AMOUNT = 'amount';
  CURRENCY = 'currency';
  AMOUNT_INR = 'amount_inr';
  STATUS = 'status';
  RECEIPT = 'receipt';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';

  STATUS_CREATED = 'created';
  STATUS_PENDING = 'pending';
  STATUS_PAID = 'paid';
  STATUS_FAILED = 'failed';
  STATUS_REFUNDING = 'refunding';
  STATUS_REFUNDED = 'refunded';
  STATUS_CANCELLED = 'cancelled';

  PRODUCT_PLUGIN = 'plugin';
  PRODUCT_PRO = 'acode_pro';
  PRODUCT_SPONSOR = 'sponsor';

  constructor() {
    super(table);
  }
}

module.exports = new RazorpayOrder();
