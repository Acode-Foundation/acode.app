const Module = require('node:module');
const Database = require('better-sqlite3');
const { comparePassword, encryptPassword } = require('../../server/password');
const migration = require('../../server/migrations/016_add_apple_auth');
const { logAppleError } = require('../../server/lib/appleOAuth');
let revokeAppleToken;

function loadUser(db) {
  const entityPath = require.resolve('../../server/entities/entity');
  const userPath = require.resolve('../../server/entities/user');
  delete require.cache[entityPath];
  delete require.cache[userPath];

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === '../lib/db' && parent?.filename.startsWith(`${process.cwd()}/server/entities/`)) return db;
    if (request === '../lib/appleOAuth' && parent?.filename === userPath) return { revokeAppleToken, logAppleError };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.ADMIN_NAME = 'Admin';
    process.env.ADMIN_PASSWORD = 'admin-password';
    return require(userPath);
  } finally {
    Module._load = originalLoad;
  }
}

function createDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const User = loadUser(db);

  db.exec(`
    CREATE TABLE login (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES user(id), token TEXT);
    CREATE TABLE app_auth_code (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES user(id), code TEXT);
    CREATE TABLE otp (id INTEGER PRIMARY KEY, email TEXT UNIQUE, otp TEXT);
    CREATE TABLE IF NOT EXISTS api_key (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES user(id), name TEXT, token_hash TEXT, token_prefix TEXT,
      scopes TEXT, plugin_ids TEXT, created_at TEXT, expires_at TEXT
    );
    CREATE TABLE payment_method (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES user(id), paypal_email TEXT, bank_name TEXT,
      bank_ifsc_code TEXT, bank_swift_code TEXT, bank_account_number TEXT, bank_account_holder TEXT,
      bank_account_type TEXT, wallet_address TEXT, wallet_type TEXT, is_default INTEGER, is_deleted INTEGER
    );
    CREATE TABLE plugin (id TEXT PRIMARY KEY, user_id INTEGER REFERENCES user(id), name TEXT, price REAL, status INTEGER);
    CREATE TABLE comment (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id), plugin_id TEXT REFERENCES plugin(id), comment TEXT);
    CREATE TABLE sponsor (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id), name TEXT, email TEXT, website TEXT,
      image TEXT, tagline TEXT, public INTEGER, token TEXT
    );
    CREATE TABLE purchase_order (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id), plugin_id TEXT REFERENCES plugin(id));
    CREATE TABLE razorpay_order (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id));
    CREATE TABLE payment (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id),
      payment_method_id INTEGER REFERENCES payment_method(id), status INTEGER
    );
    CREATE TABLE user_earnings (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES user(id), payment_id INTEGER REFERENCES payment(id));

    INSERT INTO user (
      id, name, email, github, website, role, password, verified, acode_pro, pro_purchase_token,
      pro_purchased_at, github_id, google_id, avatar_url, x, linkedin, primary_auth
    ) VALUES
      (2, 'Normal User', 'normal@example.com', 'github', 'https://example.com', 'user', 'password', 1, 1,
       'purchase-token', '2026-07-01', 'github-id', 'google-id', 'avatar.png', 'x-user', 'linkedin-user', 'github'),
      (65421, 'Axch1l13s', 'reported@example.com', NULL, NULL, 'user', 'password', 0, 0,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'email');
    INSERT INTO login VALUES (1, 2, 'normal-session'), (2, 65421, 'session-one'), (3, 65421, 'session-two');
    INSERT INTO app_auth_code VALUES (1, 2, 'auth-code');
    INSERT INTO otp VALUES (1, 'normal@example.com', '123456');
    INSERT INTO otp VALUES (2, 'account-delete:2:fixture-session', 'hashed-code');
    INSERT INTO otp VALUES (3, 'api-key:2:fixture-session', 'hashed-code');
    INSERT INTO api_key (id, user_id, name, token_hash, token_prefix, scopes, plugin_ids, created_at, expires_at)
      VALUES (1, 2, 'CI', 'hashed-key', 'acode_abcd', '[]', '[]', '2026-01-01', '2027-01-01');
    INSERT INTO payment_method VALUES
      (1, 2, 'paypal@example.com', 'Bank', 'IFSC', 'SWIFT', '1234', 'Normal User', 'Savings', 'wallet', 'btc', 1, 0);
    INSERT INTO plugin VALUES ('plugin.one', 2, 'Plugin One', 10, 0);
    INSERT INTO comment VALUES (1, 2, 'plugin.one', 'Keep me');
    INSERT INTO sponsor VALUES (1, 2, 'Sponsor', 'sponsor@example.com', 'https://sponsor.example.com', 'identity.png', 'Tagline', 1, 'token');
    INSERT INTO purchase_order VALUES (1, 2, 'plugin.one');
    INSERT INTO razorpay_order VALUES (1, 2);
    INSERT INTO payment VALUES (1, 2, 1, 1);
    INSERT INTO user_earnings VALUES (1, 2, 1);
  `);
  db.prepare('UPDATE user SET password = ? WHERE id IN (2, 65421)').run(encryptPassword('original-password'));

  return { db, User };
}

