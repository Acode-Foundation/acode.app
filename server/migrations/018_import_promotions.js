const importPromotions = require('../lib/importPromotions');

module.exports = {
  version: 18,
  name: 'import_promotions',
  up(db, filename) {
    return importPromotions(db, filename);
  },
};
