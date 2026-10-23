const Entity = require('./entity');

const table = `CREATE TABLE IF NOT EXISTS promotion (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  label TEXT NOT NULL,
  icon TEXT NOT NULL,
  link_text TEXT NOT NULL,
  position INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;

class Promotion extends Entity {
  ID = 'id';
  URL = 'url';
  LABEL = 'label';
  ICON = 'icon';
  LINK_TEXT = 'link_text';
  POSITION = 'position';
  ARCHIVED = 'archived';
  CREATED_AT = 'created_at';

  constructor() {
    super(table);
  }
}

module.exports = new Promotion();
