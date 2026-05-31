const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Router } = require('express');
const Plugin = require('../entities/plugin');
const Order = require('../entities/purchaseOrder');
const User = require('../entities/user');
const RazorpayOrder = require('../entities/razorpayOrder');
const AppConfig = require('../entities/appConfig');
const Sponsor = require('../entities/sponsor');
const { getLoggedInUser, parseDbTime, detectUserCurrency, formatAmount } = require('../lib/helpers');
const sendEmail = require('../lib/sendEmail');
const { REFUND_WINDOW_MS } = require('../../constants.mjs');
const getRazorpay = require('../lib/razorpay');
const { CURRENCIES, getAllCurrencies, getSubunitDigits } = require('../lib/currencyMap');
const { convertPrice } = require('../lib/exchangeRates');
const ensurePurchaseOwnership = require('../lib/ensurePurchaseOwnership');
const notifyRefund = require('../lib/notifyRefund');
const notifyPurchase = require('../lib/notifyPurchase');

const router = Router();

function getProductDisplayName(productType, pluginId, pluginMap) {
  if (productType === 'acode_pro') return 'Acode Pro';
  if (productType === 'sponsor') return 'Sponsor';
  return pluginMap.get(String(pluginId)) || 'Deleted Plugin';
}

function purchaseStateToStatus(state) {
  switch (Number(state)) {
    case Order.STATE_PURCHASED:
      return 'paid';
    case Order.STATE_CANCELED:
      return 'cancelled';
    default:
      return 'created';
  }
}

/**
 * Create a Razorpay order for a plugin purchase
 * POST /api/razorpay/create-order
 * Body: { pluginId: string }
 */
router.post('/create-order', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Please log in to purchase plugins' });
      return;
    }

    const { pluginId } = req.body;
    if (!pluginId) {
      res.status(400).send({ error: 'Plugin ID is required' });
      return;
    }

    const [plugin] = await Plugin.get([Plugin.ID, pluginId]);
    if (!plugin) {
      res.status(404).send({ error: 'Plugin not found' });
      return;
    }

    if (plugin[Plugin.STATUS] !== Plugin.STATUS_APPROVED) {
      res.status(400).send({ error: 'You can not buy this plugin, please try again later' });
      return;
    }

    if (!plugin.price || plugin.price <= 0) {
      res.status(400).send({ error: 'This plugin is free' });
      return;
    }

    const [ownedOrder] = await Order.get([
      [Order.USER_ID, user.id],
      [Order.PLUGIN_ID, plugin.id],
      [Order.STATE, Order.STATE_PURCHASED],
    ]);

    if (ownedOrder) {
      res.status(400).send({ error: 'You already own this plugin' });
      return;
    }

    const existingOrderStatuses = [
      RazorpayOrder.STATUS_CREATED,
      RazorpayOrder.STATUS_PENDING,
      RazorpayOrder.STATUS_PAID,
      RazorpayOrder.STATUS_FAILED,
      RazorpayOrder.STATUS_CANCELLED,
      RazorpayOrder.STATUS_REFUNDED,
      RazorpayOrder.STATUS_REFUNDING,
    ];

    const [existingOrder] = await RazorpayOrder.get(
      [RazorpayOrder.ID, RazorpayOrder.RAZORPAY_ORDER_ID, RazorpayOrder.STATUS, RazorpayOrder.AMOUNT, RazorpayOrder.CURRENCY],
      [
        [RazorpayOrder.USER_ID, user.id],
        [RazorpayOrder.PLUGIN_ID, plugin.id],
        [RazorpayOrder.PRODUCT_TYPE, RazorpayOrder.PRODUCT_PLUGIN],
        [RazorpayOrder.STATUS, existingOrderStatuses, 'IN'],
      ],
    );

    let reuseOrderId = null;

    const currency = detectUserCurrency(req);

    if (existingOrder) {
      if (existingOrder.status === RazorpayOrder.STATUS_PENDING) {
        res.status(409).send({ error: 'A payment is already being processed for this plugin. Please wait for it to complete.' });
        return;
      }

      if (existingOrder.status === RazorpayOrder.STATUS_PAID) {
        await ensurePurchaseOwnership(existingOrder.razorpay_order_id, null);
        res.status(400).send({ error: 'You already own this plugin' });
        return;
      }

      if (existingOrder.status === RazorpayOrder.STATUS_CREATED && existingOrder.currency === currency.code) {
        res.send({
          orderId: existingOrder.razorpay_order_id,
          amount: existingOrder.amount,
          currency: existingOrder.currency,
          keyId: process.env.PG_KEY_ID,
          pluginName: plugin.name,
          pluginId: plugin.id,
          userEmail: user.email,
          originalPrice: plugin.price,
          displayCurrency: existingOrder.currency,
          existingOrder: true,
        });
        return;
      }

      // REFUNDED/REFUNDING → create a fresh record (no reuse)
      if (existingOrder.status !== RazorpayOrder.STATUS_REFUNDED && existingOrder.status !== RazorpayOrder.STATUS_REFUNDING) {
        if (existingOrder.status !== RazorpayOrder.STATUS_CANCELLED && existingOrder.status !== RazorpayOrder.STATUS_FAILED) {
          await RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_CANCELLED]], [RazorpayOrder.ID, existingOrder.id]);
        }

        reuseOrderId = existingOrder.id;
      }
    }

    const converted = await convertPrice(plugin.price, currency.code);
    const subunitMultiplier = 10 ** getSubunitDigits(converted.currency);
    const receipt = `p_${plugin.id}_${user.id}`.slice(0, 40);
    const finalAmount = Math.round(converted.amount * subunitMultiplier);
    const order = await getRazorpay().orders.create({
      amount: finalAmount,
      currency: converted.currency,
      receipt,
      notes: {
        userId: user.id,
        pluginId: plugin.id,
        pluginName: plugin.name.replace(/[\u{10000}-\u{10FFFF}]/gu, ''),
        userEmail: user.email,
        original_amount_inr: plugin.price,
        original_currency: 'INR',
        target_currency: converted.currency,
        exchange_rate: converted.rate,
      },
    });

    if (reuseOrderId) {
      try {
        await RazorpayOrder.update(
          [
            [RazorpayOrder.RAZORPAY_ORDER_ID, order.id],
            [RazorpayOrder.AMOUNT, finalAmount],
            [RazorpayOrder.CURRENCY, converted.currency],
            [RazorpayOrder.AMOUNT_INR, plugin.price],
            [RazorpayOrder.RECEIPT, receipt],
            [RazorpayOrder.RAZORPAY_PAYMENT_ID, null],
            [RazorpayOrder.STATUS, RazorpayOrder.STATUS_CREATED],
          ],
          [RazorpayOrder.ID, reuseOrderId],
        );
      } catch (err) {
        console.error('Failed to update razorpay_order:', err);
        res.status(500).send({ error: 'Failed to update order' });
        return;
      }
    } else {
      try {
        await RazorpayOrder.insert(
          [RazorpayOrder.RAZORPAY_ORDER_ID, order.id],
          [RazorpayOrder.USER_ID, user.id],
          [RazorpayOrder.PLUGIN_ID, plugin.id],
          [RazorpayOrder.PRODUCT_TYPE, RazorpayOrder.PRODUCT_PLUGIN],
          [RazorpayOrder.AMOUNT, finalAmount],
          [RazorpayOrder.CURRENCY, converted.currency],
          [RazorpayOrder.AMOUNT_INR, plugin.price],
          [RazorpayOrder.RECEIPT, receipt],
        );
      } catch (err) {
        console.error('Failed to insert razorpay_order:', err);

        const [raceRec] = await RazorpayOrder.get(
          [RazorpayOrder.RAZORPAY_ORDER_ID, RazorpayOrder.STATUS, RazorpayOrder.AMOUNT, RazorpayOrder.CURRENCY],
          [
            [RazorpayOrder.USER_ID, user.id],
            [RazorpayOrder.PLUGIN_ID, plugin.id],
            [RazorpayOrder.PRODUCT_TYPE, RazorpayOrder.PRODUCT_PLUGIN],
            [RazorpayOrder.STATUS, [RazorpayOrder.STATUS_CREATED, RazorpayOrder.STATUS_PENDING], 'IN'],
          ],
        );

        if (raceRec) {
          res.send({
            orderId: raceRec.razorpay_order_id,
            amount: raceRec.amount,
            currency: raceRec.currency,
            keyId: process.env.PG_KEY_ID,
            pluginName: plugin.name,
            pluginId: plugin.id,
            userEmail: user.email,
            originalPrice: plugin.price,
            displayCurrency: raceRec.currency,
            existingOrder: true,
          });
          return;
        }
      }
    }

    res.send({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.PG_KEY_ID,
      pluginName: plugin.name,
      pluginId: plugin.id,
      userEmail: user.email,
      originalPrice: plugin.price,
      displayCurrency: converted.currency,
    });
  } catch (error) {
    console.error('Razorpay create order error:', error);
    res.status(500).send({ error: 'Failed to create order' });
  }
});

