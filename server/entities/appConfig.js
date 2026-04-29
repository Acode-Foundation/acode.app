const Entity = require('./entity');

const table = `CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS app_config_updated_at
  AFTER UPDATE ON app_config
  FOR EACH ROW
  BEGIN
    UPDATE app_config SET updated_at = CURRENT_TIMESTAMP WHERE key = old.key;
  END`;

const DEFAULTS = {
  acode_pro_price: '370',
};

class AppConfig extends Entity {
  KEY = 'key';
  VALUE = 'value';
  UPDATED_AT = 'updated_at';

  constructor() {
    super(table);
    this.seedDefaults();
  }

  seedDefaults() {
    for (const [key, value] of Object.entries(DEFAULTS)) {
      this.insertOrIgnore([this.KEY, key], [this.VALUE, value]);
    }
  }

  async getValue(key) {
    const [row] = await this.get([this.KEY, key], { orderBy: 'updated_at DESC' });
    return row?.value ?? null;
  }

  async setValue(key, value) {
    const [existing] = await this.get([this.KEY, key], { orderBy: 'updated_at DESC' });
    if (existing) {
      return this.update([this.VALUE, String(value)], [this.KEY, key]);
    }
    return this.insert([this.KEY, key], [this.VALUE, String(value)]);
  }
}

module.exports = new AppConfig();
