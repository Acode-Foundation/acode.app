import Database from 'better-sqlite3';

const migration = require('../../server/migrations/020_add_earnings_indexes');
let db;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE payment_method (id INTEGER PRIMARY KEY, user_id INTEGER, is_deleted INTEGER, is_default INTEGER);
    CREATE TABLE purchase_order (id INTEGER PRIMARY KEY, plugin_id TEXT, created_at TEXT);
    CREATE TABLE user_earnings (id INTEGER PRIMARY KEY, user_id INTEGER, year INTEGER, month INTEGER, amount INTEGER);
    INSERT INTO user_earnings (user_id, year, month, amount) VALUES (7, 2026, 8, 10);`);
});
afterEach(() => db.close());

const plan = (sql) =>
  db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map(({ detail }) => detail)
    .join();
const addSame = () => db.prepare('INSERT INTO user_earnings (user_id, year, month, amount) VALUES (7, 2026, 8, 10)').run();

it('indexes the payout queries and allows each month to be saved once', () => {
  migration.up(db);
  migration.up(db);
  expect(plan('SELECT * FROM payment_method WHERE user_id = 1 AND is_deleted = 0')).toContain('idx_payment_method_user');
  expect(plan('SELECT * FROM user_earnings WHERE user_id = 1 AND year = 1 AND month = 1')).toContain('idx_user_earnings_user_period');
  expect(plan("SELECT * FROM purchase_order WHERE plugin_id IN ('a') AND created_at >= 'b' AND created_at < 'c'")).toContain(
    'idx_purchase_order_plugin_created',
  );
  expect(addSame).toThrow('UNIQUE');
});

it('reports duplicate months without keeping the server from starting or changing money', () => {
  addSame();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  migration.up(db);
  expect(warn.mock.calls[0][1]).toBe('[{"user_id":7,"year":2026,"month":8}]');
  expect(db.prepare('SELECT COUNT(*) AS count FROM user_earnings').get().count).toBe(2);
  // New duplicates are refused although the unique index could not be created.
  expect(addSame).toThrow('already saved');
  db.prepare('INSERT INTO user_earnings (user_id, year, month, amount) VALUES (7, 2026, 9, 10)').run();
  db.exec('UPDATE user_earnings SET amount = 11 WHERE month = 8');
  expect(plan('SELECT * FROM user_earnings WHERE user_id = 1 AND year = 1 AND month = 1')).toContain('idx_user_earnings_user_period');
  warn.mockRestore();
});
