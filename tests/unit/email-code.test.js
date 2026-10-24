import Module, { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const migration = require('../../server/migrations/018_add_otp_attempts');

let db;
let emailCode;

beforeEach(() => {
  db = new Database(':memory:');
  emailCode = loadEmailCode(db);
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
});

const email = 'dev@example.com';

function storedRow() {
  return db.prepare('SELECT * FROM otp WHERE email = ?').get(email);
}

function age(row, ms) {
  db.prepare('UPDATE otp SET created_at = ? WHERE id = ?').run(new Date(Date.now() - ms).toISOString(), row.id);
}

it('issues a six-digit code, stores only its hash and accepts it once', async () => {
  const code = await emailCode.issueEmailCode(email, 'reset');

  expect(code).toMatch(/^\d{6}$/);
  expect(storedRow().otp).toMatch(/^[a-f0-9]{64}$/);
  expect(storedRow().otp).not.toContain(code);
  expect(emailCode.consumeEmailCode(email, 'reset', code)).toBe(true);
  expect(storedRow()).toBeUndefined();
  expect(emailCode.consumeEmailCode(email, 'reset', code)).toBe(false);
});

it('accepts codes sent as numbers or with surrounding spaces', async () => {
  const code = await emailCode.issueEmailCode(email, 'signup');
  expect(emailCode.consumeEmailCode(email, 'signup', ` ${Number(code)} `)).toBe(true);
});

it('stops accepting the right code after too many wrong guesses', async () => {
  const code = await emailCode.issueEmailCode(email, 'reset');
  const wrong = code === '123456' ? '654321' : '123456';

  for (let i = 0; i < emailCode.MAX_ATTEMPTS; i++) expect(emailCode.consumeEmailCode(email, 'reset', wrong)).toBe(false);
  expect(emailCode.consumeEmailCode(email, 'reset', code)).toBe(false);
});

it('counts malformed guesses only after they look like a code', async () => {
  const code = await emailCode.issueEmailCode(email, 'reset');

  for (const guess of ['', '12345', '1234567', 'abcdef', null, undefined, {}]) expect(emailCode.consumeEmailCode(email, 'reset', guess)).toBe(false);
  expect(storedRow().attempts).toBe(0);
  expect(emailCode.consumeEmailCode(email, 'reset', code)).toBe(true);
});

it('rejects expired codes and codes issued for another purpose or address', async () => {
  const code = await emailCode.issueEmailCode(email, 'reset');

  expect(emailCode.consumeEmailCode(email, 'signup', code)).toBe(false);
  expect(emailCode.consumeEmailCode('other@example.com', 'reset', code)).toBe(false);
  age(storedRow(), emailCode.CODE_LIFETIME_MS + 1);
  expect(emailCode.consumeEmailCode(email, 'reset', code)).toBe(false);
});

it('enforces a resend cooldown, and a new code replaces the old one', async () => {
  const first = await emailCode.issueEmailCode(email, 'reset');
  await expect(emailCode.issueEmailCode(email, 'reset')).rejects.toBeInstanceOf(emailCode.EmailCodeCooldownError);

  age(storedRow(), emailCode.RESEND_COOLDOWN_MS + 1);
  db.prepare('UPDATE otp SET attempts = 3').run();
  const second = await emailCode.issueEmailCode(email, 'reset');

  expect(storedRow().attempts).toBe(0);
  if (first !== second) expect(emailCode.consumeEmailCode(email, 'reset', first)).toBe(false);
  expect(emailCode.consumeEmailCode(email, 'reset', second)).toBe(true);
});

it('discards a code, e.g. when its email could not be sent', async () => {
  const code = await emailCode.issueEmailCode(email, 'signup');
  await emailCode.discardEmailCode(email);
  expect(emailCode.consumeEmailCode(email, 'signup', code)).toBe(false);
});

it('rejects unknown purposes', async () => {
  await expect(emailCode.issueEmailCode(email, 'login')).rejects.toThrow('Unknown email code purpose');
  expect(() => emailCode.consumeEmailCode(email, 'login', '123456')).toThrow('Unknown email code purpose');
});

it('migration adds the attempts column and clears only old sign-up and reset codes', () => {
  const legacy = new Database(':memory:');
  legacy.exec(`
    CREATE TABLE otp (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, otp TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO otp (email, otp) VALUES ('dev@example.com', '123456'), ('account-delete:7:abc', 'hash1'), ('api-key:7:def', 'hash2');
  `);

  migration.up(legacy);
  migration.up(legacy);

  expect(
    legacy
      .prepare('PRAGMA table_info(otp)')
      .all()
      .map((c) => c.name),
  ).toContain('attempts');
  expect(
    legacy
      .prepare('SELECT email FROM otp ORDER BY email')
      .all()
      .map((r) => r.email),
  ).toEqual(['account-delete:7:abc', 'api-key:7:def']);
  legacy.close();
});

function loadEmailCode(database) {
  const paths = ['../../server/entities/entity', '../../server/entities/otp', '../../server/lib/emailCode'].map((p) => require.resolve(p));
  for (const path of paths) delete require.cache[path];
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === '../lib/db' && paths.includes(parent?.filename)) return database;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(paths[2]);
  } finally {
    Module._load = originalLoad;
    for (const path of paths) delete require.cache[path];
  }
}