/**
 * Verify Razorpay payment and create purchase record
 * POST /api/razorpay/verify
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, pluginId }
 */
router.post('/verify', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, pluginId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !pluginId) {
      res.status(400).send({ error: 'Missing required fields' });
      return;
    }

    // Verify signature (timing-safe comparison)
    const generatedSignature = crypto
      .createHmac('sha256', process.env.PG_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (
      generatedSignature.length !== razorpay_signature.length ||
      !crypto.timingSafeEqual(Buffer.from(generatedSignature), Buffer.from(razorpay_signature))
    ) {
      res.status(400).send({ error: 'Invalid payment signature' });
      return;
    }

    // Fetch the Razorpay order to verify amount and pluginId from server-side notes
    const rzpOrder = await getRazorpay().orders.fetch(razorpay_order_id);
    if (!rzpOrder || rzpOrder.status !== 'paid') {
      // Payment was attempted (valid signature) but not yet captured —
      // transition from 'created' to 'pending' so the user sees their order as processing.
      if (rzpOrder && rzpOrder.status === 'attempted') {
        await RazorpayOrder.update(
          [[RazorpayOrder.STATUS, RazorpayOrder.STATUS_PENDING]],
          [
            [RazorpayOrder.RAZORPAY_ORDER_ID, razorpay_order_id],
            [RazorpayOrder.STATUS, RazorpayOrder.STATUS_CREATED],
          ],
        ).catch((err) => console.error('Failed to set pending status in verify:', err));
      }

      res.status(400).send({
        code: 'PAYMENT_PROCESSING',
        error: 'Payment is still processing. Your purchase will be activated automatically once payment is confirmed.',
      });
      return;
    }

    // Verify pluginId matches what was set in the order notes during create-order
    if (rzpOrder.notes?.pluginId !== pluginId) {
      res.status(400).send({ error: 'Plugin ID mismatch' });
      return;
    }

    const [plugin] = await Plugin.get([Plugin.ID, pluginId]);
    if (!plugin) {
      res.status(404).send({ error: 'Plugin not found' });
      return;
    }

    // Verify INR price from server-set notes (rzpOrder.amount may be in foreign currency).
    // Falls back to plugin.price for old orders that predate original_amount_inr in notes.
    const orderInrPrice = Number(rzpOrder.notes?.original_amount_inr ?? plugin.price);
    const orderTargetCurrency = rzpOrder.notes?.target_currency;
    if (orderInrPrice !== plugin.price) {
      res.status(400).send({ error: 'Payment amount does not match plugin price' });
      return;
    }
    if (orderTargetCurrency && !CURRENCIES[orderTargetCurrency]) {
      res.status(400).send({ error: 'Invalid currency in order' });
      return;
    }

    await RazorpayOrder.update(
      [
        [RazorpayOrder.STATUS, RazorpayOrder.STATUS_PAID],
        [RazorpayOrder.RAZORPAY_PAYMENT_ID, razorpay_payment_id],
      ],
      [RazorpayOrder.RAZORPAY_ORDER_ID, razorpay_order_id],
    );

    // Check if order already exists (avoid duplicates)
    const [existingOrder] = await Order.get([Order.ORDER_ID, razorpay_order_id]);
    if (existingOrder) {
      res.send({ success: true, message: 'Order already recorded' });
      return;
    }

    // Create purchase order record
    await Order.insert(
      [Order.PLUGIN_ID, plugin.id],
      [Order.TOKEN, razorpay_payment_id],
      [Order.ORDER_ID, razorpay_order_id],
      [Order.PACKAGE, 'web'],
      [Order.AMOUNT, rzpOrder.amount / 10 ** (getSubunitDigits(rzpOrder.currency) ?? 2)],
      [Order.CURRENCY, rzpOrder.currency],
      [Order.STATE, Order.STATE_PURCHASED],
      [Order.USER_ID, user.id],
      [Order.PROVIDER, Order.PROVIDER_RAZORPAY],
    );

    notifyPurchase(razorpay_payment_id, { email: user.email, name: user.name }).catch((err) => console.error('Failed to send purchase email:', err));

    res.send({ success: true, message: 'Payment verified and purchase recorded' });
  } catch (error) {
    console.error('Razorpay verify error:', error);
    res.status(500).send({ error: 'Failed to verify payment' });
  }
});

/**
 * Check if user owns a plugin
 * GET /api/razorpay/check-ownership/:pluginId
 */
router.get('/check-ownership/:pluginId', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.send({ owned: false });
      return;
    }

    const { pluginId } = req.params;
    const [order] = await Order.get([
      [Order.USER_ID, user.id],
      [Order.PLUGIN_ID, pluginId],
      [Order.STATE, Order.STATE_PURCHASED],
    ]);

    res.send({ owned: !!order });
  } catch (error) {
    console.error('Check ownership error:', error);
    res.status(500).send({ error: 'Failed to check ownership' });
  }
});

/**
 * Get user's purchased plugins with full details
 * GET /api/razorpay/my-purchases
 *
 * For web: Uses session cookie
 * For app: Pass ?token=auth_token query param
 *
 * Returns array of purchased plugins with full plugin info
 */
router.get('/my-purchases{/:pluginId}', async (req, res) => {
  try {
    const { pluginId } = req.params;
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const where = [
      [Order.USER_ID, user.id],
      [Order.STATE, Order.STATE_PURCHASED],
    ];

    if (pluginId) {
      where.push([Order.PLUGIN_ID, pluginId]);
    }

    // Get all purchased orders for user
    const orders = await Order.get([Order.ID, Order.PLUGIN_ID, Order.AMOUNT, Order.CURRENCY, Order.CREATED_AT, Order.PROVIDER], where);

    const purchasedPlugins = await Promise.all(
      orders.map(async (order) => {
        const [plugin] = await Plugin.get([Plugin.ID, order.plugin_id]);
        if (!plugin) return null;

        const provider = order.provider || 'google_play';
        const elapsed = Date.now() - parseDbTime(order.created_at).getTime();
        const refundEligible = provider === 'razorpay' && elapsed <= REFUND_WINDOW_MS;
        const currency = order.currency ? CURRENCIES[order.currency.toUpperCase()] : null;

        return {
          ...plugin,
          currency: order.currency,
          purchasedAt: order.created_at,
          purchaseAmount: formatAmount(order.amount, order.currency),
          purchaseAmountCurrency: order.currency,
          purchaseAmountCurrencySymbol: currency?.symbol,
          purchaseProvider: provider,
          purchaseOrderId: order.id,
          refundEligible,
        };
      }),
    );

    if (pluginId) {
      const [plugin] = purchasedPlugins;

      if (!plugin) {
        res.status(404).send({ error: 'Purchase not found' });
        return;
      }

      res.send(purchasedPlugins[0]);
      return;
    }

    // Filter out nulls (deleted plugins)
    res.send(purchasedPlugins.filter(Boolean));
  } catch (error) {
    console.error('My purchases error:', error);
    res.status(500).send({ error: 'Failed to fetch purchases' });
  }
});

/**
 * List all Razorpay orders for the logged-in user
 * GET /api/razorpay/orders
 *
 * Optional query params:
 *   status      - Filter by order status (created, pending, paid, failed, refunded, cancelled)
 *   productType - Filter by product type (plugin, acode_pro)
 */
