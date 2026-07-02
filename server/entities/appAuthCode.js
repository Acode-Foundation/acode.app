const Entity = require('./entity');
const db = require('../lib/db');

const table = `create table if not exists app_auth_code (
  id integer primary key,
  user_id integer not null,
  code text not null unique,
  state text not null,
  challenge text not null,
  app_version_code integer,
  used boolean default false,
  created_at timestamp default current_timestamp,
  expired_at date not null,
  foreign key (user_id) references user(id)
);`;

class AppAuthCode extends Entity {
  ID = 'id';
  USER_ID = 'user_id';
  CODE = 'code';
  STATE = 'state';
  CHALLENGE = 'challenge';
  APP_VERSION_CODE = 'app_version_code';
  USED = 'used';
  CREATED_AT = 'created_at';
  EXPIRED_AT = 'expired_at';

  constructor() {
    super(table);
    const hasChallengeColumn = db
      .prepare('PRAGMA table_info(app_auth_code)')
      .all()
      .some((column) => column.name === 'challenge');
    if (!hasChallengeColumn) {
      db.exec('ALTER TABLE app_auth_code ADD COLUMN challenge text');
    }
  }

  get columns() {
    return [this.ID, this.USER_ID, this.CODE, this.STATE, this.CHALLENGE, this.APP_VERSION_CODE, this.USED, this.CREATED_AT, this.EXPIRED_AT];
  }

  markUsed(id) {
    const result = db.prepare(`UPDATE ${this.table} SET used = 1 WHERE id = ? AND used = 0`).run(id);
    return result.changes === 1;
  }
}

module.exports = new AppAuthCode();
