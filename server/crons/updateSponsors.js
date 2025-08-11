const { google } = require('googleapis');
const Sponsor = require('../entities/sponsor');

const androidpublisher = google.androidpublisher('v3');

module.exports = async () => {
  const sponsors = await Sponsor.get(Sponsor.columns, []);

  for (const sponsor of sponsors) {
    const { package_name: packageName, token, tier } = sponsor;

    try {
      const { data: purchase } = await androidpublisher.purchases.products.get({
        token,
        packageName,
        productId: tier,
      });

      await Sponsor.update(
        [
          [Sponsor.STATUS, purchase.purchaseState],
          [Sponsor.ORDER_ID, purchase.orderId],
        ],
        [Sponsor.ID, sponsor.id],
      );
    } catch (error) {
      console.error(`Error updating sponsor ${sponsor.id}:`, error);
    }
  }
};
