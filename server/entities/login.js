const Entity = require('./entity');

const table = `create table if not exists login (
  id integer primary key,
  user_id integer not null,
  token text not null,
  type text default 'web',
  created_at timestamp default current_timestamp,
  expired_at date,
  foreign key (user_id) references user(id)
);`;

class Login extends Entity {
  ID = 'id';
  TYPE = 'type';
  TOKEN = 'token';
  USER_ID = 'user_id';
  CREATED_AT = 'created_at';
  EXPIRED_AT = 'expired_at';

  constructor() {
    super(table);
  }

  get columns() {
    return [this.ID, this.TYPE, this.USER_ID, this.TOKEN, this.CREATED_AT, this.EXPIRED_AT];
  }
}

module.exports = new Login();
