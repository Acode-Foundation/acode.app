module.exports = {
  version: 10,
  name: 'add_order_id_unique',
  up(db) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_order_order_id ON purchase_order(order_id)');
  },
};
