const Plugin = require('../entities/plugin');
const Order = require('../entities/purchaseOrder');
const User = require('../entities/user');
const AppConfig = require('../entities/appConfig');
const Sponsor = require('../entities/sponsor');
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
    if (Number(existingOrder.state) === Order.STATE_CANCELED) {
      console.log(`Ignoring webhook for cancelled order ${orderId}`);
      return;
    }

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

  if (type === 'sponsor' && userId) {
    const [existingSponsor] = await Sponsor.get([Sponsor.STATUS], [Sponsor.ORDER_ID, orderId]);

    if (!existingSponsor) {
      console.warn(`Sponsor record not found for order ${orderId}`);
      return;
    }

    if (existingSponsor.status === Sponsor.STATE_PURCHASED) {
      console.log(`Sponsor already activated for order ${orderId}`);
      return;
    }

    if (existingSponsor.status === Sponsor.STATE_CANCELED) {
      console.log(`Ignoring webhook for cancelled sponsor order ${orderId}`);
      return;
    }

    const sponsorCols = [
      [Sponsor.STATUS, Sponsor.STATE_PURCHASED],
      [Sponsor.EXPIRES_AT, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()],
    ];
    if (paymentId) {
      sponsorCols.push([Sponsor.TOKEN, paymentId]);
    }
    await Sponsor.update(sponsorCols, [Sponsor.ORDER_ID, orderId]);
    console.log(`Activated sponsor for user ${userId} via webhook`);
    if (paymentId) notifyPurchase(paymentId).catch((err) => console.error('Failed to send sponsor purchase email:', err));
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

    // order.paid webhooks may not include a payment_id — resolve one from the order's payments.
    let resolvedPaymentId = paymentId ?? null;
    if (!resolvedPaymentId) {
      try {
        const payments = await getRazorpay().orders.fetchPayments(orderId);
        const captured = payments.items?.find((p) => p.status === 'captured');
        if (captured) resolvedPaymentId = captured.id;
      } catch (err) {
        console.error(`Failed to resolve paymentId for order ${orderId}:`, err.message);
      }
    }

    if (!resolvedPaymentId) {
      console.error(`Cannot create purchase_order for ${orderId}: no payment_id available`);
      return;
    }

    const subunitDigits = getSubunitDigits(rzpOrder.currency) ?? 2;
    const paidAmount = rzpOrder.amount / 10 ** subunitDigits;

    // Re-check for a race: another webhook may have inserted a row for this order_id
    // while we were resolving the payment.  Defend with a double-checked insert.
    const [raceRow] = await Order.get([Order.ORDER_ID, orderId]);
    if (raceRow) {
      if (Number(raceRow.state) !== Order.STATE_CANCELED) {
        await Order.update(
          [
            [Order.AMOUNT, paidAmount],
            [Order.CURRENCY, rzpOrder.currency],
            [Order.STATE, Order.STATE_PURCHASED],
            [Order.TOKEN, resolvedPaymentId],
          ],
          [Order.ORDER_ID, orderId],
        );
        if (resolvedPaymentId) notifyPurchase(resolvedPaymentId).catch((err) => console.error('Failed to send purchase email via webhook:', err));
      }
    } else {
      await Order.insertOrIgnore(
        [Order.PLUGIN_ID, pluginId],
        [Order.TOKEN, resolvedPaymentId],
        [Order.ORDER_ID, orderId],
        [Order.PACKAGE, 'web'],
        [Order.AMOUNT, paidAmount],
        [Order.CURRENCY, rzpOrder.currency],
        [Order.STATE, Order.STATE_PURCHASED],
        [Order.USER_ID, userId],
        [Order.PROVIDER, Order.PROVIDER_RAZORPAY],
      );

      await Order.update(
        [
          [Order.AMOUNT, paidAmount],
          [Order.CURRENCY, rzpOrder.currency],
          [Order.STATE, Order.STATE_PURCHASED],
          [Order.TOKEN, resolvedPaymentId],
        ],
        [
          [Order.ORDER_ID, orderId],
          [Order.STATE, Order.STATE_CANCELED, '<>'],
        ],
      );

      if (resolvedPaymentId) notifyPurchase(resolvedPaymentId).catch((err) => console.error('Failed to send purchase email via webhook:', err));
    }

    console.log(`Processed purchase_order for plugin ${pluginId} (user ${userId}) via webhook`);
  }
}

module.exports = ensurePurchaseOwnership;
