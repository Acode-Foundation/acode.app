const Entity = require('./entity');

const table = `create table if not exists otp (
  id integer primary key,
  email text not null unique,
  otp text not null,
  created_at timestamp default current_timestamp
)`;

class Otp extends Entity {
  ID = 'id';
  EMAIL = 'email';
  OTP = 'otp';
  CREATED_AT = 'created_at';

  constructor() {
    super(table);
  }

  get columns() {
    return [this.ID, this.USER_ID, this.OTP, this.CREATED_AT];
  }
}

module.exports = new Otp();