router.get('/orders', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { status, productType } = req.query;
    const where = [[RazorpayOrder.USER_ID, user.id]];
    if (status) {
      where.push([RazorpayOrder.STATUS, status]);
    } else {
      where.push([RazorpayOrder.STATUS, RazorpayOrder.STATUS_CREATED, '<>']);
    }
    if (productType) {
      where.push([RazorpayOrder.PRODUCT_TYPE, productType]);
    }

    const orders = await RazorpayOrder.for('internal').get(
      [
        RazorpayOrder.ID,
        RazorpayOrder.RAZORPAY_ORDER_ID,
        RazorpayOrder.RAZORPAY_PAYMENT_ID,
        RazorpayOrder.PRODUCT_TYPE,
        RazorpayOrder.PLUGIN_ID,
        RazorpayOrder.AMOUNT,
        RazorpayOrder.CURRENCY,
        RazorpayOrder.STATUS,
        RazorpayOrder.CREATED_AT,
      ],
      where,
      { orderBy: `${RazorpayOrder.CREATED_AT} DESC` },
    );

    const pluginIds = [...new Set(orders.map((o) => o.plugin_id).filter(Boolean))];
    const pluginMap = new Map();
    if (pluginIds.length) {
      const plugins = await Plugin.get([Plugin.ID, Plugin.NAME], [Plugin.ID, pluginIds, 'IN']);
      for (const p of plugins) {
        pluginMap.set(String(p.id), p.name);
      }
    }

    const sponsorOrderIds = orders.filter((o) => o.product_type === 'sponsor').map((o) => o.razorpay_order_id);
    const sponsorMap = new Map();
    if (sponsorOrderIds.length) {
      const sponsors = await Sponsor.get([Sponsor.TIER, Sponsor.ORDER_ID], [Sponsor.ORDER_ID, sponsorOrderIds, 'IN']);
      for (const s of sponsors) {
        sponsorMap.set(s.order_id, s.tier);
      }
    }

    const result = orders.map((order) => {
      const subunit = getSubunitDigits(order.currency) ?? 2;
      const baseUnits = order.amount / 10 ** subunit;
      const tier = order.product_type === 'sponsor' ? sponsorMap.get(order.razorpay_order_id) : null;

      return {
        id: order.id,
        razorpayOrderId: order.razorpay_order_id,
        razorpayPaymentId: order.razorpay_payment_id,
        productType: order.product_type,
        pluginId: order.plugin_id,
        pluginName: getProductDisplayName(order.product_type, order.plugin_id, pluginMap),
        sponsorTier: tier,
        status: order.status,
        amount: formatAmount(baseUnits, order.currency),
        currency: order.currency,
        currencySymbol: CURRENCIES[order.currency?.toUpperCase()]?.symbol || '',
        createdAt: order.created_at,
      };
    });

    const rzpOrderIds = new Set(orders.map((o) => o.razorpay_order_id).filter(Boolean));
    const rzpPaymentIds = new Set(orders.map((o) => o.razorpay_payment_id).filter(Boolean));

    const legacyOrders = await Order.for('internal').get(
      [Order.ID, Order.ORDER_ID, Order.TOKEN, Order.PLUGIN_ID, Order.AMOUNT, Order.CURRENCY, Order.STATE, Order.CREATED_AT],
      [
        [Order.USER_ID, user.id],
        [Order.PROVIDER, Order.PROVIDER_RAZORPAY],
      ],
    );

    const unmatchedLegacy = legacyOrders.filter((o) => !rzpOrderIds.has(o.order_id));

    const legacyPluginIds = [...new Set(unmatchedLegacy.map((o) => o.plugin_id).filter(Boolean))];
    if (legacyPluginIds.length) {
      const legacyPlugins = await Plugin.get([Plugin.ID, Plugin.NAME], [Plugin.ID, legacyPluginIds, 'IN']);
      for (const p of legacyPlugins) {
        if (!pluginMap.has(String(p.id))) {
          pluginMap.set(String(p.id), p.name);
        }
      }
    }

    const legacyResult = unmatchedLegacy.map((o) => ({
      id: `legacy_${o.id}`,
      razorpayOrderId: o.order_id,
      razorpayPaymentId: o.token,
      productType: 'plugin',
      pluginId: o.plugin_id,
      pluginName: pluginMap.get(String(o.plugin_id)) || 'Deleted Plugin',
      status: purchaseStateToStatus(o.state),
      amount: formatAmount(o.amount, o.currency),
      currency: o.currency,
      currencySymbol: CURRENCIES[o.currency?.toUpperCase()]?.symbol || '',
      createdAt: o.created_at,
    }));

    if (user.acode_pro === 1 || user.acode_pro === true) {
      const [fullUser] = await User.get([User.PRO_PURCHASE_TOKEN, User.PRO_PURCHASED_AT], [User.ID, user.id]);
      if (fullUser?.pro_purchase_token && !rzpPaymentIds.has(fullUser.pro_purchase_token)) {
        const proPrice = Number(await AppConfig.getValue('acode_pro_price'));
        const proCurrency = 'INR';
        legacyResult.push({
          id: 'legacy_pro',
          razorpayOrderId: null,
          razorpayPaymentId: fullUser.pro_purchase_token,
          productType: 'acode_pro',
          pluginId: null,
          pluginName: 'Acode Pro',
          status: 'paid',
          amount: formatAmount(proPrice, proCurrency),
          currency: proCurrency,
          currencySymbol: CURRENCIES[proCurrency]?.symbol || '',
          createdAt: fullUser.pro_purchased_at,
        });
      }
    }

    // Apply status/productType filters to legacy results so callers
    // like updateOrdersBadge(?status=created) or the plugin page
    // (?status=created&productType=plugin) aren't polluted with
    // unrelated legacy records.
    const filteredLegacy = legacyResult.filter((entry) => {
      if (status && entry.status !== status) return false;
      if (productType && entry.productType !== productType) return false;
      return true;
    });
    legacyResult.length = 0;
    legacyResult.push(...filteredLegacy);

    const combined = [...result, ...legacyResult].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.send(combined);
  } catch (error) {
    console.error('Orders list error:', error);
    res.status(500).send({ error: 'Failed to fetch orders' });
  }
});

/**
 * Get a single Razorpay order detail
 * GET /api/razorpay/orders/:orderId
 */
router.get('/orders/:orderId', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { orderId } = req.params;

    const [order] = await RazorpayOrder.get(
      ['*'],
      [
        [RazorpayOrder.RAZORPAY_ORDER_ID, orderId],
        [RazorpayOrder.USER_ID, user.id],
      ],
    );

    if (!order) {
      const [legacy] = await Order.get(
        ['*'],
        [
          [Order.ORDER_ID, orderId],
          [Order.USER_ID, user.id],
          [Order.PROVIDER, Order.PROVIDER_RAZORPAY],
        ],
      );

      if (legacy) {
        let pluginName = 'Deleted Plugin';
        if (legacy.plugin_id) {
          const [plugin] = await Plugin.get([Plugin.ID, Plugin.NAME], [Plugin.ID, legacy.plugin_id]);
          pluginName = plugin?.name || 'Deleted Plugin';
        }

        let refundEligible = false;
        if (Number(legacy.state) === Order.STATE_PURCHASED) {
          const elapsed = Date.now() - parseDbTime(legacy.created_at).getTime();
          refundEligible = elapsed <= REFUND_WINDOW_MS;
        }

        res.send({
          id: `legacy_${legacy.id}`,
          razorpayOrderId: legacy.order_id,
          razorpayPaymentId: legacy.token,
          productType: 'plugin',
          pluginId: legacy.plugin_id,
          pluginName,
          status: purchaseStateToStatus(legacy.state),
          amount: formatAmount(legacy.amount, legacy.currency),
          currency: legacy.currency,
          currencySymbol: CURRENCIES[legacy.currency?.toUpperCase()]?.symbol || '',
          amountInr: null,
          receipt: null,
          createdAt: legacy.created_at,
          updatedAt: legacy.updated_at || legacy.created_at,
          purchaseOrderId: legacy.id,
          refundEligible,
        });
        return;
      }

      res.status(404).send({ error: 'Order not found' });
      return;
    }

    let pluginName = getProductDisplayName(order.product_type, null, null);
    if (order.product_type === 'plugin' && order.plugin_id) {
      const [plugin] = await Plugin.get([Plugin.ID, Plugin.NAME], [Plugin.ID, order.plugin_id]);
      pluginName = plugin?.name || 'Deleted Plugin';
    }

    const [purchaseOrder] = await Order.get([Order.ID, Order.STATE, Order.CREATED_AT, Order.PROVIDER], [Order.ORDER_ID, order.razorpay_order_id]);

    let refundEligible = false;
    if (purchaseOrder && Number(purchaseOrder.state) === Order.STATE_PURCHASED && purchaseOrder.provider === 'razorpay') {
      const elapsed = Date.now() - parseDbTime(purchaseOrder.created_at).getTime();
      refundEligible = elapsed <= REFUND_WINDOW_MS;
    }

    const subunit = getSubunitDigits(order.currency) ?? 2;
    const baseUnits = order.amount / 10 ** subunit;

    res.send({
      id: order.id,
      razorpayOrderId: order.razorpay_order_id,
      razorpayPaymentId: order.razorpay_payment_id,
      productType: order.product_type,
      pluginId: order.plugin_id,
      pluginName,
      status: order.status,
      amount: formatAmount(baseUnits, order.currency),
      currency: order.currency,
      currencySymbol: CURRENCIES[order.currency?.toUpperCase()]?.symbol || '',
      amountInr: order.amount_inr,
      receipt: order.receipt,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      purchaseOrderId: purchaseOrder?.id || null,
      refundEligible,
    });
  } catch (error) {
    console.error('Order detail error:', error);
    res.status(500).send({ error: 'Failed to fetch order' });
  }
});

/**
 * Razorpay Webhook Handler
 * POST /api/razorpay/webhook
 *
 * Handles events:
 * - payment.captured: Payment successfully captured
 * - payment.failed: Payment failed
 * - order.paid: Order fully paid
 * - refund.created, refund.processed: Refund issued or processed (e.g., from Razorpay Dashboard)
 *
 * Configure this webhook URL in Razorpay Dashboard:
 * Settings → Webhooks → Add New Webhook
 * URL: https://yourdomain.com/api/razorpay/webhook
 * Events: payment.captured, payment.failed, order.paid, refund.created, refund.processed
 */
