const Database = require('better-sqlite3');
const moment = require('moment');
const { getDeveloperDashboard, DAILY_RANGE, DOWNLOAD_RETENTION_DAYS, MONTHLY_RANGE } = require('../../server/lib/developerDashboard');

let db;
const now = moment('2026-10-20 12:00:00');
const user = { id: 1 };

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE plugin (
    id TEXT PRIMARY KEY,
    name TEXT,
    price INTEGER DEFAULT 0,
    status INTEGER DEFAULT 1,
    version TEXT DEFAULT '1.0.0',
    status_change_message TEXT,
    package_updated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT '2026-01-01 00:00:00',
    downloads TEXT DEFAULT '0',
    votes_up INTEGER DEFAULT 0,
    votes_down INTEGER DEFAULT 0,
    user_id INTEGER
  );
  CREATE TABLE download (
    id INTEGER PRIMARY KEY,
    plugin_id TEXT,
    created_at TIMESTAMP
  );
  CREATE TABLE user_earnings (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    amount REAL,
    month INTEGER,
    year INTEGER,
    payment_id INTEGER
  );
  CREATE TABLE plugin_scan (
    id INTEGER PRIMARY KEY,
    plugin_id TEXT,
    version TEXT,
    status TEXT
  );`);
});

afterEach(() => {
  db.close();
});

function executeQuery(sql, values) {
  return Promise.resolve(db.prepare(sql).all(...values));
}

function insertPlugin({ id, userId = 1, price = 0, status = 1, downloads = 0, votesUp = 0, votesDown = 0 }) {
  db.prepare('INSERT INTO plugin (id, name, price, status, downloads, votes_up, votes_down, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    id,
    price,
    status,
    String(downloads),
    votesUp,
    votesDown,
    userId,
  );
}

function insertDownloads(pluginId, date, count) {
  const stmt = db.prepare('INSERT INTO download (plugin_id, created_at) VALUES (?, ?)');
  for (let i = 0; i < count; i++) stmt.run(pluginId, date);
}

describe('getDeveloperDashboard', () => {
  it('reports the newest update that is waiting for security review', async () => {
    insertPlugin({ id: 'held' });
    insertPlugin({ id: 'clean' });
    const scan = db.prepare('INSERT INTO plugin_scan (plugin_id, version, status) VALUES (?, ?, ?)');
    scan.run('held', '1.1.0', 'superseded');
    scan.run('held', '1.2.0', 'pending');
    scan.run('clean', '1.1.0', 'applied');

    const result = await getDeveloperDashboard(user, { executeQuery, now });
    const byId = Object.fromEntries(result.plugins.map((p) => [p.id, p.pendingVersion]));
    expect(byId).toEqual({ held: '1.2.0', clean: null });
  });

  it('aggregates per-plugin and daily downloads for the user only', async () => {
    insertPlugin({ id: 'a', downloads: 100, votesUp: 4, votesDown: 1 });
    insertPlugin({ id: 'b', downloads: 50, price: 99 });
    insertPlugin({ id: 'deleted', status: 3, downloads: 999 });
    insertPlugin({ id: 'other', userId: 2, downloads: 10 });

    // inserted in time order, like the real table
    insertDownloads('a', '2026-07-01 08:00:00', 7); // outside both windows
    insertDownloads('a', '2026-09-10 08:00:00', 4); // previous window
    insertDownloads('b', '2026-09-25 08:00:00', 1);
    insertDownloads('a', '2026-10-01 08:00:00', 2);
    insertDownloads('deleted', '2026-10-19 08:00:00', 8); // deleted plugins are excluded everywhere
    insertDownloads('a', '2026-10-20 08:00:00', 3);
    insertDownloads('other', '2026-10-20 08:00:00', 5);

    const result = await getDeveloperDashboard(user, { executeQuery, now });

    expect(result.totals).toMatchObject({
      plugins: 2,
      paidPlugins: 1,
      downloads: 150,
      recentDownloads: 6,
      previousDownloads: 4,
      votesUp: 4,
      votesDown: 1,
    });
    expect(result.plugins[0]).toMatchObject({ version: '1.0.0', updatedAt: '2026-01-01 00:00:00', statusMessage: '' });
    expect(result.plugins.map((p) => [p.id, p.recent, p.previous])).toEqual([
      ['a', 5, 4],
      ['b', 1, 0],
    ]);
    expect(result.daily).toHaveLength(DAILY_RANGE);
    expect(result.daily.at(-1)).toEqual({ date: '2026-10-20', count: 3 });
    expect(result.daily.find((d) => d.date === '2026-10-01').count).toBe(2);
    expect(result.daily.reduce((sum, d) => sum + d.count, 0)).toBe(6);
    expect(result.daily.find((d) => d.date === '2026-10-19').count).toBe(0);
  });

  it('reports no previous period when older downloads were already pruned', async () => {
    insertPlugin({ id: 'a', downloads: 100 });
    // oldest remaining row is inside the current window: the previous 30 days are gone
    insertDownloads('a', '2026-10-05 08:00:00', 30);
    insertDownloads('a', '2026-10-15 08:00:00', 1);

    const result = await getDeveloperDashboard(user, { executeQuery, now });

    expect(result.totals.recentDownloads).toBe(31);
    expect(result.totals.previousDownloads).toBeNull();
  });

  it('reports no previous period when there are no downloads at all', async () => {
    insertPlugin({ id: 'a' });

    const result = await getDeveloperDashboard(user, { executeQuery, now });

    expect(result.totals.previousDownloads).toBeNull();
  });

  it('keeps enough download history for the current and previous windows', () => {
    expect(DOWNLOAD_RETENTION_DAYS).toBeGreaterThanOrEqual(DAILY_RANGE * 2);
  });

  it('builds 12 months of earnings with estimates for unsettled months', async () => {
    db.prepare('INSERT INTO user_earnings (user_id, amount, month, year, payment_id) VALUES (?, ?, ?, ?, ?)').run(1, 120, 7, 2026, 3);
    db.prepare('INSERT INTO user_earnings (user_id, amount, month, year, payment_id) VALUES (?, ?, ?, ?, ?)').run(1, 500, 0, 2024, 1);
    const estimateEarnings = vi.fn(async (_year, month) => (month === 9 ? 10 : 20));

    const result = await getDeveloperDashboard(user, { executeQuery, now, estimateEarnings });

    expect(result.monthly).toHaveLength(MONTHLY_RANGE);
    expect(result.monthly[0]).toMatchObject({ year: 2025, month: 10, amount: 0 });
    expect(result.monthly.at(-1)).toMatchObject({ year: 2026, month: 9, amount: 10, estimated: true });
    expect(result.monthly.at(-2)).toMatchObject({ year: 2026, month: 8, amount: 20, estimated: true });
    expect(result.monthly.at(-3)).toMatchObject({ year: 2026, month: 7, amount: 120, estimated: false, paid: true });
    expect(result.totals.lifetimeEarnings).toBe(650);
  });

  it('keeps the stored amount for a month that has already been paid out', async () => {
    db.prepare('INSERT INTO user_earnings (user_id, amount, month, year, payment_id) VALUES (?, ?, ?, ?, ?)').run(1, 75, 9, 2026, 7);
    const estimateEarnings = vi.fn(async () => 999);

    const result = await getDeveloperDashboard(user, { executeQuery, now, estimateEarnings });

    expect(result.monthly.at(-1)).toMatchObject({ year: 2026, month: 9, amount: 75, estimated: false, paid: true });
    expect(estimateEarnings).not.toHaveBeenCalledWith(2026, 9, user);
    // last month (September) has no row, so it is still estimated
    expect(result.monthly.at(-2)).toMatchObject({ month: 8, amount: 999, estimated: true });
    expect(result.totals.lifetimeEarnings).toBe(75 + 999);
  });
});
