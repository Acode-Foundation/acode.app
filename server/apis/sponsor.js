const { Router } = require('express');
const Sponsor = require('../entities/sponsor');
const { google } = require('googleapis');
const { getWebLoggedInUser } = require('../lib/helpers');
const sendEmail = require('../lib/sendEmail');
const { saveSponsorImage, removeSponsorImage } = require('../lib/sponsorImage');
const { sponsorRegisterLimiter } = require('../lib/rateLimits');
const { VerificationException, VerificationStatus } = require('@apple/app-store-server-library');
const { getSponsorQueryOptions, getSponsorScope, getSponsorWhereClause } = require('../lib/sponsorScope');
const { verifyAppleSponsorPurchase } = require('../lib/appleSponsorPurchase');
const { bundleId, googlePackages, purchaseExpiry } = require('../lib/sponsorPurchase');
const { logSponsorError } = require('../lib/sponsorError');
const { TIER_ORDER } = require('../../shared/sponsorTiers');
const { safeSponsorWebsite } = require('../../shared/sponsorWebsite');

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

router.post('/', sponsorRegisterLimiter, async (req, res) => {
  const invalidField = validateSponsorRequest(req.body);
  if (invalidField) return res.status(400).json({ error: `Invalid sponsor ${invalidField}`, field: invalidField });
  const { name, tier, email, image, public: show = 0, website, packageName, purchaseToken, tagline } = req.body;

  let phase = 'verification';
  let filename;
  let inserted = false;
  try {
    const purchase =
      packageName === bundleId
        ? await verifyAppleSponsorPurchase(purchaseToken, tier)
        : (await androidpublisher.purchases.products.get({ packageName, productId: tier, token: purchaseToken })).data;

    if (purchase.purchaseState !== Sponsor.STATE_PURCHASED || !purchase.orderId || (purchase.quantity ?? 1) !== 1) {
      return res.status(403).json({ error: 'Purchase not valid' });
    }

    const expiresAt = purchaseExpiry(packageName === bundleId ? purchase.purchaseDate : Number(purchase.purchaseTimeMillis));
    phase = 'registration';
    const [existingRow] = await Sponsor.get(
      [Sponsor.ID, Sponsor.EXPIRES_AT, Sponsor.STATUS],
      [
        [Sponsor.PACKAGE_NAME, packageName],
        [Sponsor.ORDER_ID, purchase.orderId],
      ],
    );

    if (existingRow) {
      if (packageName === bundleId && existingRow.status === Sponsor.STATE_CANCELED) {
        return res.status(403).json({ error: 'Purchase not valid' });
      }
      if (packageName !== bundleId && existingRow.expires_at == null) {
        await Sponsor.refreshPurchase(existingRow.id, purchase);
      }
      return res.status(200).json({ message: 'Sponsorship already registered' });
    }

    // The purchase is already paid, so an unusable image only drops the logo.
    filename = image ? await saveSponsorImage(image) : null;
    if (image && !filename) {
      console.warn('Unsupported sponsor image; saving without a logo.');
    }

    const hideSandbox = purchase.sandbox && process.env.NODE_ENV !== 'development';
    const insertValues = [
      [Sponsor.NAME, name.trim()],
      [Sponsor.TIER, tier],
      [Sponsor.EMAIL, email || ''],
      [Sponsor.PUBLIC, (show === true || show === 1) && !hideSandbox ? 1 : 0],
      [Sponsor.IMAGE, filename],
      [Sponsor.WEBSITE, safeSponsorWebsite(website)],
      [Sponsor.TAGLINE, tagline],
      [Sponsor.TOKEN, packageName === bundleId ? '' : purchaseToken],
      [Sponsor.PACKAGE_NAME, packageName],
      [Sponsor.ORDER_ID, purchase.orderId],
      [Sponsor.STATUS, purchase.purchaseState],
    ];

    insertValues.push([Sponsor.EXPIRES_AT, expiresAt]);

    const rows = await Sponsor.insertPurchase(...insertValues);
    inserted = rows.length > 0;

    if (email && inserted && !purchase.sandbox) {
      void sendEmail(
        email,
        name,
        'Thank you for sponsoring Acode',
        'Acode team appreciate your support. Thank you for being a valued sponsor!',
      ).catch((error) => logSponsorError('email', error));
    }

    res.status(inserted ? 201 : 200).json({ message: 'Thank you for becoming a sponsor!' });
  } catch (error) {
    logSponsorError(phase, error);
    if (error?.code === 'SQLITE_BUSY' || error?.code === 'SQLITE_LOCKED') {
      return res.status(503).json({ error: 'Sponsor storage is temporarily busy. Please retry.' });
    }
    if (phase === 'registration') {
      return res.status(500).json({ error: 'Could not register sponsorship. Please retry.' });
    }
    const invalidApple =
      error?.code === 'INVALID_SPONSOR_PURCHASE' ||
      (error instanceof VerificationException && error.status !== VerificationStatus.RETRYABLE_VERIFICATION_FAILURE);
    const googleStatus = error?.response?.status || error?.code;
    const invalidGoogle = packageName !== bundleId && [400, 404, 410].includes(Number(googleStatus));
    if (invalidApple || invalidGoogle) return res.status(403).json({ error: 'Purchase not valid' });
    return res.status(503).json({ error: 'Purchase verification is temporarily unavailable. Please retry.' });
  } finally {
    if (filename && !inserted) {
      await removeSponsorImage(filename).catch((error) => logSponsorError('image cleanup', error));
    }
  }
});

function validateSponsorRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'request';
  for (const [field, max, required] of [
    ['name', 200, true],
    ['packageName', 255, true],
    ['purchaseToken', 32768, true],
    ['email', 320],
    ['website', 2048],
    ['tagline', 500],
    ['image', 2 * 1024 * 1024],
  ]) {
    const value = body[field];
    if (!required && value == null) continue;
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return field;
  }
  if (body.packageName !== bundleId && !googlePackages.includes(body.packageName)) return 'packageName';
  if (!TIER_ORDER.includes(body.tier)) return 'tier';
  if (body.website?.trim() && !safeSponsorWebsite(body.website)) return 'website';
  if (![undefined, true, false, 0, 1].includes(body.public)) return 'public';
  return null;
}

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
