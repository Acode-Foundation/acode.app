const { google } = require('googleapis');
const Sponsor = require('../entities/sponsor');
const { bundleId } = require('../lib/sponsorPurchase');
const { refreshAppleSponsorPurchase } = require('../lib/appleSponsorPurchase');

const { logSponsorError } = require('../lib/sponsorError');

const androidpublisher = google.androidpublisher('v3');

module.exports = async () => {
  const sponsors = await Sponsor.for('internal').get(
    [Sponsor.ID, Sponsor.PACKAGE_NAME, Sponsor.TOKEN, Sponsor.TIER, Sponsor.ORDER_ID],
    [[Sponsor.PACKAGE_NAME, ['web'], 'NOT IN'], 'OR', [Sponsor.PACKAGE_NAME, null]],
  );

  let appleUnavailable = false;
  let appleFailures = 0;
  for (const sponsor of sponsors) {
    const { package_name: packageName, token, tier, order_id: orderId } = sponsor;
    if (packageName === bundleId && appleUnavailable) continue;

    try {
      const purchase =
        packageName === bundleId
          ? await refreshAppleSponsorPurchase(orderId, tier)
          : (await androidpublisher.purchases.products.get({ token, packageName, productId: tier })).data;

      if (packageName === bundleId) appleFailures = 0;
      await Sponsor.refreshPurchase(sponsor.id, purchase);
    } catch (error) {
      logSponsorError('refresh', error);
      if (packageName !== bundleId) continue;
      const status = error?.httpStatusCode;
      if (error?.code === 'APPLE_STORE_CONFIG_MISSING' || status === 401 || status === 403) {
        appleUnavailable = true;
      } else if (error?.code === 'ETIMEDOUT' || error?.name === 'TypeError' || status === 429 || status >= 500) {
        appleUnavailable = ++appleFailures >= 3;
      }
      if (appleUnavailable) console.warn('Skipping remaining Apple sponsor checks until the next daily run; Google checks will continue.');
    }
  }
};