router.post('/webhook', async (req, res) => {
  try {
    console.log(`[Razorpay webhook] received`);
    const webhookSecret = process.env.PG_WEBHOOK_SECRET;
    const isProduction = process.env.NODE_ENV === 'production';

    // Require webhook secret in production
    if (isProduction && !webhookSecret) {
      console.error('Webhook secret not configured in production');
      res.status(500).send({ error: 'Webhook not configured' });
      return;
    }

    // req.body is a raw Buffer when using express.raw() middleware
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

    // Verify webhook signature using raw body
    if (webhookSecret) {
      const signature = req.headers['x-razorpay-signature'];
      const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

      if (
        !signature ||
        signature.length !== expectedSignature.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
      ) {
        console.warn('Webhook signature verification failed');
        res.status(400).send({ error: 'Invalid signature' });
        return;
      }
    }

    // Parse the raw body to get event data
    const { event, payload } = JSON.parse(rawBody.toString());

    switch (event) {
      case 'payment.captured': {
        const payment = payload.payment.entity;
        const orderId = payment.order_id;
        const paymentId = payment.id;

        const [rzpRecord] = await RazorpayOrder.get([RazorpayOrder.ID, RazorpayOrder.STATUS], [RazorpayOrder.RAZORPAY_ORDER_ID, orderId]);
        if (rzpRecord) {
          if (rzpRecord.status === RazorpayOrder.STATUS_CANCELLED) {
            console.log(`Ignoring payment.captured for cancelled order ${orderId}`);
            break;
          }
          await RazorpayOrder.update(
            [
              [RazorpayOrder.STATUS, RazorpayOrder.STATUS_PAID],
              [RazorpayOrder.RAZORPAY_PAYMENT_ID, paymentId],
            ],
            [RazorpayOrder.RAZORPAY_ORDER_ID, orderId],
          );
        }

        await ensurePurchaseOwnership(orderId, paymentId);
        break;
      }

      case 'payment.failed': {
        const payment = payload.payment.entity;
        const orderId = payment.order_id;

        RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_FAILED]], [RazorpayOrder.RAZORPAY_ORDER_ID, orderId]).catch((err) =>
          console.error('Failed to update razorpay_order failed status:', err),
        );

        const [existingOrder] = await Order.get([Order.ORDER_ID, orderId]);
        if (existingOrder) {
          await Order.update([[Order.STATE, Order.STATE_CANCELED]], [Order.ORDER_ID, orderId]);
        }

        const [failedRzpOrder] = await RazorpayOrder.get(
          [RazorpayOrder.USER_ID, RazorpayOrder.PLUGIN_ID, RazorpayOrder.PRODUCT_TYPE],
          [RazorpayOrder.RAZORPAY_ORDER_ID, orderId],
        );

        if (failedRzpOrder) {
          const [failedUser] = await User.get([User.EMAIL, User.NAME], [User.ID, failedRzpOrder.user_id]);
          if (failedUser) {
            let itemName = 'your purchase';
            if (failedRzpOrder.product_type === 'acode_pro') {
              itemName = 'Acode Pro';
            } else if (failedRzpOrder.plugin_id) {
              const [failedPlugin] = await Plugin.get([Plugin.ID, Plugin.NAME], [Plugin.ID, failedRzpOrder.plugin_id]);
              itemName = failedPlugin?.name || 'your plugin';
            }
            sendEmail(
              failedUser.email,
              failedUser.name,
              'Your payment was not completed',
              `Your payment for <strong>${itemName}</strong> could not be completed. No charges were made. You can try again anytime from the <a href="https://acode.app/orders">Orders page</a>.<br><br>If you need help, reach out at <a href="https://acode.app/contact">acode.app/contact</a>.`,
            ).catch((err) => console.error('Failed to send payment failure email:', err));
          }
        }
        break;
      }

      case 'order.paid': {
        const order = payload.order.entity;
        const orderId = order.id;

        const [rzpRecord] = await RazorpayOrder.get([RazorpayOrder.ID, RazorpayOrder.STATUS], [RazorpayOrder.RAZORPAY_ORDER_ID, orderId]);
        if (rzpRecord) {
          if (rzpRecord.status === RazorpayOrder.STATUS_CANCELLED) {
            console.log(`Ignoring order.paid for cancelled order ${orderId}`);
            break;
          }
          if (rzpRecord.status === RazorpayOrder.STATUS_PAID) {
            console.log(`Ignoring duplicate order.paid for already-paid order ${orderId}`);
            break;
          }
          await RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_PAID]], [RazorpayOrder.RAZORPAY_ORDER_ID, orderId]);
        }

        await ensurePurchaseOwnership(orderId, null);
        break;
      }

      case 'payment.authorized':
      case 'payment.pending': {
        const payment = payload.payment.entity;
        const orderId = payment.order_id;
        const paymentId = payment.id;

        console.log(`[Razorpay webhook] ${event} for order ${orderId}, payment ${paymentId}`);

        // Transition from 'created' to 'pending' — payment was attempted, bank is processing.
        await RazorpayOrder.update(
          [
            [RazorpayOrder.STATUS, RazorpayOrder.STATUS_PENDING],
            [RazorpayOrder.RAZORPAY_PAYMENT_ID, paymentId],
          ],
          [
            [RazorpayOrder.RAZORPAY_ORDER_ID, orderId],
            [RazorpayOrder.STATUS, RazorpayOrder.STATUS_CREATED],
          ],
        ).catch((err) => console.error(`Failed to set pending status via ${event} webhook:`, err));
        break;
      }

      case 'refund.created': {
        const paymentId = payload.refund.entity.payment_id;
        console.log(`refund.created webhook for payment ${paymentId} (awaiting refund.processed)`);
        if (paymentId) {
          const [order] = await RazorpayOrder.get([RazorpayOrder.STATUS], [RazorpayOrder.RAZORPAY_PAYMENT_ID, paymentId]);
          if (order && order.status !== RazorpayOrder.STATUS_REFUNDED && order.status !== RazorpayOrder.STATUS_REFUNDING) {
            RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_REFUNDING]], [RazorpayOrder.RAZORPAY_PAYMENT_ID, paymentId]).catch(
              (err) => console.error('Failed to set refunding status via webhook:', err),
            );
          }
        }
        break;
      }

      case 'refund.processed': {
        const paymentId = payload.refund.entity.payment_id;
        if (!paymentId) {
          console.warn('refund.processed webhook: no payment_id found');
          break;
        }

        console.log(`Processing refund.processed webhook for payment ${paymentId}`);

        await RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_REFUNDED]], [RazorpayOrder.RAZORPAY_PAYMENT_ID, paymentId]);

        const [refundOrder] = await RazorpayOrder.get([RazorpayOrder.PRODUCT_TYPE], [RazorpayOrder.RAZORPAY_PAYMENT_ID, paymentId]);

        if (refundOrder?.product_type === RazorpayOrder.PRODUCT_SPONSOR) {
          await Sponsor.update([[Sponsor.STATUS, Sponsor.STATE_CANCELED]], [Sponsor.TOKEN, paymentId]);
        } else {
          await Order.update(
            [
              [Order.STATE, Order.STATE_CANCELED],
              [Order.AMOUNT, 0],
            ],
            [Order.TOKEN, paymentId],
          );

          await User.update(
            [
              [User.ACODE_PRO, 0],
              [User.PRO_PURCHASE_TOKEN, null],
              [User.PRO_PURCHASED_AT, null],
            ],
            [
              [User.PRO_PURCHASE_TOKEN, paymentId],
              [User.ACODE_PRO, 1],
            ],
          );
        }

        notifyRefund(paymentId).catch((err) => console.error('Failed to send refund email via webhook:', err));

        break;
      }

      default:
        console.log(`Unhandled webhook event: ${event}`);
    }

    // Always respond 200 to acknowledge receipt
    res.status(200).send({ status: 'ok' });
  } catch (error) {
    console.error('Webhook error:', error);
    // Still respond 200 to prevent Razorpay from retrying
    res.status(200).send({ status: 'error', message: error.message });
  }
});

/**
 * Fetch payment status from Razorpay API
 * GET /api/razorpay/payment-status/:paymentId
 */
router.get('/payment-status/:paymentId', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { paymentId } = req.params;

    // Verify the payment belongs to this user before exposing details
    const [order] = await Order.get([Order.TOKEN, paymentId]);
    if (!order) {
      res.status(404).send({ error: 'Payment not found' });
      return;
    }
    if (order.user_id !== user.id && !user.isAdmin) {
      res.status(403).send({ error: 'Forbidden' });
      return;
    }

    const payment = await getRazorpay().payments.fetch(paymentId);

    res.send({
      status: payment.status,
      captured: payment.status === 'captured',
      amount: payment.amount / 10 ** (getSubunitDigits(payment.currency) ?? 2),
      orderId: payment.order_id,
    });
  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).send({ error: 'Failed to fetch payment status' });
  }
});

/**
 * Get Acode Pro status and price
 * GET /api/razorpay/pro-status
 */
