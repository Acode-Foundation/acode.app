const Entity = require('./entity');

const table = `CREATE TABLE IF NOT EXISTS payment (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  receipt TEXT,
  payment_method_id INTEGER NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id),
  FOREIGN KEY (payment_method_id) REFERENCES payment_method(id)
);

CREATE TRIGGER IF NOT EXISTS payment_updated_at
  AFTER UPDATE ON payment
  FOR EACH ROW
  BEGIN
    UPDATE payment SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
  END`;

class Payment extends Entity {
  ID = 'id';
  USER_ID = 'user_id';
  AMOUNT = 'amount';
  RECEIPT = 'receipt';
  PAYMENT_METHOD_ID = 'payment_method_id';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';
  STATUS = 'status';
  DATE_FROM = 'date_from';
  DATE_TO = 'date_to';

  USER_NAME = 'user_name';
  USER_EMAIL = 'user_email';
  BANK_NAME = 'bank_name';
  BANK_ACCOUNT_NUMBER = 'bank_account_number';
  PAYPAL_EMAIL = 'paypal_email';
  STATUS_NONE = 0;
  STATUS_PAID = 1;
  STATUS_INITIATED = 2;
  PAYMENT_METHOD_BANK_NAME = 'payment_method_bank_name';
  PAYMENT_METHOD_BANK_ACCOUNT_NUMBER = 'payment_method_bank_account_number';
  PAYMENT_METHOD_PAYPAL_EMAIL = 'payment_method_paypal_email';

  constructor() {
    super(table);
  }

  statusInt(status) {
    switch (status) {
      case 'none':
        return this.STATUS_NONE;
      case 'paid':
        return this.STATUS_PAID;
      case 'initiated':
        return this.STATUS_INITIATED;
      default:
        return this.STATUS_NONE;
    }
  }

  // eslint-disable-next-line class-methods-use-this
  extendGetSql(sql) {
    return `SELECT 
        c.*,
        u.name as user_name,
        u.email as user_email,
        pm.bank_name,
        substr(pm.paypal_email, 1, 4) || 'XXXX' || substr(pm.paypal_email, -4) as paypal_email,
        substr(pm.bank_account_number, 1, 4) || 'XXXX' || substr(pm.bank_account_number, -4) as bank_account_number
      FROM (${sql}) c
      LEFT JOIN user u ON u.id = c.user_id
      LEFT JOIN payment_method pm ON pm.id = c.payment_method_id`;
  }

  get minColumns() {
    return [
      this.ID,
      this.USER_ID,
      this.AMOUNT,
      this.BANK_NAME,
      this.BANK_ACCOUNT_NUMBER,
      this.PAYPAL_EMAIL,
      this.CREATED_AT,
      this.STATUS,
      this.DATE_FROM,
      this.DATE_TO,
    ];
  }

  get initialColumns() {
    return [
      this.ID,
      this.CREATED_AT,
      this.UPDATED_AT,
      this.USER_ID,
      this.AMOUNT,
      this.RECEIPT,
      this.DATE_FROM,
      this.DATE_TO,
      `CASE WHEN status = ${this.STATUS_NONE} THEN 'none' WHEN status = ${this.STATUS_PAID} THEN 'paid' WHEN status = ${this.STATUS_INITIATED} THEN 'initiated' END as status`,
      this.PAYMENT_METHOD_ID,
    ];
  }
}

module.exports = new Payment();
