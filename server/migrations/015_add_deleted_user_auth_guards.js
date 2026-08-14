module.exports = {
  version: 15,
  name: 'add_deleted_user_auth_guards',
  up(db) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS login_reject_deleted_user
      BEFORE INSERT ON login
      FOR EACH ROW
      WHEN (SELECT deleted_at FROM user WHERE id = NEW.user_id) IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'Cannot create a session for a deleted user');
      END;

      CREATE TRIGGER IF NOT EXISTS app_auth_code_reject_deleted_user
      BEFORE INSERT ON app_auth_code
      FOR EACH ROW
      WHEN (SELECT deleted_at FROM user WHERE id = NEW.user_id) IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'Cannot create an authorization code for a deleted user');
      END;
    `);
  },
};
