import Database from 'better-sqlite3';
import { getVerificationCandidates, networkOf } from '../../server/lib/verificationCandidates';

const NOW = '2026-06-01T00:00:00.000Z';
let db;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, role TEXT DEFAULT 'user', verified INTEGER DEFAULT 0,
      avatar_url TEXT, github TEXT, website TEXT, x TEXT, linkedin TEXT, created_at TEXT);
    CREATE TABLE plugin (id TEXT PRIMARY KEY, name TEXT, user_id INTEGER, status INTEGER, downloads TEXT,
      votes_up INTEGER, votes_down INTEGER, package_updated_at TEXT, created_at TEXT);
    CREATE TABLE download (id INTEGER PRIMARY KEY, plugin_id TEXT, client_ip TEXT, created_at TEXT);
    CREATE TABLE comment (id INTEGER PRIMARY KEY, plugin_id TEXT, user_id INTEGER, comment TEXT, author_reply TEXT, vote INTEGER DEFAULT 0,
      created_at TEXT DEFAULT '2026-05-10');
    CREATE TABLE plugin_scan (id INTEGER PRIMARY KEY, plugin_id TEXT, status TEXT, recommendation TEXT, created_at TEXT);
  `);
  const user = db.prepare('INSERT INTO user (id, name, role, verified, github, avatar_url, website, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  user.run(1, 'Established', 'user', 0, 'est', 'a.png', 'https://est.dev', '2025-01-01');
  user.run(2, 'Newcomer', 'user', 0, null, null, null, '2026-05-20');
  user.run(3, 'Struck', 'user', 0, 'struck', 'b.png', null, '2025-01-01');
  user.run(4, 'Already', 'user', 1, 'al', null, null, '2025-01-01');
  user.run(5, 'Admin', 'admin', 0, null, null, null, '2025-01-01');
  user.run(6, 'Only pending', 'user', 0, null, null, null, '2025-01-01');
  user.run(7, 'Gamer', 'user', 0, 'gamer', 'g.png', null, '2025-01-01');
  user.run(9, 'Fan', 'user', 0, null, null, null, '2024-01-01');

  const plugin = db.prepare('INSERT INTO plugin VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  plugin.run('est.a', 'Est A', 1, 1, '50000', 400, 20, '2026-05-01', '2025-02-01');
  plugin.run('est.b', 'Est B', 1, 1, '900', 10, 0, '2025-06-01', '2025-02-01');
  plugin.run('new.a', 'New A', 2, 1, '300', 3, 0, '2026-05-25', '2026-05-25');
  plugin.run('struck.a', 'Struck A', 3, 1, '50000', 400, 20, '2026-05-01', '2025-02-01');
  plugin.run('struck.b', 'Struck B', 3, 2, '0', 0, 0, null, '2025-02-01');
  plugin.run('al.a', 'Al A', 4, 1, '10', 0, 0, '2026-05-01', '2025-02-01');
  plugin.run('admin.a', 'Admin A', 5, 1, '99999', 0, 0, '2026-05-01', '2025-02-01');
  plugin.run('pending.a', 'Pending', 6, 0, '0', 0, 0, null, '2026-05-01');
  plugin.run('gamer.a', 'Gamer A', 7, 1, '5000', 10, 0, '2026-05-01', '2025-02-01');

  const download = db.prepare('INSERT INTO download (plugin_id, client_ip, created_at) VALUES (?, ?, ?)');
  for (let i = 0; i < 30; i++) download.run('est.a', `8.8.${i}.1`, `2026-05-${String(1 + (i % 28)).padStart(2, '0')}`);
  download.run('est.a', '8.8.8.8', '2025-01-15');
  // 120 downloads from one /24 on one day.
  for (let i = 0; i < 120; i++) download.run('gamer.a', `203.0.113.${i}`, '2026-05-20');

  // Eight sock puppets created minutes before upvoting, reviewing nothing else.
  for (let i = 0; i < 8; i++) {
    const id = 100 + i;
    user.run(id, `Puppet ${i}`, 'user', 0, null, null, null, '2026-05-20 10:00:00');
    db.prepare('INSERT INTO comment (plugin_id, user_id, comment, vote, created_at) VALUES (?, ?, ?, 1, ?)').run(
      'gamer.a',
      id,
      'best plugin',
      '2026-05-20 10:30:00',
    );
  }

  const comment = db.prepare('INSERT INTO comment (plugin_id, user_id, comment, author_reply) VALUES (?, ?, ?, ?)');
  comment.run('est.a', 9, 'great', 'thanks');
  comment.run('est.a', 9, 'bug', null);
  comment.run('est.a', 1, 'self review', null);

  db.prepare('INSERT INTO plugin_scan (plugin_id, status, recommendation, created_at) VALUES (?, ?, ?, ?)').run(
    'struck.a',
    'rejected',
    'block',
    '2026-04-01',
  );
});

afterEach(() => db.close());

it('ranks unverified developers with approved plugins and explains the score', () => {
  const { candidates } = getVerificationCandidates({ db, now: NOW });
  expect(candidates.map((c) => c.name)).toEqual(['Established', 'Gamer', 'Newcomer', 'Struck']);

  const [top] = candidates;
  expect(top.stats).toMatchObject({ plugins: 2, downloads: 50900, recentDownloads: 30, votes: 430, reviews: 2, replyRate: 50, daysSinceRelease: 31 });
  expect(top.breakdown.engagement).toBe(5);
  expect(top.ready).toBe(true);
  expect(top.suspicions).toEqual([]);
  expect(top.topPlugin).toEqual({ id: 'est.a', name: 'Est A' });
  expect(top.score).toBeCloseTo(
    Object.values(top.breakdown).reduce((a, b) => a + b, 0),
    5,
  );
});

it('penalises security strikes and flags them', () => {
  const { candidates } = getVerificationCandidates({ db, now: NOW });
  const struck = candidates.find((c) => c.name === 'Struck');
  expect(struck.penalty).toBe(33);
  expect(struck.flags).toHaveLength(3);
  expect(struck.ready).toBe(false);
  expect(struck.checks.find((c) => c.id === 'clean').pass).toBe(false);
});

it('keeps new accounts and low-vote ratings from looking ready', () => {
  const newcomer = getVerificationCandidates({ db, now: NOW }).candidates.find((c) => c.name === 'Newcomer');
  expect(newcomer.ready).toBe(false);
  expect(newcomer.checks.filter((c) => !c.pass).map((c) => c.id)).toEqual(['account', 'downloads', 'rating', 'github']);
  expect(newcomer.breakdown.quality).toBeLessThan(16);
});

it('includes already verified developers only when asked', () => {
  const { candidates } = getVerificationCandidates({ db, now: NOW, includeVerified: true });
  expect(candidates.find((c) => c.name === 'Already')).toMatchObject({ verified: true });
});

it('discounts and flags concentrated downloads, single-day spikes and throwaway votes', () => {
  const gamer = getVerificationCandidates({ db, now: NOW }).candidates.find((c) => c.name === 'Gamer');
  expect(gamer.stats).toMatchObject({ recentDownloads: 120, credibleDownloads: 25, votes: 2, discountedVotes: 8 });
  expect(gamer.suspicions).toEqual([
    expect.stringContaining('few networks'),
    expect.stringContaining('single day'),
    expect.stringContaining('brand-new accounts'),
  ]);
  expect(gamer.checks.find((c) => c.id === 'organic').pass).toBe(false);
  expect(gamer.ready).toBe(false);
});

it('does not count votes from a new account that also reviewed other developers as throwaway', () => {
  db.prepare('INSERT INTO comment (plugin_id, user_id, comment, vote, created_at) VALUES (?, ?, ?, 1, ?)').run(
    'est.a',
    100,
    'also nice',
    '2026-05-21',
  );
  const gamer = getVerificationCandidates({ db, now: NOW }).candidates.find((c) => c.name === 'Gamer');
  expect(gamer.stats.discountedVotes).toBe(7);
});

it('groups addresses by network and ignores private ones', () => {
  expect(networkOf('203.0.113.7')).toBe('203.0.113');
  expect(networkOf('203.0.113.7, 10.0.0.1')).toBe('203.0.113');
  expect(networkOf('::ffff:198.51.100.4')).toBe('198.51.100');
  expect(networkOf('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2');
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '::1', 'fd00::1', '', null]) expect(networkOf(ip)).toBeNull();
});
