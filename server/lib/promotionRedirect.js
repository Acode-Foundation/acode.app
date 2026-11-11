const { recordClick } = require('./promotions');
const { promotionSiteOrigin } = require('./promotionHost');

module.exports = function createPromotionRedirect(getDb = () => require('./db'), count = recordClick) {
  return (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    try {
      const db = getDb();
      const promotion = db.prepare('SELECT url FROM promotion WHERE id=?').get(req.params.id);
      if (!promotion) {
        const origin = promotionSiteOrigin(req);
        if (!origin) return res.status(404).send('Promotion not found');
        res.vary('Host');
        return res.redirect(302, `${origin}/`);
      }
      try {
        count(req.params.id, req, db);
      } catch (error) {
        console.error('Promotion click recording failed:', error.message);
      }
      return res.redirect(302, promotion.url);
    } catch (error) {
      return next(error);
    }
  };
};