router.get('/pro-status', async (req, res) => {
  try {
    const price = Number(await AppConfig.getValue('acode_pro_price'));
    const user = await getLoggedInUser(req);

    if (!price || price <= 0) {
      res.status(503).send({ error: 'Acode Pro is not available for purchase right now. Please try again later.' });
      return;
    }

    const currency = detectUserCurrency(req);
    const converted = await convertPrice(price, currency.code);

    if (!user) {
      res.send({
        isPro: false,
        price: formatAmount(converted.amount, converted.currency),
        currency: converted.currency,
        symbol: converted.symbol,
        refundEligible: false,
      });
      return;
    }

    const isPro = user.acode_pro === 1 || user.acode_pro === true;
    let refundEligible = false;

    if (isPro && user.pro_purchased_at) {
      const elapsed = Date.now() - parseDbTime(user.pro_purchased_at).getTime();
      refundEligible = elapsed <= REFUND_WINDOW_MS;
    }

    res.send({
      isPro,
      refundEligible,
      currency: converted.currency,
      symbol: converted.symbol,
      price: formatAmount(converted.amount, converted.currency),
      purchasedAt: user.pro_purchased_at || null,
    });
  } catch (error) {
    console.error('Pro status error:', error);
    res.status(500).send({ error: 'Failed to fetch pro status' });
  }
});

/**
 * Get sponsor tier prices converted to user's currency
 * GET /api/razorpay/sponsor-prices
 */
router.get('/sponsor-prices', async (req, res) => {
  try {
    const currency = detectUserCurrency(req);
    const result = { currency: currency.code, symbol: currency.symbol, tiers: {} };
    const tiers = Sponsor.SPONSOR_TIERS;

    for (const [key, tier] of Object.entries(tiers)) {
      const converted = await convertPrice(tier.price, currency.code);
      result.tiers[key] = {
        label: tier.label,
        price: formatAmount(converted.amount, converted.currency),
        description: tier.description,
        key,
      };
    }

    res.send(result);
  } catch (error) {
    console.error('Sponsor prices error:', error);
    res.status(500).send({ error: 'Failed to fetch sponsor prices' });
  }
});

/**
 * Create a Razorpay order for Acode Pro purchase
 * POST /api/razorpay/create-pro-order
 */
router.post('/create-pro-order', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Please log in to purchase Acode Pro' });
      return;
    }

    if (user.acode_pro === 1 || user.acode_pro === true) {
      res.status(400).send({ error: 'You already have Acode Pro' });
      return;
    }

    const [existingProOrder] = await RazorpayOrder.get(
      [RazorpayOrder.ID, RazorpayOrder.RAZORPAY_ORDER_ID, RazorpayOrder.STATUS, RazorpayOrder.AMOUNT, RazorpayOrder.CURRENCY],
      [
        [RazorpayOrder.USER_ID, user.id],
        [RazorpayOrder.PRODUCT_TYPE, RazorpayOrder.PRODUCT_PRO],
        [
          RazorpayOrder.STATUS,
          [
            RazorpayOrder.STATUS_CREATED,
            RazorpayOrder.STATUS_PENDING,
            RazorpayOrder.STATUS_PAID,
            RazorpayOrder.STATUS_FAILED,
            RazorpayOrder.STATUS_CANCELLED,
            RazorpayOrder.STATUS_REFUNDED,
            RazorpayOrder.STATUS_REFUNDING,
          ],
          'IN',
        ],
      ],
    );

    let reuseOrderId = null;

    const currency = detectUserCurrency(req);

    if (existingProOrder) {
      if (existingProOrder.status === RazorpayOrder.STATUS_PENDING) {
        res.status(409).send({ error: 'A payment is already being processed for Acode Pro. Please wait for it to complete.' });
        return;
      }

      if (existingProOrder.status === RazorpayOrder.STATUS_PAID) {
        await ensurePurchaseOwnership(existingProOrder.razorpay_order_id, null);
        res.status(400).send({ error: 'You already have Acode Pro' });
        return;
      }

      if (existingProOrder.status === RazorpayOrder.STATUS_CREATED && existingProOrder.currency === currency.code) {
        res.send({
          orderId: existingProOrder.razorpay_order_id,
          amount: existingProOrder.amount,
          currency: existingProOrder.currency,
          keyId: process.env.PG_KEY_ID,
          userEmail: user.email,
          originalPrice: Number(await AppConfig.getValue('acode_pro_price')),
          displayCurrency: existingProOrder.currency,
          existingOrder: true,
        });
        return;
      }

      // REFUNDED/REFUNDING → create a fresh record (no reuse)
      if (existingProOrder.status !== RazorpayOrder.STATUS_REFUNDED && existingProOrder.status !== RazorpayOrder.STATUS_REFUNDING) {
        if (existingProOrder.status !== RazorpayOrder.STATUS_CANCELLED && existingProOrder.status !== RazorpayOrder.STATUS_FAILED) {
          await RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_CANCELLED]], [RazorpayOrder.ID, existingProOrder.id]);
        }

        reuseOrderId = existingProOrder.id;
      }
    }

    const price = Number(await AppConfig.getValue('acode_pro_price'));
    if (!price || price <= 0) {
      res.status(503).send({ error: 'Acode Pro is not available for purchase right now. Please try again later.' });
      return;
    }

    const converted = await convertPrice(price, currency.code);
    const subunitMultiplier = 10 ** getSubunitDigits(converted.currency);
    const receipt = `pro_${user.id}`.slice(0, 40);
    const order = await getRazorpay().orders.create({
      amount: Math.round(converted.amount * subunitMultiplier),
      currency: converted.currency,
      receipt,
      notes: {
        type: 'acode_pro',
        userId: user.id,
        userEmail: user.email,
        original_amount_inr: price,
        original_currency: 'INR',
        target_currency: converted.currency,
        exchange_rate: converted.rate,
      },
    });

    if (reuseOrderId) {
      try {
        await RazorpayOrder.update(
          [
            [RazorpayOrder.RAZORPAY_ORDER_ID, order.id],
            [RazorpayOrder.AMOUNT, Math.round(converted.amount * subunitMultiplier)],
            [RazorpayOrder.CURRENCY, converted.currency],
            [RazorpayOrder.AMOUNT_INR, price],
            [RazorpayOrder.RECEIPT, receipt],
            [RazorpayOrder.RAZORPAY_PAYMENT_ID, null],
            [RazorpayOrder.STATUS, RazorpayOrder.STATUS_CREATED],
          ],
          [RazorpayOrder.ID, reuseOrderId],
        );
      } catch (err) {
        console.error('Failed to update razorpay_order (pro):', err);
        res.status(500).send({ error: 'Failed to update order' });
        return;
      }
    } else {
      try {
        await RazorpayOrder.insert(
          [RazorpayOrder.RAZORPAY_ORDER_ID, order.id],
          [RazorpayOrder.USER_ID, user.id],
          [RazorpayOrder.PLUGIN_ID, null],
          [RazorpayOrder.PRODUCT_TYPE, RazorpayOrder.PRODUCT_PRO],
          [RazorpayOrder.AMOUNT, Math.round(converted.amount * subunitMultiplier)],
          [RazorpayOrder.CURRENCY, converted.currency],
          [RazorpayOrder.AMOUNT_INR, price],
          [RazorpayOrder.RECEIPT, receipt],
        );
      } catch (err) {
        console.error('Failed to insert razorpay_order (pro):', err);

        const [raceRec] = await RazorpayOrder.get(
          [RazorpayOrder.RAZORPAY_ORDER_ID, RazorpayOrder.STATUS, RazorpayOrder.AMOUNT, RazorpayOrder.CURRENCY],
          [
            [RazorpayOrder.USER_ID, user.id],
            [RazorpayOrder.PRODUCT_TYPE, RazorpayOrder.PRODUCT_PRO],
            [RazorpayOrder.STATUS, [RazorpayOrder.STATUS_CREATED, RazorpayOrder.STATUS_PENDING], 'IN'],
          ],
        );

        if (raceRec) {
          res.send({
            orderId: raceRec.razorpay_order_id,
            amount: raceRec.amount,
            currency: raceRec.currency,
            keyId: process.env.PG_KEY_ID,
            userEmail: user.email,
            originalPrice: Number(await AppConfig.getValue('acode_pro_price')),
            displayCurrency: raceRec.currency,
            existingOrder: true,
          });
          return;
        }
      }
    }

    res.send({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.PG_KEY_ID,
      userEmail: user.email,
      originalPrice: price,
      displayCurrency: converted.currency,
    });
  } catch (error) {
    console.error('Razorpay create pro order error:', error);
    res.status(500).send({ error: 'Failed to create order' });
  }
});

