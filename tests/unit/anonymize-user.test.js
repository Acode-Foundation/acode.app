const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const deletedAtMigration = require('../../server/migrations/014_add_user_deleted_at');
const authGuardsMigration = require('../../server/migrations/015_add_deleted_user_auth_guards');
const { ANONYMIZED_NAME, anonymizeUser } = require('../../server/lib/anonymizeUser');

function createDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE user (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      github TEXT,
      website TEXT,
      role TEXT DEFAULT 'user',
      password TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      acode_pro INTEGER DEFAULT 0,
      pro_purchase_token TEXT,
      pro_purchased_at TEXT,
      github_id TEXT UNIQUE,
      google_id TEXT UNIQUE,
      avatar_url TEXT,
      x TEXT,
      linkedin TEXT,
      primary_auth TEXT,
      deleted_at TEXT
    );
    CREATE TABLE login (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES user(id),
      token TEXT
    );
    CREATE TABLE app_auth_code (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES user(id),
      code TEXT
    );
    CREATE TABLE otp (id INTEGER PRIMARY KEY, email TEXT UNIQUE, otp TEXT);
    CREATE TABLE payment_method (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES user(id),
      paypal_email TEXT,
      bank_name TEXT,
      bank_ifsc_code TEXT,
      bank_swift_code TEXT,
      bank_account_number TEXT,
      bank_account_holder TEXT,
      bank_account_type TEXT,
      wallet_address TEXT,
      wallet_type TEXT,
      is_default INTEGER,
      is_deleted INTEGER
    );
    CREATE TABLE plugin (id TEXT PRIMARY KEY, user_id INTEGER REFERENCES user(id), name TEXT);
    CREATE TABLE comment (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES user(id),
      plugin_id TEXT NOT NULL REFERENCES plugin(id),
      comment TEXT
    );
    CREATE TABLE sponsor (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id), name TEXT, email TEXT);
    CREATE TABLE purchase_order (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES user(id),
      plugin_id TEXT REFERENCES plugin(id),
      order_id TEXT
    );
    CREATE TABLE razorpay_order (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES user(id), order_id TEXT);
    CREATE TABLE payment (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES user(id),
      payment_method_id INTEGER NOT NULL REFERENCES payment_method(id),
      amount INTEGER
    );
    CREATE TABLE user_earnings (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES user(id),
      payment_id INTEGER REFERENCES payment(id),
      amount INTEGER
    );

    INSERT INTO user VALUES (
      1, 'Normal User', 'normal@example.com', 'normal-gh', 'https://example.com', 'user', 'old-password', 1, 1,
      'pay_token', '2026-07-01', 'gh-1', 'google-1', 'https://example.com/avatar.png', 'normal_x', 'normal-linkedin', 'github', NULL
    );
    INSERT INTO user VALUES (
      2, 'Admin User', 'admin@example.com', NULL, NULL, 'admin', 'admin-password', 1, 0,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'email', NULL
    );
    INSERT INTO login VALUES (1, 1, 'session-token'), (2, 2, 'admin-session');
    INSERT INTO app_auth_code VALUES (1, 1, 'auth-code');
    INSERT INTO otp VALUES (1, 'normal@example.com', '123456');
    INSERT INTO payment_method VALUES (
      1, 1, 'paypal@example.com', 'Bank', 'IFSC', 'SWIFT', '1234567890', 'Normal User', 'Savings', 'wallet-address', 'btc', 1, 0
    );
    INSERT INTO plugin VALUES ('plugin.one', 1, 'Plugin One');
    INSERT INTO comment VALUES (1, 1, 'plugin.one', 'Retained comment');
    INSERT INTO sponsor VALUES (1, 1, 'Public Sponsor', 'sponsor@example.com');
    INSERT INTO purchase_order VALUES (1, 1, 'plugin.one', 'purchase-1');
    INSERT INTO razorpay_order VALUES (1, 1, 'razorpay-1');
    INSERT INTO payment VALUES (1, 1, 1, 500);
    INSERT INTO user_earnings VALUES (1, 1, 1, 500);
  `);
  return db;
}

describe('user anonymization', () => {
  let db;

  beforeEach(() => {
    db = createDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it('scrubs access and personal data while retaining relational history', () => {
    const result = anonymizeUser(db, 1, { disabledPasswordHash: 'disabled-password' });

    expect(result).toEqual({ id: 1, status: 'anonymized', alreadyAnonymized: false });
    expect(db.prepare('SELECT COUNT(*) AS count FROM login WHERE user_id = 1').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM app_auth_code WHERE user_id = 1').get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM otp WHERE email = 'normal@example.com'").get().count).toBe(0);

    const user = db.prepare('SELECT * FROM user WHERE id = 1').get();
    expect(user).toMatchObject({
      name: ANONYMIZED_NAME,
      password: 'disabled-password',
      verified: 0,
      acode_pro: 0,
      pro_purchase_token: null,
      primary_auth: null,
      pro_purchased_at: '2026-07-01',
    });
    expect(user.email).toMatch(/^deleted-user-1-[0-9a-f-]{36}@acode\.invalid$/);
    expect(user.deleted_at).toBeTruthy();
    for (const field of ['github', 'website', 'github_id', 'google_id', 'avatar_url', 'x', 'linkedin']) {
      expect(user[field]).toBeNull();
    }

    expect(db.prepare('SELECT * FROM payment_method WHERE id = 1').get()).toMatchObject({
      paypal_email: null,
      bank_name: null,
      bank_ifsc_code: null,
      bank_swift_code: null,
      bank_account_number: null,
      bank_account_holder: null,
      bank_account_type: null,
      wallet_address: null,
      wallet_type: null,
      is_default: 0,
      is_deleted: 1,
    });

    for (const table of ['plugin', 'comment', 'sponsor', 'purchase_order', 'razorpay_order', 'payment', 'user_earnings']) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count).toBe(1);
    }
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('is repeatable and allows the original email to register again', () => {
    const first = anonymizeUser(db, 1, { disabledPasswordHash: 'disabled-one' });
    const firstUser = db.prepare('SELECT email, deleted_at FROM user WHERE id = 1').get();
    const second = anonymizeUser(db, 1, { disabledPasswordHash: 'disabled-two' });
    const secondUser = db.prepare('SELECT email, deleted_at FROM user WHERE id = 1').get();

    expect(first.alreadyAnonymized).toBe(false);
    expect(second).toEqual({ id: 1, status: 'anonymized', alreadyAnonymized: true });
    expect(secondUser).toEqual(firstUser);
    expect(() =>
      db.prepare("INSERT INTO user (id, name, email, password) VALUES (3, 'New User', 'normal@example.com', 'password')").run(),
    ).not.toThrow();
  });

  it('avoids predictable and randomly generated tombstone email collisions', () => {
    const firstUuid = '00000000-0000-4000-8000-000000000001';
    const secondUuid = '00000000-0000-4000-8000-000000000002';
    db.prepare("INSERT INTO user (id, name, email, password) VALUES (3, 'Predictable', 'deleted-user-1@acode.invalid', 'password')").run();
    db.prepare('INSERT INTO user (id, name, email, password) VALUES (?, ?, ?, ?)').run(
      4,
      'Random collision',
      `deleted-user-1-${firstUuid}@acode.invalid`,
      'password',
    );

    const uuidSpy = vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(firstUuid).mockReturnValueOnce(secondUuid);
    try {
      expect(anonymizeUser(db, 1, { disabledPasswordHash: 'disabled-password' })).toEqual({
        id: 1,
        status: 'anonymized',
        alreadyAnonymized: false,
      });
    } finally {
      uuidSpy.mockRestore();
    }

    expect(db.prepare('SELECT email FROM user WHERE id = 1').get().email).toBe(`deleted-user-1-${secondUuid}@acode.invalid`);
  });

  it('does not modify admin accounts and reports missing users', () => {
    expect(anonymizeUser(db, 2)).toEqual({ id: 2, status: 'admin' });
    expect(db.prepare('SELECT name, email, deleted_at FROM user WHERE id = 2').get()).toEqual({
      name: 'Admin User',
      email: 'admin@example.com',
      deleted_at: null,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM login WHERE user_id = 2').get().count).toBe(1);
    expect(anonymizeUser(db, 999)).toEqual({ status: 'not_found' });
  });

  it('rolls back all changes if any scrub step fails', () => {
    db.exec(`CREATE TRIGGER reject_payment_scrub
      BEFORE UPDATE ON payment_method
      BEGIN
        SELECT RAISE(ABORT, 'forced scrub failure');
      END`);

    expect(() => anonymizeUser(db, 1)).toThrow('forced scrub failure');
    expect(db.prepare('SELECT name, email, deleted_at FROM user WHERE id = 1').get()).toEqual({
      name: 'Normal User',
      email: 'normal@example.com',
      deleted_at: null,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM login WHERE user_id = 1').get().count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM app_auth_code WHERE user_id = 1').get().count).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM otp WHERE email = 'normal@example.com'").get().count).toBe(1);
  });

  it('treats anonymized rows as inactive', () => {
    anonymizeUser(db, 1);

    expect(db.prepare('SELECT id FROM user WHERE id = 1 AND deleted_at IS NULL').get()).toBeUndefined();
    expect(db.prepare("SELECT id FROM user WHERE email = 'normal@example.com' AND deleted_at IS NULL").get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM user WHERE deleted_at IS NULL').get().count).toBe(1);
  });
});

describe('user deletion migrations', () => {
  it('keeps migration 14 limited to the deleted_at column and index', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE login (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id));
      CREATE TABLE app_auth_code (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id));
    `);

    deletedAtMigration.up(db);
    deletedAtMigration.up(db);

    expect(
      db
        .prepare('PRAGMA table_info(user)')
        .all()
        .some((column) => column.name === 'deleted_at'),
    ).toBe(true);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_deleted_at'").get()).toEqual({
      name: 'idx_user_deleted_at',
    });
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('login_reject_deleted_user', 'app_auth_code_reject_deleted_user')",
        )
        .all(),
    ).toEqual([]);
    db.close();
  });

  it('installs migration 15 on a version 14 database without changing deleted users', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, email TEXT, deleted_at TEXT);
      CREATE TABLE login (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id));
      CREATE TABLE app_auth_code (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id));
      INSERT INTO schema_version (version, name) VALUES (14, 'add_user_deleted_at');
      INSERT INTO user (id, name, email, deleted_at) VALUES
        (1, 'Active', 'active@example.com', NULL),
        (2, 'Deleted User', 'deleted-user-2@example.invalid', '2026-08-14 00:00:00');
    `);
    const deletedUserBefore = db.prepare('SELECT * FROM user WHERE id = 2').get();

    authGuardsMigration.up(db);
    authGuardsMigration.up(db);

    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('login_reject_deleted_user', 'app_auth_code_reject_deleted_user') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: 'app_auth_code_reject_deleted_user' }, { name: 'login_reject_deleted_user' }]);
    expect(db.prepare('SELECT * FROM user WHERE id = 2').get()).toEqual(deletedUserBefore);
    expect(() => db.prepare('INSERT INTO login (id, user_id) VALUES (1, 1)').run()).not.toThrow();
    expect(() => db.prepare('INSERT INTO app_auth_code (id, user_id) VALUES (1, 1)').run()).not.toThrow();
    expect(() => db.prepare('INSERT INTO login (id, user_id) VALUES (2, 2)').run()).toThrow('Cannot create a session for a deleted user');
    expect(() => db.prepare('INSERT INTO app_auth_code (id, user_id) VALUES (2, 2)').run()).toThrow(
      'Cannot create an authorization code for a deleted user',
    );
    db.close();
  });

  it('applies migrations 14 and 15 safely to a fresh database', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE login (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id));
      CREATE TABLE app_auth_code (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id));
      INSERT INTO user (id, name) VALUES (1, 'Active'), (2, 'Deleted');
    `);

    deletedAtMigration.up(db);
    authGuardsMigration.up(db);
    deletedAtMigration.up(db);
    authGuardsMigration.up(db);
    db.prepare('UPDATE user SET deleted_at = CURRENT_TIMESTAMP WHERE id = 2').run();

    expect(() => db.prepare('INSERT INTO login (id, user_id) VALUES (1, 1)').run()).not.toThrow();
    expect(() => db.prepare('INSERT INTO app_auth_code (id, user_id) VALUES (1, 1)').run()).not.toThrow();
    expect(() => db.prepare('INSERT INTO login (id, user_id) VALUES (2, 2)').run()).toThrow('Cannot create a session for a deleted user');
    expect(() => db.prepare('INSERT INTO app_auth_code (id, user_id) VALUES (2, 2)').run()).toThrow(
      'Cannot create an authorization code for a deleted user',
    );
    db.close();
  });
});
