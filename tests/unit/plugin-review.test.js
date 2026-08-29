const Database = require('better-sqlite3');
const { canDeleteReview } = require('../../server/lib/pluginReview');
const voteCounterMigration = require('../../server/migrations/014_add_plugin_review_vote_triggers');

function createReviewDatabase({ votesUp = 0, votesDown = 0, existingVote } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE plugin (
      id TEXT PRIMARY KEY,
      votes_up INTEGER DEFAULT 0,
      votes_down INTEGER DEFAULT 0
    );
    CREATE TABLE comment (
      id INTEGER PRIMARY KEY,
      plugin_id TEXT NOT NULL REFERENCES plugin(id),
      comment TEXT NOT NULL,
      vote INTEGER DEFAULT 0
    );
  `);
  db.prepare('INSERT INTO plugin (id, votes_up, votes_down) VALUES (?, ?, ?)').run('test.plugin', votesUp, votesDown);
  if (existingVote !== undefined) {
    db.prepare('INSERT INTO comment (plugin_id, comment, vote) VALUES (?, ?, ?)').run('test.plugin', 'Existing review', existingVote);
  }
  return db;
}

function getVoteCounts(db) {
  return db.prepare('SELECT votes_up, votes_down FROM plugin WHERE id = ?').get('test.plugin');
}

describe('plugin review counter triggers', () => {
  it('updates counters for insert, vote transition, comment edit, and deletion', () => {
    const db = createReviewDatabase();
    voteCounterMigration.up(db);

    const inserted = db.prepare('INSERT INTO comment (plugin_id, comment, vote) VALUES (?, ?, ?)').run('test.plugin', 'Useful', 1);
    expect(getVoteCounts(db)).toEqual({ votes_up: 1, votes_down: 0 });

    db.prepare('UPDATE comment SET comment = ? WHERE id = ?').run('Still useful', inserted.lastInsertRowid);
    expect(getVoteCounts(db)).toEqual({ votes_up: 1, votes_down: 0 });

    db.prepare('UPDATE comment SET vote = ? WHERE id = ?').run(-1, inserted.lastInsertRowid);
    expect(getVoteCounts(db)).toEqual({ votes_up: 0, votes_down: 1 });

    db.prepare('DELETE FROM comment WHERE id = ?').run(inserted.lastInsertRowid);
    expect(getVoteCounts(db)).toEqual({ votes_up: 0, votes_down: 0 });
    db.close();
  });

  it('does not recalculate historical counters when installed', () => {
    const db = createReviewDatabase({ votesUp: 7, votesDown: 4, existingVote: 1 });

    voteCounterMigration.up(db);

    expect(getVoteCounts(db)).toEqual({ votes_up: 7, votes_down: 4 });
    db.close();
  });

  it('rolls back the review when its counter update fails', () => {
    const db = createReviewDatabase();
    voteCounterMigration.up(db);
    db.exec(`
      CREATE TRIGGER reject_plugin_vote_update
      BEFORE UPDATE OF votes_up, votes_down ON plugin
      BEGIN
        SELECT RAISE(ABORT, 'forced counter failure');
      END;
    `);

    expect(() => db.prepare('INSERT INTO comment (plugin_id, comment, vote) VALUES (?, ?, ?)').run('test.plugin', 'Useful', 1)).toThrow(
      /forced counter failure/,
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM comment').get()).toEqual({ count: 0 });
    expect(getVoteCounts(db)).toEqual({ votes_up: 0, votes_down: 0 });
    db.close();
  });
});

describe('plugin review deletion authorization', () => {
  const comment = { user_id: 7 };

  it('allows owners from app or web sessions', () => {
    expect(canDeleteReview(comment, { id: 7, authType: 'app' })).toBe(true);
    expect(canDeleteReview(comment, { id: 7, authType: 'web' })).toBe(true);
  });

  it('keeps cross-user administration web-only', () => {
    expect(canDeleteReview(comment, { id: 9, isAdmin: true, authType: 'web' })).toBe(true);
    expect(canDeleteReview(comment, { id: 9, isAdmin: true, authType: 'app' })).toBe(false);
    expect(canDeleteReview(comment, { id: 9, authType: 'app' })).toBe(false);
  });
});
