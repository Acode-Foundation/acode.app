const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MAX_PROMOTIONS, PromotionValidationError, validatePromotions } = require('./promotions');

const IMPORT_KEY = 'promotions_json_imported';
function importPromotions(db, filename = path.resolve(__dirname, '../../data/promotions.json')) {
  if (db.prepare('SELECT value FROM app_config WHERE key=?').get(IMPORT_KEY)) return { status: 'complete', imported: 0 };
  let content;
  try {
    content = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing', imported: 0, filename };
    return { status: 'unreadable', imported: 0, filename, error: error.message };
  }
  let rows;
  try {
    rows = validatePromotions(JSON.parse(content));
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof PromotionValidationError)) throw error;
    return { status: 'invalid', imported: 0, filename, error: error.message };
  }
  return db
    .transaction(() => {
      if (db.prepare('SELECT value FROM app_config WHERE key=?').get(IMPORT_KEY)) return { status: 'complete', imported: 0 };
      const existing = db.prepare('SELECT url, position, archived FROM promotion').all();
      const urls = new Set(existing.map((row) => new URL(row.url).href));
      let active = existing.filter((row) => !row.archived).length;
      let position = Math.max(-1, ...existing.map((row) => row.position)) + 1;
      let imported = 0;
      for (const row of rows) {
        const url = new URL(row.url).href;
        if (urls.has(url)) continue;
        const archived = active >= MAX_PROMOTIONS;
        db.prepare('INSERT INTO promotion(id,url,label,icon,link_text,position,archived) VALUES(?,?,?,?,?,?,?)').run(
          randomUUID(),
          row.url,
          row.label,
          row.icon,
          row.link_text,
          position++,
          Number(archived),
        );
        urls.add(url);
        if (!archived) active++;
        imported++;
      }
      db.prepare('INSERT INTO app_config(key,value) VALUES(?,?)').run(IMPORT_KEY, new Date().toISOString());
      return { status: 'complete', imported };
    })
    .immediate();
}
module.exports = importPromotions;
