const { Router } = require('express');
const { writeFile, mkdir } = require('node:fs/promises');
const Sponsor = require('../entities/sponsor');
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const { google } = require('googleapis');
const moment = require('moment');
const { getLoggedInUser, sendNotification } = require('../lib/helpers');

const router = Router();
const androidpublisher = google.androidpublisher('v3');
const sponsorImagesPath = resolve(__dirname, '../../data/sponsors');

router.get('/', async (req, res) => {
  const { page, limit } = req.query;

  const rows = await Sponsor.get(
    Sponsor.safeColumns,
    [
      [Sponsor.STATUS, Sponsor.STATE_PURCHASED],
      [Sponsor.PUBLIC, 1],
      [Sponsor.CREATED_AT, moment().add(-30, 'days').toISOString(), '>'],
    ],
    { page, limit },
  );

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

    if (image) {
      await writeFile(path, image.split(';base64,')[1], { encoding: 'base64' });
    }

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

    if (email) {
      sendNotification(email, name, 'Thank you for sponsoring Acode', `We appreciate your support, ${name}. Thank you for being a valued sponsor!`);
    }

    res.status(201).json({ message: 'Thank you for becoming a sponsor!' });
  } catch (error) {
    console.error('Error processing sponsorship:', error);
    res.status(403).json({ error: 'Purchase not valid' });
  }
});

router.delete('/:id', async (req, res) => {
  const loggedInUser = await getLoggedInUser(req);

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
