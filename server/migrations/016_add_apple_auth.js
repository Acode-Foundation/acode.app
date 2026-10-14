module.exports = {
  version: 16,
  name: 'add_apple_auth',
  up(db) {
    const columns = db.prepare('PRAGMA table_info(user)').all();
    if (!columns.some((column) => column.name === 'apple_id')) db.exec('ALTER TABLE user ADD COLUMN apple_id TEXT');
    if (!columns.some((column) => column.name === 'apple_refresh_token')) db.exec('ALTER TABLE user ADD COLUMN apple_refresh_token TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS user_apple_id_unique ON user(apple_id)');
  },
};
