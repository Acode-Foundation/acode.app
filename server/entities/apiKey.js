const Entity = require('./entity');
const db = require('../lib/db');

// Only the SHA-256 of a key is stored. `scopes` and `plugin_ids` are JSON arrays.
const table = `create table if not exists api_key (
  id integer primary key,
  user_id integer not null,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text not null,
  plugin_ids text not null,
  created_at timestamp not null,
  expires_at timestamp not null,
  last_used_at timestamp,
  foreign key (user_id) references user(id)
);

create index if not exists api_key_user_id on api_key(user_id);`;

class ApiKey extends Entity {
  ID = 'id';
  USER_ID = 'user_id';
  NAME = 'name';
  TOKEN_HASH = 'token_hash';
  TOKEN_PREFIX = 'token_prefix';
  SCOPES = 'scopes';
  PLUGIN_IDS = 'plugin_ids';
  CREATED_AT = 'created_at';
  EXPIRES_AT = 'expires_at';
  LAST_USED_AT = 'last_used_at';

  constructor() {
    super(table);
  }

  get columns() {
    return [this.ID, this.USER_ID, this.NAME, this.TOKEN_PREFIX, this.SCOPES, this.PLUGIN_IDS, this.CREATED_AT, this.EXPIRES_AT, this.LAST_USED_AT];
  }

  /**
   * @param {string} hash
   */
  findByHash(hash) {
    const row = db.prepare(`SELECT ${this.columns.join(', ')} FROM ${this.table} WHERE token_hash = ?`).get(hash);
    return row ? parseRow(row) : null;
  }

  /**
   * @param {number} userId
   */
  listForUser(userId) {
    return db
      .prepare(`SELECT ${this.columns.join(', ')} FROM ${this.table} WHERE user_id = ? ORDER BY created_at DESC, id DESC`)
      .all(userId)
      .map(parseRow);
  }

  /**
   * Inserts a key unless the user already has `max` unexpired keys. The count and
   * insert share one transaction so parallel requests can't exceed the limit.
   * @returns {number | null} the new row id, or null when the limit is reached
   */
  createWithinLimit({ userId, name, tokenHash, tokenPrefix, scopes, pluginIds, createdAt, expiresAt }, max) {
    const create = db.transaction(() => {
      const { count } = db.prepare(`SELECT COUNT(*) AS count FROM ${this.table} WHERE user_id = ? AND expires_at > ?`).get(userId, createdAt);
      if (count >= max) return null;
      const result = db
        .prepare(
          `INSERT INTO ${this.table} (user_id, name, token_hash, token_prefix, scopes, plugin_ids, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, name, tokenHash, tokenPrefix, JSON.stringify(scopes), JSON.stringify(pluginIds), createdAt, expiresAt);
      return Number(result.lastInsertRowid);
    });
    return create.immediate();
  }

  /**
   * @returns {boolean} whether a key was deleted
   */
  revoke(id, userId) {
    return db.prepare(`DELETE FROM ${this.table} WHERE id = ? AND user_id = ?`).run(id, userId).changes === 1;
  }

  /**
   * Lets a key keep publishing a plugin it submitted. Capped like keys created by hand.
   * @returns {boolean} whether the plugin is now on the key
   */
  addPlugin(id, pluginId, max) {
    const add = db.transaction(() => {
      const row = db.prepare(`SELECT plugin_ids FROM ${this.table} WHERE id = ?`).get(id);
      if (!row) return false;
      const pluginIds = parseList(row.plugin_ids);
      if (pluginIds.includes(pluginId)) return true;
      if (pluginIds.length >= max) return false;
      db.prepare(`UPDATE ${this.table} SET plugin_ids = ? WHERE id = ?`).run(JSON.stringify([...pluginIds, pluginId].sort()), id);
      return true;
    });
    return add.immediate();
  }

  touch(id, usedAt) {
    db.prepare(`UPDATE ${this.table} SET last_used_at = ? WHERE id = ?`).run(usedAt, id);
  }

  /**
   * Expired keys stay listed for a while so users see why CI stopped working.
   * @param {string} cutoff ISO timestamp
   */
  deleteExpiredBefore(cutoff) {
    return db.prepare(`DELETE FROM ${this.table} WHERE expires_at < ?`).run(cutoff).changes;
  }
}

function parseRow(row) {
  return { ...row, scopes: parseList(row.scopes), plugin_ids: parseList(row.plugin_ids) };
}

function parseList(value) {
  try {
    const list = JSON.parse(value);
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

module.exports = new ApiKey();