/**
 * Verify Razorpay payment for Acode Pro and activate
 * POST /api/razorpay/verify-pro
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
router.post('/verify-pro', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    // Reject if user is already Pro (prevents token overwrite and refund window reset)
    if (user.acode_pro === 1 || user.acode_pro === true) {
      res.send({ success: true, message: 'Acode Pro already activated' });
      return;
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      res.status(400).send({ error: 'Missing required fields' });
      return;
    }

    // Verify signature (timing-safe comparison)
    const generatedSignature = crypto
      .createHmac('sha256', process.env.PG_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (
      generatedSignature.length !== razorpay_signature.length ||
      !crypto.timingSafeEqual(Buffer.from(generatedSignature), Buffer.from(razorpay_signature))
    ) {
      res.status(400).send({ error: 'Invalid payment signature' });
      return;
    }

    // Fetch the Razorpay order to verify it's paid and amount matches expected pro price
    const rzpOrder = await getRazorpay().orders.fetch(razorpay_order_id);
    if (!rzpOrder || rzpOrder.status !== 'paid') {
      // Payment was attempted (valid signature) but not yet captured —
      // transition from 'created' to 'pending' so the user sees their order as processing.
      if (rzpOrder && rzpOrder.status === 'attempted') {
        await RazorpayOrder.update(
          [[RazorpayOrder.STATUS, RazorpayOrder.STATUS_PENDING]],
          [
            [RazorpayOrder.RAZORPAY_ORDER_ID, razorpay_order_id],
            [RazorpayOrder.STATUS, RazorpayOrder.STATUS_CREATED],
          ],
        ).catch((err) => console.error('Failed to set pending status in verify-pro:', err));
      }

      res.status(400).send({
        code: 'PAYMENT_PROCESSING',
        error: 'Payment is still processing. Your purchase will be activated automatically once payment is confirmed.',
      });
      return;
    }

    if (rzpOrder.notes?.type !== 'acode_pro') {
      res.status(400).send({ error: 'Order type mismatch' });
      return;
    }

    // Verify the order was created for this user (prevents cross-user payment reuse)
    if (String(rzpOrder.notes?.userId) !== String(user.id)) {
      res.status(403).send({ error: 'Order does not belong to this user' });
      return;
    }

    // Verify INR price from server-set notes (rzpOrder.amount may be in foreign currency).
    // The price may have changed between order creation and payment verification,
    // so we warn rather than reject on mismatch — the server set the correct amount at creation.
    const expectedPrice = Number(await AppConfig.getValue('acode_pro_price'));
    const orderInrPrice = Number(rzpOrder.notes?.original_amount_inr);
    if (orderInrPrice && orderInrPrice !== expectedPrice) {
      console.warn(`Pro price changed: notes INR ${orderInrPrice} vs config ${expectedPrice}. Accepting payment.`);
    }
    const orderTargetCurrency = rzpOrder.notes?.target_currency;
    if (orderTargetCurrency && !CURRENCIES[orderTargetCurrency]) {
      res.status(400).send({ error: 'Invalid currency in order' });
      return;
    }

    // Re-check Pro status right before activation to close TOCTOU race
    // (webhook may have already activated Pro between our initial check and now)
    const [freshUser] = await User.get([User.ACODE_PRO], [User.ID, user.id]);
    if (freshUser?.acode_pro === 1 || freshUser?.acode_pro === true) {
      res.send({ success: true, message: 'Acode Pro already activated' });
      return;
    }

    // Activate Acode Pro for the user
    await User.update(
      [
        [User.ACODE_PRO, 1],
        [User.PRO_PURCHASE_TOKEN, razorpay_payment_id],
        [User.PRO_PURCHASED_AT, new Date().toISOString()],
      ],
      [User.ID, user.id],
    );

    await RazorpayOrder.update(
      [
        [RazorpayOrder.STATUS, RazorpayOrder.STATUS_PAID],
        [RazorpayOrder.RAZORPAY_PAYMENT_ID, razorpay_payment_id],
      ],
      [RazorpayOrder.RAZORPAY_ORDER_ID, razorpay_order_id],
    );

    notifyPurchase(razorpay_payment_id, { email: user.email, name: user.name }).catch((err) =>
      console.error('Failed to send pro purchase email:', err),
    );

    res.send({ success: true, message: 'Acode Pro activated' });
  } catch (error) {
    console.error('Razorpay verify pro error:', error);
    res.status(500).send({ error: 'Failed to verify payment' });
  }
});

/**
 * Create a Razorpay order for Sponsor purchase
 * POST /api/razorpay/create-sponsor-order
 */
