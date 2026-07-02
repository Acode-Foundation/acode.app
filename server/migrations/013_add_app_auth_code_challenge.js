module.exports = {
  version: 13,
  name: 'add_app_auth_code_challenge',
  up(db) {
    db.exec(`create table if not exists app_auth_code (
      id integer primary key,
      user_id integer not null,
      code text not null unique,
      state text not null,
      challenge text,
      app_version_code integer,
      used boolean default false,
      created_at timestamp default current_timestamp,
      expired_at date not null,
      foreign key (user_id) references user(id)
    )`);

    const hasColumn = db
      .prepare('PRAGMA table_info(app_auth_code)')
      .all()
      .some((c) => c.name === 'challenge');
    if (!hasColumn) {
      db.exec('ALTER TABLE app_auth_code ADD COLUMN challenge text');
    }
  },
};
