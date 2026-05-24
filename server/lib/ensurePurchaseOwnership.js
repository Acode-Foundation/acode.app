const Plugin = require('../entities/plugin');
const Order = require('../entities/purchaseOrder');
const User = require('../entities/user');
const AppConfig = require('../entities/appConfig');
const getRazorpay = require('./razorpay');
const { getSubunitDigits } = require('./currencyMap');
const notifyPurchase = require('./notifyPurchase');

/**
 * Ensure a purchase_order record exists with STATE_PURCHASED for a paid Razorpay order.
 * Fetches the Razorpay order for server-authoritative notes instead of relying on payment.notes.
 */
async function ensurePurchaseOwnership(orderId, paymentId) {
  const [existingOrder] = await Order.get([Order.ORDER_ID, orderId]);
  if (existingOrder) {
    const updateCols = [];
    if (Number(existingOrder.state) !== Order.STATE_PURCHASED) {
      updateCols.push([Order.STATE, Order.STATE_PURCHASED]);
    }
    if (paymentId && !existingOrder.token) {
      updateCols.push([Order.TOKEN, paymentId]);
    }
    if (updateCols.length) {
      await Order.update(updateCols, [Order.ORDER_ID, orderId]);
    }
    return;
  }

  const rzpOrder = await getRazorpay().orders.fetch(orderId);
  const notes = rzpOrder.notes || {};
  const userId = notes.userId ? String(notes.userId) : null;
  const pluginId = notes.pluginId ? String(notes.pluginId) : null;
  const type = notes.type;

  if (type === 'acode_pro' && userId) {
    const expectedPrice = Number(await AppConfig.getValue('acode_pro_price'));
    const orderInrPrice = Number(notes.original_amount_inr);
    if (orderInrPrice && orderInrPrice !== expectedPrice) {
      console.warn(`Pro price mismatch in webhook: notes ${orderInrPrice} vs config ${expectedPrice}. Accepting.`);
    }

    const [existingUser] = await User.get(User.safeColumns, [User.ID, userId]);
    if (existingUser && existingUser.acode_pro !== 1 && existingUser.acode_pro !== true) {
      await User.update(
        [
          [User.ACODE_PRO, 1],
          [User.PRO_PURCHASE_TOKEN, paymentId],
          [User.PRO_PURCHASED_AT, new Date().toISOString()],
        ],
        [User.ID, userId],
      );
      console.log(`Activated Acode Pro for user ${userId} via webhook`);
      if (paymentId) notifyPurchase(paymentId).catch((err) => console.error('Failed to send pro activation email:', err));
    }
    return;
  }

  if (pluginId && userId) {
    const [plugin] = await Plugin.get([Plugin.ID, pluginId]);
    if (!plugin) {
      console.warn(`Plugin ${pluginId} not found for webhook order ${orderId}`);
      return;
    }

    const orderInrPrice = Number(notes.original_amount_inr ?? plugin.price);
    if (orderInrPrice !== plugin.price) {
      console.warn(`Plugin price changed: notes ${orderInrPrice} vs current ${plugin.price}. Accepting.`);
    }

    const subunitDigits = getSubunitDigits(rzpOrder.currency) ?? 2;
    const paidAmount = rzpOrder.amount / 10 ** subunitDigits;

    await Order.insert(
      [Order.PLUGIN_ID, pluginId],
      [Order.TOKEN, paymentId],
      [Order.ORDER_ID, orderId],
      [Order.PACKAGE, 'web'],
      [Order.AMOUNT, paidAmount],
      [Order.CURRENCY, rzpOrder.currency],
      [Order.STATE, Order.STATE_PURCHASED],
      [Order.USER_ID, userId],
      [Order.PROVIDER, Order.PROVIDER_RAZORPAY],
    );

    if (paymentId) notifyPurchase(paymentId).catch((err) => console.error('Failed to send purchase email via webhook:', err));

    console.log(`Created purchase_order for plugin ${pluginId} (user ${userId}) via webhook`);
  }
}

module.exports = ensurePurchaseOwnership;