describe('User.delete anonymization', () => {
  let db;
  let User;

  beforeEach(() => {
    revokeAppleToken = vi.fn(async () => {});
    ({ db, User } = createDatabase());
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('fixes the reported two-session foreign-key failure and keeps the anonymized user queryable', async () => {
    expect(db.prepare('SELECT COUNT(*) count FROM login WHERE user_id = 65421').get().count).toBe(2);

    await User.delete([User.ID, 65421, '=']);

    expect(db.prepare('SELECT COUNT(*) count FROM login WHERE user_id = 65421').get().count).toBe(0);
    const [deletedUser] = await User.get([User.ID, 65421]);
    expect(deletedUser).toMatchObject({ id: 65421, name: 'Deleted User', role: 'deleted' });
    expect(deletedUser.email).toMatch(/^deleted-user-65421-[0-9a-f-]{36}@acode\.invalid$/);
    expect(comparePassword('original-password', deletedUser.password)).toBe(false);
    expect(await User.get([User.EMAIL, 'reported@example.com'])).toEqual([]);
    expect(await User.count()).toBe(3);
    expect(await User.getUsersByFilter()).toEqual([{ name: 'Normal User', email: 'normal@example.com' }]);
    expect(await User.countUsersByFilter()).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('scrubs identity and payout data while preserving relational history', async () => {
    await User.delete([User.ID, 2]);

    const row = db.prepare('SELECT * FROM user WHERE id = 2').get();
    expect(row).toMatchObject({ name: 'Deleted User', role: 'deleted', verified: 0, acode_pro: 0, pro_purchase_token: null });
    expect(row.password).toMatch(/^[0-9a-f]{64}$/);
    expect(row.password).not.toBe(encryptPassword('original-password'));
    expect(comparePassword('original-password', row.password)).toBe(false);
    expect(row.email).toMatch(/^deleted-user-2-[0-9a-f-]{36}@acode\.invalid$/);
    for (const field of [
      'github',
      'website',
      'github_id',
      'google_id',
      'apple_id',
      'apple_refresh_token',
      'avatar_url',
      'x',
      'linkedin',
      'primary_auth',
    ]) {
      expect(row[field]).toBeNull();
    }
    expect(db.prepare('SELECT * FROM payment_method WHERE id = 1').get()).toMatchObject({
      paypal_email: null,
      bank_account_number: null,
      wallet_address: null,
      is_default: 0,
      is_deleted: 1,
    });
    expect(db.prepare('SELECT * FROM sponsor WHERE id = 1').get()).toMatchObject({
      name: 'Deleted User',
      email: row.email,
      website: null,
      image: null,
      tagline: null,
      public: 0,
    });
    expect(db.prepare('SELECT COUNT(*) count FROM login WHERE user_id = 2').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) count FROM app_auth_code WHERE user_id = 2').get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) count FROM otp WHERE email = 'normal@example.com'").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) count FROM otp WHERE email LIKE 'account-delete:2:%'").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) count FROM otp WHERE email LIKE 'api-key:2:%'").get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) count FROM api_key WHERE user_id = 2').get().count).toBe(0);
    expect(await User.getUsersByFilter()).toEqual([{ name: 'Axch1l13s', email: 'reported@example.com' }]);
    expect(await User.countUsersByFilter()).toBe(1);
    for (const filter of ['with_plugins', 'with_paid_plugins', 'with_payment']) {
      expect(await User.getUsersByFilter(filter)).toEqual([]);
      expect(await User.countUsersByFilter(filter)).toBe(0);
    }
    for (const table of ['plugin', 'comment', 'sponsor', 'purchase_order', 'razorpay_order', 'payment', 'user_earnings']) {
      expect(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count).toBe(1);
    }
    expect(db.prepare("SELECT u.name FROM plugin p JOIN user u ON u.id = p.user_id WHERE p.id = 'plugin.one'").get().name).toBe('Deleted User');
    await User.update([User.NAME, 'Restored'], [User.ID, 2]);
    expect(db.prepare('SELECT name FROM user WHERE id = 2').get().name).toBe('Restored');

    await expect(User.delete([User.ID, 2])).resolves.toEqual([]);
    expect(db.prepare('SELECT name, email FROM user WHERE id = 2').get()).toEqual({ name: 'Restored', email: row.email });

    await User.insert([User.NAME, 'Replacement User'], [User.EMAIL, 'normal@example.com'], [User.PASSWORD, encryptPassword('replacement-password')]);
    expect(db.prepare("SELECT COUNT(*) count FROM user WHERE email = 'normal@example.com'").get().count).toBe(1);
  });

  it('rejects broad deletion conditions without changing matching users', async () => {
    await expect(User.delete([User.ROLE, 'user'])).rejects.toThrow('User deletion requires an exact ID condition');
    await expect(
      User.delete([
        [User.ID, 2],
        [User.ID, 65421],
      ]),
    ).rejects.toThrow('User deletion requires an exact ID condition');

    expect(db.prepare("SELECT id, name, role FROM user WHERE role = 'user' ORDER BY id").all()).toEqual([
      { id: 2, name: 'Normal User', role: 'user' },
      { id: 65421, name: 'Axch1l13s', role: 'user' },
    ]);
    expect(db.prepare('SELECT COUNT(*) count FROM login').get().count).toBe(3);
  });

  it.each(['Apple unavailable', 'missing credential'])('still erases the account when revocation fails: %s', async (failure) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = failure === 'missing credential' ? null : 'encrypted-refresh-token';
    db.prepare('UPDATE user SET apple_id = ?, apple_refresh_token = ? WHERE id = 2').run('apple-sub', token);
    revokeAppleToken.mockRejectedValueOnce(new Error(`${failure}: sensitive-provider-response`));
    await expect(User.delete([User.ID, 2])).resolves.toEqual([]);
    if (token) expect(revokeAppleToken).toHaveBeenCalledWith(token);
    else expect(revokeAppleToken).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Apple account deletion revocation failed:', expect.objectContaining({ reason: expect.any(String) }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive-provider-response');
    expect(JSON.stringify(log.mock.calls)).not.toContain('encrypted-refresh-token');
    expect(db.prepare('SELECT COUNT(*) count FROM login WHERE user_id = 2').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) count FROM app_auth_code WHERE user_id = 2').get().count).toBe(0);
    expect(db.prepare('SELECT role, apple_id, apple_refresh_token FROM user WHERE id = 2').get()).toEqual({
      role: 'deleted',
      apple_id: null,
      apple_refresh_token: null,
    });
  });

  it('keeps encrypted credentials out of all user projections and redacts them from SQL error logs', async () => {
    db.prepare('UPDATE user SET apple_id = ?, apple_refresh_token = ? WHERE id = 2').run('private-subject', 'encrypted-secret');
    const [safe] = await User.get(User.safeColumns, [User.ID, 2]);
    expect(safe.apple_id).toBe(1);
    for (const columns of [undefined, User.columns, User.safeColumns, User.publicColumns]) {
      const [row] = await User.get(columns, [User.ID, 2]);
      expect(row).not.toHaveProperty('apple_refresh_token');
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      db.exec(
        "CREATE TRIGGER reject_apple_credential BEFORE UPDATE OF apple_refresh_token, password ON user BEGIN SELECT RAISE(ABORT, 'forced failure'); END",
      );
      await expect(User.update([User.APPLE_REFRESH_TOKEN, 'encrypted-secret'], [User.ID, 2])).rejects.toThrow();
      await expect(User.update([User.PASSWORD, 'another-secret'], [User.ID, 2])).rejects.toThrow();
      expect(JSON.stringify(log.mock.calls)).not.toContain('encrypted-secret');
      expect(JSON.stringify(log.mock.calls)).not.toContain('another-secret');
    } finally {
      log.mockRestore();
    }
  });

  it('adds nullable unique Apple identity and nullable credential columns without changing legacy rows', () => {
    const legacy = new Database(':memory:');
    try {
      legacy.exec(
        "CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, email TEXT); INSERT INTO user VALUES (1, 'Existing', 'existing@example.com'), (2, 'Second', 'second@example.com')",
      );
      migration.up(legacy);
      migration.up(legacy);
      expect(legacy.prepare('SELECT * FROM user WHERE id = 1').get()).toEqual({
        id: 1,
        name: 'Existing',
        email: 'existing@example.com',
        apple_id: null,
        apple_refresh_token: null,
      });
      legacy.prepare('UPDATE user SET apple_id = ? WHERE id = 1').run('apple-sub');
      expect(() => legacy.prepare('UPDATE user SET apple_id = ? WHERE id = 2').run('apple-sub')).toThrow('UNIQUE');
    } finally {
      legacy.close();
    }
  });

  it('protects admins and rolls back all changes on failure', async () => {
    const admin = db.prepare("SELECT id FROM user WHERE role = 'admin'").get();
    await expect(User.delete([User.ID, admin.id])).rejects.toThrow('Admin accounts cannot be deleted');
    expect(revokeAppleToken).not.toHaveBeenCalled();

    db.prepare('UPDATE user SET apple_id = ?, apple_refresh_token = ? WHERE id = 2').run('apple-sub', 'encrypted-refresh-token');
    db.exec(`CREATE TRIGGER reject_sponsor_scrub BEFORE UPDATE ON sponsor BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
    await expect(User.delete([User.ID, 2])).rejects.toThrow('forced failure');
    expect(db.prepare('SELECT name, role FROM user WHERE id = 2').get()).toEqual({ name: 'Normal User', role: 'user' });
    expect(db.prepare('SELECT COUNT(*) count FROM login WHERE user_id = 2').get().count).toBe(1);
    expect(db.prepare('SELECT paypal_email FROM payment_method WHERE id = 1').get().paypal_email).toBe('paypal@example.com');
    db.exec('DROP TRIGGER reject_sponsor_scrub');
    await expect(User.delete([User.ID, 2])).resolves.toEqual([]);
    expect(revokeAppleToken).toHaveBeenCalledTimes(2);
    expect(db.prepare('SELECT role FROM user WHERE id = 2').get().role).toBe('deleted');
  });
});
