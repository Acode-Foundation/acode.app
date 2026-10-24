const { Router } = require('express');
const Sponsor = require('../entities/sponsor');
const { google } = require('googleapis');
const { getWebLoggedInUser } = require('../lib/helpers');
const sendEmail = require('../lib/sendEmail');
const { saveSponsorImage } = require('../lib/sponsorImage');
const { getSponsorQueryOptions, getSponsorScope, getSponsorWhereClause } = require('../lib/sponsorScope');

const router = Router();
const androidpublisher = google.androidpublisher('v3');

router.get('/{:top}', async (req, res) => {
  let page;
  let limit;
  const param = req.params.top;
  const isTop = param === 'top';
  const scope = param ? 'active' : getSponsorScope(req.query.scope);
  if (!scope) {
    return res.status(400).json({ error: 'Invalid sponsor scope' });
  }
  const whereClause = getSponsorWhereClause(Sponsor, scope);

  if (!param) {
    page = req.query.page;
    limit = req.query.limit;
  } else if (isTop) {
    whereClause.push([Sponsor.TIER, 'titanium']);
  } else if (/^\d+$/.test(param)) {
    const [sponsor] = await Sponsor.get(Sponsor.safeColumns, [[Sponsor.ID, param], ...whereClause]);
    if (!sponsor) {
      return res.status(404).json({ error: 'Sponsor not found' });
    }
    return res.json(sponsor);
  } else {
    return res.status(404).json({ error: 'Not found' });
  }

  const options = getSponsorQueryOptions(Sponsor, scope, { page, limit });
  const rows = await Sponsor.get(Sponsor.safeColumns, whereClause, options);

  if (isTop) {
    if (!rows.length) {
      res.send(null);
      return;
    }

    const randomTop = Math.floor(Math.random() * rows.length);
    res.send(rows[randomTop]);
    return;
  }

  res.send(rows);
});

router.post('/', async (req, res) => {
  const { name, tier, email, image, public: show = 0, website, packageName, purchaseToken, tagline } = req.body;

  if (!name) {
    return res.status(400).json({
      error: 'Missing required field: name',
    });
  }

  if (!purchaseToken) {
    return res.status(400).json({
      error: 'Missing required field: purchaseToken',
    });
  }

  if (!packageName) {
    return res.status(400).json({
      error: 'Missing required field: packageName',
    });
  }

  try {
    const [existingRow] = await Sponsor.get([Sponsor.ID], [[Sponsor.TOKEN, purchaseToken]]);

    if (existingRow) {
      return res.status(400).json({
        error: 'Invalid request, token already consumed',
      });
    }

    const { data: purchase } = await androidpublisher.purchases.products.get({
      packageName,
      productId: tier,
      token: purchaseToken,
    });

    // The purchase is already paid, so an unusable image only drops the logo.
    const filename = image ? await saveSponsorImage(image) : null;
    if (image && !filename) {
      console.warn(`Sponsor "${name}" uploaded an image that is not a supported image; saving without it.`);
    }

    const insertValues = [
      [Sponsor.NAME, name],
      [Sponsor.TIER, tier],
      [Sponsor.EMAIL, email],
      [Sponsor.PUBLIC, show ? 1 : 0],
      [Sponsor.IMAGE, filename],
      [Sponsor.WEBSITE, website],
      [Sponsor.TAGLINE, tagline],
      [Sponsor.TOKEN, purchaseToken],
      [Sponsor.PACKAGE_NAME, packageName],
      [Sponsor.ORDER_ID, purchase.orderId],
      [Sponsor.STATUS, purchase.purchaseState],
    ];

    if (purchase.purchaseState === Sponsor.STATE_PURCHASED) {
      insertValues.push([Sponsor.EXPIRES_AT, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()]);
    }

    await Sponsor.insert(...insertValues);

    if (email) {
      sendEmail(email, name, 'Thank you for sponsoring Acode', 'Acode team appreciate your support. Thank you for being a valued sponsor!');
    }

    res.status(201).json({ message: 'Thank you for becoming a sponsor!' });
  } catch (error) {
    console.error('Error processing sponsorship:', error);
    res.status(403).json({ error: 'Purchase not valid' });
  }
});

router.delete('/:id', async (req, res) => {
  const loggedInUser = await getWebLoggedInUser(req);

  if (!loggedInUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (loggedInUser.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { id } = req.params;

  try {
    await Sponsor.delete([Sponsor.ID, id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting sponsor:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
