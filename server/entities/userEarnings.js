const Entity = require('./entity');

const table = `CREATE TABLE IF NOT EXISTS user_earnings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  payment_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id),
  FOREIGN KEY (payment_id) REFERENCES payment(id)
);

CREATE TRIGGER IF NOT EXISTS user_earnings_updated_at
  AFTER UPDATE ON user_earnings
  FOR EACH ROW
  BEGIN
    UPDATE user_earnings SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
    END`;

class UserEarnings extends Entity {
  ID = 'id';
  USER_ID = 'user_id';
  AMOUNT = 'amount';
  MONTH = 'month';
  YEAR = 'year';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';
  PAYMENT_ID = 'payment_id';

  constructor() {
    super(table);
  }
}

module.exports = new UserEarnings();
