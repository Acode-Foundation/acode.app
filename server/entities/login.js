const Entity = require('./entity');

const table = `create table if not exists login (
  id integer primary key,
  user_id integer not null,
  token text not null,
  created_at timestamp default current_timestamp,
  expired_at date,
  foreign key (user_id) references user(id)
);`;

class Login extends Entity {
  ID = 'id';
  USER_ID = 'user_id';
  TOKEN = 'token';
  IP = 'ip';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';
  EXPIRED_AT = 'expired_at';

  constructor() {
    super(table);
  }

  get columns() {
    return [this.ID, this.USER_ID, this.TOKEN, this.IP, this.CREATED_AT, this.UPDATED_AT];
  }
}

module.exports = new Login();
