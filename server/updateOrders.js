const PurchaseOrder = require('./entities/purchaseOrder');
const Plugin = require('./entities/plugin');

/**
 * Update order state, order_id and amount
 * @param {string} startDate start date in YYYY-MM-DD format
 * @param {string} endDate end date in YYYY-MM-DD format
 * @param {string} google googleapis object
 */
module.exports = async function updateOrder(startDate, endDate, google) {
  const androidpublisher = google.androidpublisher('v3');
  const orders = await PurchaseOrder.for('internal').get([
    PurchaseOrder.CREATED_AT,
    [startDate, endDate],
    'BETWEEN',
  ]);

  await Promise.all(orders.map(async (order) => {
    const {
      package: packageName,
      plugin_id: pluginId,
      order_id: orderId,
      id: rowId,
      token,
      state,
    } = order;

    const [{ sku: productId }] = await Plugin.get([Plugin.SKU], [Plugin.ID, pluginId]);
    const purchase = await androidpublisher.purchases.products.get({
      packageName,
      token,
      productId,
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
  }));
};