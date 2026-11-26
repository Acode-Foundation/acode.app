const Entity = require('./entity');
const db = require('../lib/db');
const maskedEmail = require('../lib/maskedEmail');
const { IDENTITY_FIELDS, isPaymentMethodTypeAvailable } = require('../../shared/paymentMethods');

const table = `CREATE TABLE IF NOT EXISTS payment_method (
  id INTEGER PRIMARY KEY,
  type TEXT,
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
  bank_country TEXT,
  bank_routing_code TEXT,
  bank_address TEXT,
  bank_account_holder_address TEXT,
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
  TYPE = 'type';
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
  BANK_COUNTRY = 'bank_country';
  BANK_ROUTING_CODE = 'bank_routing_code';
  BANK_ADDRESS = 'bank_address';
  BANK_ACCOUNT_HOLDER_ADDRESS = 'bank_account_holder_address';

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
      this.TYPE,
      `${maskedEmail(this.PAYPAL_EMAIL)} as ${this.PAYPAL_EMAIL}`,
      this.BANK_NAME,
      this.BANK_COUNTRY,
      "'••••' || substr(bank_account_number, -4) as bank_account_number",
      this.BANK_ACCOUNT_TYPE,
      "substr(wallet_address, 1, 4) || '...' || substr(wallet_address, -4) as wallet_address",
      this.WALLET_TYPE,
      this.IS_DEFAULT,
    ];
  }

  /**
   * Add a method. It becomes the default when asked to, or when the user has no default that can be paid.
   * @param {number} userId
   * @param {string} type
   * @param {Record<string, string>} values validated details
   * @param {{makeDefault: boolean, paypalEnabled: boolean, limit: number}} options
   * @returns {'added' | 'duplicate' | 'limit'}
   */
  add(userId, type, values, { makeDefault, paypalEnabled, limit }) {
    return db
      .transaction(() => {
        const rows = db.prepare('SELECT * FROM payment_method WHERE user_id = ? AND is_deleted = 0').all(userId);
        if (rows.some((row) => row.type === type && IDENTITY_FIELDS[type].every((name) => row[name] === values[name]))) return 'duplicate';
        if (rows.length >= limit) return 'limit';

        const hasUsableDefault = rows.some((row) => row.is_default && isPaymentMethodTypeAvailable(row.type, { paypalEnabled }));
        const isDefault = makeDefault || !hasUsableDefault;
        if (isDefault) db.prepare('UPDATE payment_method SET is_default = 0 WHERE user_id = ? AND is_default = 1').run(userId);

        const columns = [...Object.keys(values), this.USER_ID, this.TYPE, this.IS_DEFAULT];
        db.prepare(`INSERT INTO payment_method (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(
          ...Object.values(values).map((value) => value || null),
          userId,
          type,
          isDefault ? 1 : 0,
        );
        return 'added';
      })
      .immediate();
  }

  /**
   * Make a method the only default of its user.
   * @param {number} userId
   * @param {number} id
   * @returns {boolean} false when the method no longer exists, which keeps the current default
   */
  setDefault(userId, id) {
    return db
      .transaction(() => {
        const { changes } = db.prepare('UPDATE payment_method SET is_default = 1 WHERE id = ? AND user_id = ? AND is_deleted = 0').run(id, userId);
        if (!changes) return false;
        db.prepare('UPDATE payment_method SET is_default = 0 WHERE user_id = ? AND id != ? AND is_default = 1').run(userId, id);
        return true;
      })
      .immediate();
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
