module.exports = {
  version: 12,
  name: 'add_sponsor_expires_at',
  up(db) {
    const hasColumn = db
      .prepare('PRAGMA table_info(sponsor)')
      .all()
      .some((c) => c.name === 'expires_at');
    if (!hasColumn) {
      db.exec('ALTER TABLE sponsor ADD COLUMN expires_at timestamp');
    }
    db.exec("UPDATE sponsor SET expires_at = datetime(created_at, '+30 days') WHERE status = 0 AND expires_at IS NULL");
  },
};
