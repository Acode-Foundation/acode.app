const Entity = require('./entity');
const db = require('../lib/db');

const table = `create table if not exists otp (
  id integer primary key,
  email text not null unique,
  otp text not null,
  created_at timestamp default current_timestamp,
  attempts integer not null default 0
)`;

class Otp extends Entity {
  ID = 'id';
  EMAIL = 'email';
  OTP = 'otp';
  CREATED_AT = 'created_at';
  ATTEMPTS = 'attempts';

  constructor() {
    super(table);
  }

  get columns() {
    return [this.ID, this.EMAIL, this.OTP, this.CREATED_AT, this.ATTEMPTS];
  }

  /**
   * Count one verification attempt against the code for `email`, in a single
   * statement so parallel guesses can't share an attempt.
   * @returns {{ id: number, otp: string, created_at: string } | undefined} the row, unless it is missing or out of attempts
   */
  claimAttempt(email, maxAttempts) {
    return db
      .prepare(`UPDATE ${this.table} SET attempts = attempts + 1 WHERE email = ? AND attempts < ? RETURNING id, otp, created_at`)
      .get(email, maxAttempts);
  }

  /** Delete the row only if it still holds `otp`, so a code is consumed at most once. */
  consume(id, otp) {
    return db.prepare(`DELETE FROM ${this.table} WHERE id = ? AND otp = ?`).run(id, otp).changes === 1;
  }
}

module.exports = new Otp();