router.post('/create-sponsor-order', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Please log in to sponsor Acode' });
      return;
    }

    const { tier, name, email, website, tagline, image } = req.body;

    if (!tier || !name || !email) {
      res.status(400).send({ error: 'Tier, name, and email are required' });
      return;
    }

    if (website && !/^https?:\/\/.+/i.test(website)) {
      res.status(400).send({ error: 'Website must start with http:// or https://' });
      return;
    }

    const tierInfo = Sponsor.SPONSOR_TIERS[tier];
    if (!tierInfo) {
      res.status(400).send({ error: 'Invalid tier' });
      return;
    }

    const price = tierInfo.price;

    const existingOrderStatuses = [
      RazorpayOrder.STATUS_CREATED,
      RazorpayOrder.STATUS_PENDING,
      RazorpayOrder.STATUS_PAID,
      RazorpayOrder.STATUS_FAILED,
      RazorpayOrder.STATUS_CANCELLED,
      RazorpayOrder.STATUS_REFUNDED,
      RazorpayOrder.STATUS_REFUNDING,
    ];

    const [existingOrder] = await RazorpayOrder.get(
      [RazorpayOrder.ID, RazorpayOrder.RAZORPAY_ORDER_ID, RazorpayOrder.STATUS, RazorpayOrder.AMOUNT, RazorpayOrder.CURRENCY],
      [
        [RazorpayOrder.USER_ID, user.id],
        [RazorpayOrder.PRODUCT_TYPE, RazorpayOrder.PRODUCT_SPONSOR],
        [RazorpayOrder.STATUS, existingOrderStatuses, 'IN'],
      ],
    );

    let reuseOrderId = null;

    const currency = detectUserCurrency(req);

    if (existingOrder) {
      if (existingOrder.status === RazorpayOrder.STATUS_PENDING) {
        res.status(409).send({ error: 'A payment is already being processed for your sponsorship. Please wait for it to complete.' });
        return;
      }

      if (existingOrder.status === RazorpayOrder.STATUS_PAID) {
        await ensurePurchaseOwnership(existingOrder.razorpay_order_id, null);
        res.status(400).send({ error: 'Your sponsorship is already active' });
        return;
      }

      if (existingOrder.status === RazorpayOrder.STATUS_CREATED && existingOrder.currency === currency.code) {
        res.send({
          orderId: existingOrder.razorpay_order_id,
          amount: existingOrder.amount,
          currency: existingOrder.currency,
          keyId: process.env.PG_KEY_ID,
          userEmail: user.email,
          tier,
          originalPrice: price,
          displayCurrency: existingOrder.currency,
          existingOrder: true,
        });
        return;
      }

      if (existingOrder.status !== RazorpayOrder.STATUS_REFUNDED && existingOrder.status !== RazorpayOrder.STATUS_REFUNDING) {
        if (existingOrder.status !== RazorpayOrder.STATUS_CANCELLED && existingOrder.status !== RazorpayOrder.STATUS_FAILED) {
          await RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_CANCELLED]], [RazorpayOrder.ID, existingOrder.id]);
        }

        reuseOrderId = existingOrder.id;
      }
    }

    let imageFilename = null;
    let imageBase64 = null;
    if (image) {
      const match = image.match(/^data:image\/(\w+);base64,/);
      if (!match) {
        res.status(400).send({ error: 'Invalid image format' });
        return;
      }
      const ext = match[1];
      imageFilename = `s_${crypto.randomUUID()}.${ext}`;
      imageBase64 = image.replace(/^data:image\/\w+;base64,/, '');
    }

    const converted = await convertPrice(price, currency.code);
    const subunitMultiplier = 10 ** getSubunitDigits(converted.currency);
    const receipt = `sponsor_${user.id}_${Date.now()}`.slice(0, 40);
    const order = await getRazorpay().orders.create({
      amount: Math.round(converted.amount * subunitMultiplier),
      currency: converted.currency,
      receipt,
      notes: {
        type: 'sponsor',
        userId: user.id,
        userEmail: user.email,
        tier,
        sponsorName: name,
        original_amount_inr: price,
        original_currency: 'INR',
        target_currency: converted.currency,
        exchange_rate: converted.rate,
      },
    });

    function writeImageFile(filename, data) {
      const sponsorsDir = path.resolve(__dirname, '../../data/sponsors');
      if (!fs.existsSync(sponsorsDir)) {
        fs.mkdirSync(sponsorsDir, { recursive: true });
      }
      fs.writeFileSync(path.join(sponsorsDir, filename), data, 'base64');
    }

    function removeImageFile(filename) {
      if (!filename) return;
      try {
        const filePath = path.resolve(__dirname, '../../data/sponsors', filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {
        // ignore cleanup errors
      }
    }

    if (reuseOrderId) {
      try {
        const oldSponsorCols = [Sponsor.IMAGE];
        const [oldSponsor] = await Sponsor.get(oldSponsorCols, [Sponsor.ORDER_ID, existingOrder.razorpay_order_id]);
        const oldImage = oldSponsor?.image;

        await RazorpayOrder.update(
          [
            [RazorpayOrder.RAZORPAY_ORDER_ID, order.id],
            [RazorpayOrder.AMOUNT, Math.round(converted.amount * subunitMultiplier)],
            [RazorpayOrder.CURRENCY, converted.currency],
            [RazorpayOrder.AMOUNT_INR, price],
            [RazorpayOrder.RECEIPT, receipt],
            [RazorpayOrder.RAZORPAY_PAYMENT_ID, null],
            [RazorpayOrder.STATUS, RazorpayOrder.STATUS_CREATED],
          ],
          [RazorpayOrder.ID, reuseOrderId],
        );

        const sponsorUpdateCols = [
          [Sponsor.ORDER_ID, order.id],
          [Sponsor.NAME, name],
          [Sponsor.EMAIL, email],
          [Sponsor.WEBSITE, website || ''],
          [Sponsor.TAGLINE, tagline || ''],
          [Sponsor.TIER, tier],
          [Sponsor.AMOUNT, price],
          [Sponsor.STATUS, Sponsor.STATE_PENDING],
          [Sponsor.TOKEN, order.id],
        ];

        if (imageFilename) {
          sponsorUpdateCols.push([Sponsor.IMAGE, imageFilename]);
        }

        await Sponsor.update(sponsorUpdateCols, [Sponsor.ORDER_ID, existingOrder.razorpay_order_id]);

        if (imageBase64) writeImageFile(imageFilename, imageBase64);
        if (oldImage && imageFilename) removeImageFile(oldImage);
      } catch (err) {
        removeImageFile(imageFilename);
        console.error('Failed to update razorpay_order (sponsor):', err);
        res.status(500).send({ error: 'Failed to update order' });
        return;
      }
    } else {
      try {
        await Sponsor.insert(
          [Sponsor.NAME, name],
          [Sponsor.EMAIL, email],
          [Sponsor.WEBSITE, website || ''],
          [Sponsor.TAGLINE, tagline || ''],
          [Sponsor.TIER, tier],
          [Sponsor.IMAGE, imageFilename || ''],
          [Sponsor.ORDER_ID, order.id],
          [Sponsor.TOKEN, order.id],
          [Sponsor.STATUS, Sponsor.STATE_PENDING],
          [Sponsor.PUBLIC, 1],
          [Sponsor.AMOUNT, price],
          [Sponsor.USER_ID, user.id],
          [Sponsor.PACKAGE_NAME, 'web'],
        );

        if (imageBase64) writeImageFile(imageFilename, imageBase64);
      } catch (err) {
        removeImageFile(imageFilename);
        console.error('Failed to insert sponsor record:', err);

        const [raceSponsor] = await Sponsor.get(
          [Sponsor.ORDER_ID, Sponsor.STATUS],
          [
            [Sponsor.USER_ID, user.id],
            [Sponsor.STATUS, [Sponsor.STATE_PENDING, Sponsor.STATE_PURCHASED], 'IN'],
          ],
        );

        if (raceSponsor) {
          if (raceSponsor.status === Sponsor.STATE_PURCHASED) {
            res.status(400).send({ error: 'Your sponsorship is already active' });
            return;
          }

          res.send({
            orderId: raceSponsor.order_id,
            amount: Math.round(converted.amount * subunitMultiplier),
            currency: converted.currency,
            keyId: process.env.PG_KEY_ID,
            userEmail: user.email,
            tier,
            originalPrice: price,
            displayCurrency: converted.currency,
            existingOrder: true,
          });
          return;
        }
      }

      try {
        await RazorpayOrder.insert(
          [RazorpayOrder.RAZORPAY_ORDER_ID, order.id],
          [RazorpayOrder.USER_ID, user.id],
          [RazorpayOrder.PLUGIN_ID, null],
          [RazorpayOrder.PRODUCT_TYPE, RazorpayOrder.PRODUCT_SPONSOR],
          [RazorpayOrder.AMOUNT, Math.round(converted.amount * subunitMultiplier)],
          [RazorpayOrder.CURRENCY, converted.currency],
          [RazorpayOrder.AMOUNT_INR, price],
          [RazorpayOrder.RECEIPT, receipt],
        );
      } catch (err) {
        removeImageFile(imageFilename);
        console.error('Failed to insert razorpay_order (sponsor):', err);

        const [raceRec] = await RazorpayOrder.get(
          [RazorpayOrder.RAZORPAY_ORDER_ID, RazorpayOrder.STATUS, RazorpayOrder.AMOUNT, RazorpayOrder.CURRENCY],
          [
            [RazorpayOrder.USER_ID, user.id],
            [RazorpayOrder.PRODUCT_TYPE, RazorpayOrder.PRODUCT_SPONSOR],
            [RazorpayOrder.STATUS, [RazorpayOrder.STATUS_CREATED, RazorpayOrder.STATUS_PENDING], 'IN'],
          ],
        );

        if (raceRec) {
          res.send({
            orderId: raceRec.razorpay_order_id,
            amount: raceRec.amount,
            currency: raceRec.currency,
            keyId: process.env.PG_KEY_ID,
            userEmail: user.email,
            tier,
            originalPrice: price,
            displayCurrency: raceRec.currency,
            existingOrder: true,
          });
          return;
        }
      }
    }

    res.send({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.PG_KEY_ID,
      userEmail: user.email,
      tier,
      originalPrice: price,
      displayCurrency: converted.currency,
    });
  } catch (error) {
    console.error('Razorpay create sponsor order error:', error);
    res.status(500).send({ error: 'Failed to create order' });
  }
});

/**
 * Verify Razorpay payment for Sponsor and activate
 * POST /api/razorpay/verify-sponsor
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
router.post('/verify-sponsor', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      res.status(400).send({ error: 'Missing required fields' });
      return;
    }

    const generatedSignature = crypto
      .createHmac('sha256', process.env.PG_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (
      generatedSignature.length !== razorpay_signature.length ||
      !crypto.timingSafeEqual(Buffer.from(generatedSignature), Buffer.from(razorpay_signature))
    ) {
      res.status(400).send({ error: 'Invalid payment signature' });
      return;
    }

    const rzpOrder = await getRazorpay().orders.fetch(razorpay_order_id);
    if (!rzpOrder || rzpOrder.status !== 'paid') {
      if (rzpOrder && rzpOrder.status === 'attempted') {
        await RazorpayOrder.update(
          [[RazorpayOrder.STATUS, RazorpayOrder.STATUS_PENDING]],
          [
            [RazorpayOrder.RAZORPAY_ORDER_ID, razorpay_order_id],
            [RazorpayOrder.STATUS, RazorpayOrder.STATUS_CREATED],
          ],
        ).catch((err) => console.error('Failed to set pending status in verify-sponsor:', err));
      }

      res.status(400).send({
        code: 'PAYMENT_PROCESSING',
        error: 'Payment is still processing. Your sponsorship will be activated automatically once payment is confirmed.',
      });
      return;
    }

    if (rzpOrder.notes?.type !== 'sponsor') {
      res.status(400).send({ error: 'Order type mismatch' });
      return;
    }

    if (String(rzpOrder.notes?.userId) !== String(user.id)) {
      res.status(403).send({ error: 'Order does not belong to this user' });
      return;
    }

    // TOCTOU: check if already purchased via webhook
    const [sponsor] = await Sponsor.get([Sponsor.ID, Sponsor.STATUS], [Sponsor.ORDER_ID, razorpay_order_id]);

    if (!sponsor || sponsor.status !== Sponsor.STATE_PENDING) {
      if (sponsor?.status === Sponsor.STATE_PURCHASED) {
        res.send({ success: true, message: 'Thank you for sponsoring Acode!' });
        return;
      }
      res.status(400).send({ error: 'Sponsor order not found or already processed' });
      return;
    }

    const sponsorUpdateCols = [
      [Sponsor.STATUS, Sponsor.STATE_PURCHASED],
      [Sponsor.TOKEN, razorpay_payment_id],
      [Sponsor.EXPIRES_AT, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()],
    ];

    const notesAmount = Number(rzpOrder.notes?.original_amount_inr);
    if (notesAmount && notesAmount > 0) {
      sponsorUpdateCols.push([Sponsor.AMOUNT, notesAmount]);
    }

    await Sponsor.update(sponsorUpdateCols, [Sponsor.ID, sponsor.id]);

    await RazorpayOrder.update(
      [
        [RazorpayOrder.STATUS, RazorpayOrder.STATUS_PAID],
        [RazorpayOrder.RAZORPAY_PAYMENT_ID, razorpay_payment_id],
      ],
      [RazorpayOrder.RAZORPAY_ORDER_ID, razorpay_order_id],
    );

    notifyPurchase(razorpay_payment_id, { email: user.email, name: user.name }).catch((err) =>
      console.error('Failed to send sponsor purchase email:', err),
    );

    res.send({ success: true, message: 'Thank you for sponsoring Acode!' });
  } catch (error) {
    console.error('Razorpay verify sponsor error:', error);
    res.status(500).send({ error: 'Failed to verify payment' });
  }
});

/**
 * Refund Acode Pro purchase (within 2 hours of purchase)
 * POST /api/razorpay/refund-pro
 */
