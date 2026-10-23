const Entity = require('./entity');
require('./promotion');

const table = `CREATE TABLE IF NOT EXISTS promotion_click_day (
  promotion_id TEXT NOT NULL REFERENCES promotion(id),
  day TEXT NOT NULL,
  origin TEXT NOT NULL,
  device TEXT NOT NULL,
  os TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(promotion_id, day, origin, device, os)
);`;

class PromotionClickDay extends Entity {
  PROMOTION_ID = 'promotion_id';
  DAY = 'day';
  ORIGIN = 'origin';
  DEVICE = 'device';
  OS = 'os';
  CLICKS = 'clicks';

  constructor() {
    super(table);
  }
}

module.exports = new PromotionClickDay();
