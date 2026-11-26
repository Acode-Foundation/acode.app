const PurchaseOrder = require('../entities/purchaseOrder');
const Plugin = require('../entities/plugin');
const moment = require('moment');
const { googlePurchaseCompletion } = require('./googlePurchase');
const checkGooglePurchaseAccounting = require('./checkGooglePurchaseAccounting');

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
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

/**
 * Update order state, order_id and amount
 * @param {string} startDate start date in YYYY-MM-DD format
 * @param {string} endDate end date in YYYY-MM-DD format
 * @param {import('googleapis').GoogleApis} google googleapis object
 */
async function updateOrder(startDate, endDate, google) {
  const androidpublisher = google.androidpublisher('v3');
  const endExclusive = moment(endDate).add(1, 'day').format('YYYY-MM-DD');
  const orders = await PurchaseOrder.for('internal').get([
    [`COALESCE(${PurchaseOrder.PROVIDER}, '${PurchaseOrder.PROVIDER_GOOGLE_PLAY}')`, PurchaseOrder.PROVIDER_GOOGLE_PLAY],
    [PurchaseOrder.CREATED_AT, startDate, '>='],
    // Pending purchases can complete after the normal sync window closes.
    'OR',
    [`CAST(${PurchaseOrder.STATE} AS INTEGER)`, PurchaseOrder.STATE_PENDING],
    [PurchaseOrder.CREATED_AT, endExclusive, '<'],
  ]);

  const heldOrders = [];
  const heldEarnings = [];
  const failedOrders = [];
  for (const order of orders) {
    try {
      const { package: packageName, plugin_id: pluginId, order_id: orderId, id: rowId, token, state } = order;

      const [plugin] = await Plugin.get([Plugin.SKU, Plugin.PRICE], [Plugin.ID, pluginId]);
      if (!plugin) {
        console.log(`Plugin ${pluginId} not found`);
        failedOrders.push(rowId);
        continue;
      }

      const purchase = await androidpublisher.purchases.products.get({
        packageName,
        token,
        productId: plugin.sku,
      });

      const { purchaseState, orderId: purchaseOrderId } = purchase.data;
      const updates = [];

      if (!orderId && purchaseOrderId) {
        updates.push([PurchaseOrder.ORDER_ID, purchaseOrderId]);
      }

      if (Number(purchaseState) !== Number(state)) {
        updates.push([PurchaseOrder.STATE, Number(purchaseState)]);
      }

      if (Number(state) === PurchaseOrder.STATE_PENDING && Number(purchaseState) === PurchaseOrder.STATE_PURCHASED) {
        // Resolve the amount first so a hold is only placed for an order that can complete.
        const completion = googlePurchaseCompletion(order, plugin.price);
        const held = await checkGooglePurchaseAccounting(order);
        if (held) heldEarnings.push(`order ${rowId} (user ${held.userId}, ${held.year}-${String(held.month + 1).padStart(2, '0')})`);
        updates.push(...Object.entries(completion));
      }

      if (Number(purchaseState) !== Number(PurchaseOrder.STATE_PURCHASED)) {
        updates.push([PurchaseOrder.AMOUNT, 0]);
      }

      if (updates.length) {
        // Discard stale provider results if the API or another sync changed this order.
        await PurchaseOrder.update(updates, [
          [PurchaseOrder.ID, rowId],
          [PurchaseOrder.STATE, state],
          [PurchaseOrder.TOKEN, token],
        ]);
      }
    } catch (error) {
      console.error('Error updating order %s: %s', order.order_id, error.message);
      if (error.code === 'GOOGLE_PURCHASE_REVIEW_REQUIRED') heldOrders.push(order.id);
      else failedOrders.push(order.id);
    }
  }
  const problems = [];
  if (heldOrders.length) {
    problems.push(`Google purchases held for accounting review (purchase_order IDs): ${heldOrders.join(', ')}. No held orders were changed.`);
  }
  if (heldEarnings.length) {
    // Holds are recorded before the guarded order write; a failed/raced write may still need retry.
    problems.push(`Google purchase accounting held for review: ${heldEarnings.join(', ')}.`);
  }
  if (failedOrders.length) problems.push(`Google purchase sync failed (purchase_order IDs): ${failedOrders.join(', ')}.`);
  if (problems.length) throw new Error(problems.join(' '));
}

module.exports = updateOrder;
