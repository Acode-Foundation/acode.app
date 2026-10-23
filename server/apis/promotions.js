const { Router } = require('express');
require('../entities/promotionClickDay');
const { listPromotions, sourceForRequest, trackingOrigin } = require('../lib/promotions');
const router = Router();
router.get('/', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    const origin = trackingOrigin();
    const source = sourceForRequest(req);
    res.json(
      listPromotions().map(({ id, label, icon, link_text }) => ({
        id,
        label,
        icon,
        link_text,
        url: `${origin}/p/${encodeURIComponent(id)}?source=${source}`,
      })),
    );
  } catch (error) {
    next(error);
  }
});
module.exports = router;
