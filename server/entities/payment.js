const Entity = require('./entity');
const db = require('../lib/db');
const maskedEmail = require('../lib/maskedEmail');
const earningsReview = require('../lib/earningsReview');

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
  PAYMENT_METHOD_TYPE = 'payment_method_type';
  WALLET_TYPE = 'wallet_type';
  WALLET_ADDRESS = 'wallet_address';
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

  /**
   * Starts a payout and marks its earnings as part of it, or does neither. A payout whose earnings still
   * look unpaid would be paid again by the next run. Holds and the amount are checked here again, because
   * they can change after the balance was calculated. A month that was saved twice is never paid.
   * @param {object} payout
   * @param {number} payout.id
   * @param {number} payout.userId
   * @param {number} payout.amount
   * @param {number} payout.paymentMethodId
   * @param {string} payout.dateFrom YYYY-MM-DD
   * @param {string} payout.dateTo YYYY-MM-DD
   * @param {number[]} payout.earningIds the unpaid user_earnings rows that make up the amount
   */
  initiate({ id, userId, amount, paymentMethodId, dateFrom, dateTo, earningIds }) {
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM app_config WHERE key GLOB ? LIMIT 1').get(earningsReview.holdPattern(userId))) {
        throw Object.assign(new Error(`Earnings of user ${userId} were held while their payout was being created. Nothing was paid.`), {
          code: 'EARNINGS_UNDER_REVIEW',
          statusCode: 409,
        });
      }

      db.prepare(
        `INSERT INTO payment (id, user_id, amount, status, payment_method_id, date_from, date_to)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, userId, amount, this.STATUS_INITIATED, paymentMethodId, dateFrom, dateTo);
      const { changes } = db
        .prepare(
          `UPDATE user_earnings SET payment_id = ?
           WHERE user_id = ? AND payment_id IS NULL AND id IN (SELECT value FROM json_each(?))`,
        )
        .run(id, userId, JSON.stringify(earningIds));
      const repeated = db
        .prepare(
          `SELECT year, month FROM user_earnings
           WHERE user_id = ? AND (year, month) IN (SELECT year, month FROM user_earnings WHERE payment_id = ?)
           GROUP BY year, month HAVING COUNT(*) > 1`,
        )
        .all(userId, id);
      if (repeated.length) {
        // Databases from before migration 020 may contain these, also with one of the rows already paid.
        const months = repeated.map(({ year, month }) => `${year}-${String(month + 1).padStart(2, '0')}`).join(', ');
        throw Object.assign(
          new Error(`Earnings of user ${userId} were saved more than once for ${months}. Nothing was paid; remove the wrong row.`),
          {
            code: 'EARNINGS_UNDER_REVIEW',
            statusCode: 409,
          },
        );
      }

      const { total } = db.prepare('SELECT SUM(amount) AS total FROM user_earnings WHERE payment_id = ?').get(id);
      // Compared in paise. Saved amounts are rounded one by one, so their sum may be off by one.
      const amountMatches = Math.abs(Math.round(total * 100) - Math.round(amount * 100)) <= 1;
      if (!changes || changes !== earningIds.length || !amountMatches) {
        throw new Error(`Earnings of user ${userId} changed while their payout was being created. Nothing was paid.`);
      }
    }).immediate();
  }

  // eslint-disable-next-line class-methods-use-this
  extendGetSql(sql) {
    return `SELECT 
        c.*,
        u.name as user_name,
        u.email as user_email,
        pm.type as payment_method_type,
        pm.bank_name,
        ${maskedEmail('pm.paypal_email')} as paypal_email,
        '••••' || substr(pm.bank_account_number, -4) as bank_account_number,
        pm.wallet_type,
        substr(pm.wallet_address, 1, 4) || '...' || substr(pm.wallet_address, -4) as wallet_address
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
      this.PAYMENT_METHOD_TYPE,
      this.WALLET_TYPE,
      this.WALLET_ADDRESS,
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
