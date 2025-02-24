const Entity = require('./entity');

const table = `CREATE TABLE IF NOT EXISTS payment_method (
  id INTEGER PRIMARY KEY,
  paypal_email TEXT,
  bank_name TEXT,
  bank_ifsc_code TEXT,
  bank_swift_code TEXT,
  bank_account_number TEXT,
  user_id INTEGER NOT NULL,
  bank_account_holder TEXT,
  bank_account_type TEXT DEFAULT 'Savings',
  wallet_address TEXT,
  wallet_type TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_default INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES user(id)
);

CREATE TRIGGER IF NOT EXISTS payment_method_updated_at
  AFTER UPDATE ON payment_method
  FOR EACH ROW
  BEGIN
    UPDATE payment_method SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
  END`;

class PaymentMethod extends Entity {
  ID = 'id';
  BANK_NAME = 'bank_name';
  PAYPAL_EMAIL = 'paypal_email';
  BANK_ACCOUNT_NUMBER = 'bank_account_number';
  BANK_ACCOUNT_HOLDER = 'bank_account_holder';
  BANK_ACCOUNT_TYPE = 'bank_account_type';
  BANK_IFSC_CODE = 'bank_ifsc_code';
  BANK_SWIFT_CODE = 'bank_swift_code';
  USER_ID = 'user_id';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';
  IS_DEFAULT = 'is_default';
  IS_DELETED = 'is_deleted';
  WALLET_ADDRESS = 'wallet_address';
  WALLET_TYPE = 'wallet_type';

  BANK_ACCOUNT_TYPE_SAVINGS = 'Savings';
  BANK_ACCOUNT_TYPE_CURRENT = 'Current';

  USER_NAME = 'user_name';
  USER_EMAIL = 'user_email';

  constructor() {
    super(table);
  }

  get columns() {
    return [
      this.ID,
      this.USER_ID,
      this.CREATED_AT,
      this.PAYPAL_EMAIL,
      "substr(bank_account_number, 1, 4) || 'XXXX' || substr(bank_account_number, -4) as bank_account_number",
      this.BANK_ACCOUNT_TYPE,
      "substr(wallet_address, 1, 4) || '...' || substr(wallet_address, -4) as wallet_address",
      this.WALLET_TYPE,
      this.IS_DEFAULT,
    ];
  }

  /**
   * Extend user to the select query
   * @param {string} sql
   * @param {string[]} values
   */
  // eslint-disable-next-line class-methods-use-this
  extendGetSql(sql) {
    return `SELECT c.*, u.name as user_name, u.email as user_email FROM (${sql}) c
      LEFT JOIN user u ON c.user_id = u.id`;
  }
}

module.exports = new PaymentMethod();
