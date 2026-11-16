const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { canDeleteReview } = require('../../server/lib/pluginReview');
const voteCounterMigration = require('../../server/migrations/014_add_plugin_review_vote_triggers');

it('counts legacy written reviews using the same whitespace rule as the client', async () => {
  const db = new Database(':memory:');
  const loadEntity = (name, dependencies) => {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, `../../server/entities/${name}.js`), 'utf8'), {
      module,
      console,
      process: { env: { HOST: 'https://example.test' } },
      require(name) {
        if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
        return dependencies[name];
      },
    });
    return module.exports;
  };
  try {
    db.exec(`CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, email TEXT, github TEXT, website TEXT, verified INTEGER);
      CREATE TABLE comment (id INTEGER PRIMARY KEY, plugin_id TEXT, comment TEXT);`);
    const Entity = loadEntity('entity', { '../lib/db': db });
    const plugin = loadEntity('plugin', { './entity': Entity });
    db.prepare('INSERT INTO plugin (id) VALUES (?)').run('example');
    const insert = db.prepare('INSERT INTO comment (plugin_id, comment) VALUES (?, ?)');
    // All ECMAScript whitespace, plus a mixed legacy value. No live database is opened.
    const whitespace = [
      ...'\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff',
    ];
    const comments = [null, '', ...whitespace, whitespace.join('')];
    for (const comment of comments) insert.run('example', comment);
    const count = async () => (await plugin.get([plugin.COMMENT_COUNT], [plugin.ID, 'example']))[0].comment_count;
    expect(await count()).toBe(0);
    // Zero-width space and NEL are not stripped by String.trim(); do not over-filter them.
    const written = ['Useful', ' \tWorks\nwell\u00a0 ', '\u200b', '\u0085'];
    for (const comment of written) insert.run('example', comment);
    expect(await count()).toBe([...comments, ...written].filter((comment) => comment?.trim()).length);
    expect(await count()).toBe(written.length);
  } finally {
    db.close();
  }
});

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