router.post('/refund-pro', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    if (user.acode_pro !== 1 && user.acode_pro !== true) {
      res.status(400).send({ error: 'You do not have Acode Pro' });
      return;
    }

    // Fetch the purchase token (not included in safeColumns)
    const [fullUser] = await User.get([User.PRO_PURCHASE_TOKEN, User.PRO_PURCHASED_AT], [User.ID, user.id]);
    const purchaseToken = fullUser?.pro_purchase_token;
    const purchasedAt = fullUser?.pro_purchased_at;

    if (!purchaseToken) {
      res.status(400).send({ error: 'No purchase token found. Please contact support.' });
      return;
    }

    if (!purchasedAt) {
      res.status(400).send({ error: 'Purchase date not found. Please contact support.' });
      return;
    }

    const elapsed = Date.now() - parseDbTime(purchasedAt).getTime();
    if (elapsed > REFUND_WINDOW_MS) {
      res.status(400).send({ error: 'Refund window has expired. Refunds are only available within 2 hours of purchase.' });
      return;
    }

    // Reset pro status first so user can't use Pro while refund is processing.
    // If the Razorpay refund call fails, we restore Pro status.
    await User.update(
      [
        [User.ACODE_PRO, 0],
        [User.PRO_PURCHASE_TOKEN, null],
        [User.PRO_PURCHASED_AT, null],
      ],
      [User.ID, user.id],
    );

    try {
      await getRazorpay().payments.refund(purchaseToken, {
        speed: 'normal',
      });
    } catch (refundErr) {
      const isAlreadyRefunded =
        refundErr?.error?.code === 'BAD_REQUEST_ERROR' && refundErr?.error?.description === 'The payment has been fully refunded already';

      if (isAlreadyRefunded) {
        console.log(`Pro refund: payment ${purchaseToken} was already refunded`);
        RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_REFUNDED]], [RazorpayOrder.RAZORPAY_PAYMENT_ID, purchaseToken]).catch(
          (err) => console.error('Failed to update razorpay_order refund status:', err),
        );
        res.send({ success: true, message: 'This payment was already refunded.' });
        return;
      }

      // Razorpay refund failed — restore Pro status so user isn't left in limbo
      console.error('Razorpay refund API failed, restoring Pro status:', refundErr);
      await User.update(
        [
          [User.ACODE_PRO, 1],
          [User.PRO_PURCHASE_TOKEN, purchaseToken],
          [User.PRO_PURCHASED_AT, purchasedAt],
        ],
        [User.ID, user.id],
      );
      res.status(500).send({ error: 'Refund failed at payment gateway. Please try again or contact support.' });
      return;
    }

    RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_REFUNDED]], [RazorpayOrder.RAZORPAY_PAYMENT_ID, purchaseToken]).catch((err) =>
      console.error('Failed to update razorpay_order refund status:', err),
    );

    res.send({ success: true, message: 'Refund initiated. It may take 5-7 business days to reflect.' });
  } catch (error) {
    console.error('Razorpay refund pro error:', error);
    res.status(500).send({ error: 'Failed to process refund' });
  }
});

/**
 * Refund a plugin purchase (within 2 hours of purchase, Razorpay only)
 * POST /api/razorpay/refund-plugin
 * Body: { orderId }
 */
router.post('/refund-plugin', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { orderId } = req.body;
    if (!orderId) {
      res.status(400).send({ error: 'Missing order ID' });
      return;
    }

    // Fetch the full order (including token which is not in minColumns)
    const [order] = await Order.for('internal').get([Order.ID, orderId]);
    if (!order) {
      res.status(404).send({ error: 'Order not found' });
      return;
    }

    if (order.user_id !== user.id) {
      res.status(403).send({ error: 'Forbidden' });
      return;
    }

    if (Number(order.state) !== Order.STATE_PURCHASED) {
      res.status(400).send({ error: 'Order is not in purchased state' });
      return;
    }

    if (order.provider !== 'razorpay') {
      res
        .status(400)
        .send({ error: 'Only Razorpay purchases can be refunded here. For Google Play purchases, request a refund through Google Play.' });
      return;
    }

    if (!order.token) {
      res.status(400).send({ error: 'No payment token found. Please contact support.' });
      return;
    }

    const elapsed = Date.now() - parseDbTime(order.created_at).getTime();
    if (elapsed > REFUND_WINDOW_MS) {
      res.status(400).send({ error: 'Refund window has expired. Refunds are only available within 2 hours of purchase.' });
      return;
    }

    // Issue full refund via Razorpay
    try {
      await getRazorpay().payments.refund(order.token, {
        speed: 'normal',
      });
    } catch (refundErr) {
      const isAlreadyRefunded =
        refundErr?.error?.code === 'BAD_REQUEST_ERROR' && refundErr?.error?.description === 'The payment has been fully refunded already';
      if (!isAlreadyRefunded) throw refundErr;

      console.log(`Plugin refund: payment ${order.token} was already refunded`);
    }

    // Update order state to canceled and zero out amount
    await Order.update(
      [
        [Order.STATE, Order.STATE_CANCELED],
        [Order.AMOUNT, 0],
      ],
      [Order.ID, order.id],
    );

    RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_REFUNDED]], [RazorpayOrder.RAZORPAY_ORDER_ID, order.order_id]).catch((err) =>
      console.error('Failed to update razorpay_order refund status:', err),
    );

    res.send({ success: true, message: 'Refund initiated. It may take 5-7 business days to reflect.' });
  } catch (error) {
    console.error('Razorpay refund plugin error:', error);
    res.status(500).send({ error: 'Failed to process refund' });
  }
});

/**
 * Get user's currency configuration based on IP geolocation.
 * Used by the client to configure currency display globally without per-plugin calls.
 * GET /api/razorpay/currency-config
 */
router.get('/currency-config', async (req, res) => {
  try {
    const { preferred } = req.query;

    if (preferred) {
      const upper = preferred.toUpperCase();

      if (!CURRENCIES[upper]) {
        res.status(400).send({ error: `Unsupported currency: ${preferred}` });
        return;
      }

      res.cookie('preferred_currency', upper, {
        secure: true,
        httpOnly: false,
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 10),
      });

      res.send(CURRENCIES[upper]);
      return;
    }

    res.send(detectUserCurrency(req));
  } catch (error) {
    console.error('Currency config error:', error);
    res.status(500).send({ error: 'Failed to fetch currency config' });
  }
});

router.get('/currencies', (_req, res) => {
  try {
    res.send(getAllCurrencies());
  } catch (error) {
    console.error('Currencies list error:', error);
    res.status(500).send({ error: 'Failed to fetch currencies' });
  }
});

router.post('/cancel-order', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { razorpayOrderId } = req.body;
    if (!razorpayOrderId) {
      res.status(400).send({ error: 'Order ID is required' });
      return;
    }

    const [order] = await RazorpayOrder.get(
      [RazorpayOrder.ID, RazorpayOrder.STATUS, RazorpayOrder.USER_ID],
      [RazorpayOrder.RAZORPAY_ORDER_ID, razorpayOrderId],
    );

    if (!order) {
      res.status(404).send({ error: 'Order not found' });
      return;
    }

    if (String(order.user_id) !== String(user.id)) {
      res.status(403).send({ error: 'Forbidden' });
      return;
    }

    if (order.status !== RazorpayOrder.STATUS_CREATED && order.status !== RazorpayOrder.STATUS_PENDING) {
      res.status(400).send({ error: 'Only pending orders can be cancelled' });
      return;
    }

    await RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_CANCELLED]], [RazorpayOrder.RAZORPAY_ORDER_ID, razorpayOrderId]);

    const [verify] = await RazorpayOrder.get([RazorpayOrder.STATUS], [RazorpayOrder.RAZORPAY_ORDER_ID, razorpayOrderId]);

    if (!verify || verify.status !== RazorpayOrder.STATUS_CANCELLED) {
      console.error(`Cancel-order update failed for ${razorpayOrderId}: read-back status=${verify?.status}`, { razorpayOrderId });
      res.status(500).send({ error: 'Failed to cancel order. Please try again.' });
      return;
    }

    console.log(`Order ${razorpayOrderId} cancelled by user ${user.id}`);
    res.send({ success: true, message: 'Order cancelled', status: verify.status });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).send({ error: 'Failed to cancel order' });
  }
});

module.exports = router;
