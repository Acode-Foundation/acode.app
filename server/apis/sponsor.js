const { Router } = require('express');
const { writeFile, mkdir } = require('node:fs/promises');
const Sponsor = require('../entities/sponsor');
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const { google } = require('googleapis');

const router = Router();
const androidpublisher = google.androidpublisher('v3');
const sponsorImagesPath = resolve(__dirname, '../../data/sponsors');

router.get('/', async (req, res) => {
  const { page, limit } = req.query;

  const rows = await Sponsor.get(Sponsor.safeColumns, [[Sponsor.STATUS, Sponsor.STATE_PURCHASED]], { page, limit });

  res.send(rows);
});

router.post('/', async (req, res) => {
  const { name, tier, email, image, public: show = 0, website, packageName, purchaseToken } = req.body;

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
    const { data: purchase } = await androidpublisher.purchases.products.get({
      packageName,
      productId: tier,
      token: purchaseToken,
    });

    const filename = `${crypto.randomUUID()}.png`;
    const path = resolve(sponsorImagesPath, filename);

    if (!existsSync(sponsorImagesPath)) {
      await mkdir(sponsorImagesPath, { recursive: true });
    }

    await writeFile(path, image.split(';base64,')[1], { encoding: 'base64' });
    await Sponsor.insert(
      [Sponsor.NAME, name],
      [Sponsor.TIER, tier],
      [Sponsor.EMAIL, email],
      [Sponsor.PUBLIC, show],
      [Sponsor.IMAGE, filename],
      [Sponsor.WEBSITE, website],
      [Sponsor.TOKEN, purchaseToken],
      [Sponsor.PACKAGE_NAME, packageName],
      [Sponsor.ORDER_ID, purchase.orderId],
      [Sponsor.STATUS, purchase.purchaseState],
    );

    res.status(201).json({ message: 'Thank you for becoming a sponsor!' });
  } catch (error) {
    console.error('Error processing sponsorship:', error);
    res.status(403).json({ error: 'Purchase not valid' });
  }
});

module.exports = router;
