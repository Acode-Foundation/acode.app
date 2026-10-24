module.exports = {
  version: 18,
  name: 'add_otp_attempts',
  up(db) {
    const columns = db.prepare('PRAGMA table_info(otp)').all();
    if (!columns.some((column) => column.name === 'attempts')) db.exec('ALTER TABLE otp ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
    // Codes issued before this change were stored in plain text and never expired early.
    db.exec("DELETE FROM otp WHERE email NOT LIKE 'account-delete:%' AND email NOT LIKE 'api-key:%'");
  },
};
