const Entity = require('./entity');

const table = `CREATE TABLE IF NOT EXISTS purchase_order (
  id INTEGER PRIMARY KEY,
  package TEXT NOT NULL,
  amount INTEGER NOT NULL,
  plugin_id INTEGER NOT NULL,
  order_id VARCHAR(255),
  token TEXT NOT NULL UNIQUE,
  state TEXT DEFAULT 2,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plugin_id) REFERENCES plugin(id)
);

CREATE TRIGGER IF NOT EXISTS orders_updated_at
  AFTER UPDATE ON purchase_order
  FOR EACH ROW
  BEGIN
    UPDATE purchase_order SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
    END`;

class PurchaseOrder extends Entity {
  ID = 'id';
  TOKEN = 'token';
  PACKAGE = 'package';
  PLUGIN_ID = 'plugin_id';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';
  ORDER_ID = 'order_id';
  AMOUNT = 'amount';
  STATE = 'state';

  STATE_PURCHASED = 0;
  STATE_CANCELED = 1;
  STATE_PENDING = 2;

  constructor() {
    super(table);
  }

  get minColumns() {
    return [this.PACKAGE, this.AMOUNT, this.STATE, this.CREATED_AT, this.ORDER_ID];
  }
}

module.exports = new PurchaseOrder();
