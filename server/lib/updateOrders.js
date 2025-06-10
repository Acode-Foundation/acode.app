const PurchaseOrder = require('../entities/purchaseOrder');
const Plugin = require('../entities/plugin');

const args = process.argv.slice(2);
const startDateArg = args[0];
const endDateArg = args[1];

if (startDateArg && endDateArg) {
  (async () => {
    const path = require('node:path');
    const { google } = require('googleapis');
    const { config } = require('dotenv');
    const setAuth = require('../lib/gapis');
    config({ path: path.resolve(__dirname, '../.env') });
    await setAuth();

    await updateOrder(startDateArg, endDateArg, google);
  })();
}

/**
 * Update order state, order_id and amount
 * @param {string} startDate start date in YYYY-MM-DD format
 * @param {string} endDate end date in YYYY-MM-DD format
 * @param {string} google googleapis object
 */
async function updateOrder(startDate, endDate, google) {
  const androidpublisher = google.androidpublisher('v3');
  const orders = await PurchaseOrder.for('internal').get([PurchaseOrder.CREATED_AT, [startDate, endDate], 'BETWEEN']);

  await Promise.all(
    orders.map(async (order) => {
      const { package: packageName, plugin_id: pluginId, order_id: orderId, id: rowId, token, state } = order;

      const [plugin] = await Plugin.get([Plugin.SKU], [Plugin.ID, pluginId]);
      if (!plugin) {
        console.log(`Plugin ${pluginId} not found`);
        return;
      }

      const purchase = await androidpublisher.purchases.products.get({
        packageName,
        token,
        productId: plugin.sku,
      });

      const { purchaseState, orderId: purchaseOrderId } = purchase.data;
      const updates = [];

      if (!orderId) {
        updates.push([PurchaseOrder.ORDER_ID, purchaseOrderId]);
      }

      if (purchaseState !== state) {
        updates.push([PurchaseOrder.STATE, purchaseState]);
      }

      if (purchaseState !== PurchaseOrder.STATE_PURCHASED) {
        updates.push([PurchaseOrder.AMOUNT, 0]);
      }

      if (updates.length) {
        await PurchaseOrder.update(updates, [PurchaseOrder.ID, rowId]);
      }
    }),
  );
}

module.exports = updateOrder;
