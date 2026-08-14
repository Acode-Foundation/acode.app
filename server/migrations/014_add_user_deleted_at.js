module.exports = {
  version: 14,
  name: 'add_user_deleted_at',
  up(db) {
    const hasColumn = db
      .prepare('PRAGMA table_info(user)')
      .all()
      .some((column) => column.name === 'deleted_at');

    if (!hasColumn) {
      db.exec('ALTER TABLE user ADD COLUMN deleted_at timestamp');
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_user_deleted_at ON user(deleted_at)');
  },
};
