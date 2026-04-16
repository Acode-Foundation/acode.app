const crypto = require('node:crypto');
const { Router } = require('express');
const Plugin = require('../entities/plugin');
const Order = require('../entities/purchaseOrder');
const User = require('../entities/user');
const AppConfig = require('../entities/appConfig');
const { getLoggedInUser } = require('../lib/helpers');
const sendEmail = require('../lib/sendEmail');
const { REFUND_WINDOW_MS } = require('../../constants.mjs');
const getRazorpay = require('../lib/razorpay');

const router = Router();

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

    if (!plugin.price || plugin.price <= 0) {
      res.status(400).send({ error: 'This plugin is free' });
      return;
    }

    // Check if user already owns this plugin
    const [existingOrder] = await Order.get([
      [Order.USER_ID, user.id],
      [Order.PLUGIN_ID, plugin.id],
      [Order.STATE, Order.STATE_PURCHASED],
    ]);

    if (existingOrder) {
      res.status(400).send({ error: 'You already own this plugin' });
      return;
    }

    const receipt = `p_${plugin.id}_${user.id}`.slice(0, 40);
    const order = await getRazorpay().orders.create({
      amount: Math.round(plugin.price * 100),
      currency: 'INR',
      receipt,
      notes: {
        pluginId: plugin.id,
        pluginName: plugin.name,
        userId: user.id,
        userEmail: user.email,
      },
    });

    res.send({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.PG_KEY_ID,
      pluginName: plugin.name,
      pluginId: plugin.id,
      userEmail: user.email,
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
      res.status(400).send({ error: 'Order not paid' });
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

    // Verify the payment amount matches the plugin price
    const expectedAmount = Math.round(plugin.price * 100);
    if (rzpOrder.amount !== expectedAmount) {
      res.status(400).send({ error: 'Payment amount mismatch' });
      return;
    }

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
      [Order.AMOUNT, plugin.price],
      [Order.STATE, Order.STATE_PURCHASED],
      [Order.USER_ID, user.id],
      [Order.PROVIDER, Order.PROVIDER_RAZORPAY],
    );

    sendEmail(
      user.email,
      user.name,
      'Thank you for your purchase!',
      `You've successfully purchased <strong>${plugin.name}</strong> for &#8377;${plugin.price}.<br><br>You can now download and use the plugin right away. If you run into any issues or have questions, feel free to reach out at <a href="https://acode.app/contact">acode.app/contact</a>.<br><br>Thank you for supporting the Acode ecosystem and the developer behind this plugin!`,
    ).catch((err) => console.error('Failed to send plugin purchase email:', err));

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
router.get('/my-purchases', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    // Get all purchased orders for user
    const orders = await Order.get(
      [Order.ID, Order.PLUGIN_ID, Order.AMOUNT, Order.CREATED_AT, Order.PROVIDER],
      [
        [Order.USER_ID, user.id],
        [Order.STATE, Order.STATE_PURCHASED],
      ],
    );

    // Get full plugin details for each purchase
    const purchasedPlugins = await Promise.all(
      orders.map(async (order) => {
        const [plugin] = await Plugin.get([Plugin.ID, order.plugin_id]);
        if (!plugin) return null;

        const provider = order.provider || 'google_play';
        const elapsed = Date.now() - new Date(`${order.created_at}Z`).getTime();
        const refundEligible = provider === 'razorpay' && elapsed <= REFUND_WINDOW_MS;

        return {
          ...plugin,
          purchasedAt: order.created_at,
          purchaseAmount: order.amount,
          purchaseProvider: provider,
          purchaseOrderId: order.id,
          refundEligible,
        };
      }),
    );

    // Filter out nulls (deleted plugins)
    res.send(purchasedPlugins.filter(Boolean));
  } catch (error) {
    console.error('My purchases error:', error);
    res.status(500).send({ error: 'Failed to fetch purchases' });
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
 *
 * Configure this webhook URL in Razorpay Dashboard:
 * Settings → Webhooks → Add New Webhook
 * URL: https://yourdomain.com/api/razorpay/webhook
 * Events: payment.captured, payment.failed, order.paid
 */
router.post('/webhook', async (req, res) => {
  try {
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
        // Payment was successfully captured
        const payment = payload.payment.entity;
        const orderId = payment.order_id;
        const paymentId = payment.id;
        const amount = Math.round(payment.amount) / 100;
        const notes = payment.notes || {};

        // Handle Acode Pro purchase via webhook (fallback if client verify missed)
        if (notes.type === 'acode_pro' && notes.userId) {
          const [existingUser] = await User.get(User.safeColumns, [User.ID, notes.userId]);
          if (existingUser && existingUser.acode_pro !== 1 && existingUser.acode_pro !== true) {
            await User.update(
              [
                [User.ACODE_PRO, 1],
                [User.PRO_PURCHASE_TOKEN, paymentId],
                [User.PRO_PURCHASED_AT, new Date().toISOString()],
              ],
              [User.ID, notes.userId],
            );
            console.log(`Activated Acode Pro for user ${notes.userId} via webhook`);
          }
          break;
        }

        // Handle plugin purchase
        // Check if order already exists
        const [existingOrder] = await Order.get([Order.ORDER_ID, orderId]);

        if (existingOrder) {
          // Update existing order state if not already purchased
          if (Number(existingOrder.state) !== Order.STATE_PURCHASED) {
            await Order.update(
              [
                [Order.STATE, Order.STATE_PURCHASED],
                [Order.TOKEN, paymentId],
              ],
              [Order.ORDER_ID, orderId],
            );
            console.log(`Updated order ${orderId} to PURCHASED via webhook`);
          }
        } else {
          // Order doesn't exist - this can happen if callback failed
          // We need notes from the order to get pluginId and userId
          const notes = payment.notes || {};
          const pluginId = notes.pluginId;
          const userId = notes.userId;

          if (pluginId && userId) {
            const [plugin] = await Plugin.get([Plugin.ID, pluginId]);
            if (plugin) {
              await Order.insert(
                [Order.PLUGIN_ID, pluginId],
                [Order.TOKEN, paymentId],
                [Order.ORDER_ID, orderId],
                [Order.PACKAGE, 'web'],
                [Order.AMOUNT, amount],
                [Order.STATE, Order.STATE_PURCHASED],
                [Order.USER_ID, userId],
                [Order.PROVIDER, Order.PROVIDER_RAZORPAY],
              );
              console.log(`Created order for ${pluginId} via webhook (callback missed)`);
            }
          }
        }
        break;
      }

      case 'payment.failed': {
        // Payment failed
        const payment = payload.payment.entity;
        const orderId = payment.order_id;

        console.log(`Payment failed for order ${orderId}: ${payment.error_description}`);

        // Update order state to cancelled if it exists
        const [existingOrder] = await Order.get([Order.ORDER_ID, orderId]);
        if (existingOrder) {
          await Order.update([[Order.STATE, Order.STATE_CANCELED]], [Order.ORDER_ID, orderId]);
        }
        break;
      }

      case 'order.paid': {
        // Order is fully paid - similar handling to payment.captured
        const order = payload.order.entity;
        const orderId = order.id;

        const [existingOrder] = await Order.get([Order.ORDER_ID, orderId]);
        if (existingOrder && Number(existingOrder.state) !== Order.STATE_PURCHASED) {
          await Order.update([[Order.STATE, Order.STATE_PURCHASED]], [Order.ORDER_ID, orderId]);
          console.log(`Order ${orderId} marked as paid via webhook`);
        }
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
      amount: payment.amount / 100,
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
    const price = Number(await AppConfig.getValue('acode_pro_price')) || 370;
    const user = await getLoggedInUser(req);

    if (!user) {
      res.send({ isPro: false, price, refundEligible: false });
      return;
    }

    const isPro = user.acode_pro === 1 || user.acode_pro === true;
    let refundEligible = false;

    if (isPro && user.pro_purchased_at) {
      const elapsed = Date.now() - new Date(`${user.pro_purchased_at}Z`).getTime();
      refundEligible = elapsed <= REFUND_WINDOW_MS;
    }

    res.send({
      isPro,
      purchasedAt: user.pro_purchased_at || null,
      refundEligible,
      price,
    });
  } catch (error) {
    console.error('Pro status error:', error);
    res.status(500).send({ error: 'Failed to fetch pro status' });
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

    const price = Number(await AppConfig.getValue('acode_pro_price')) || 370;

    const receipt = `pro_${user.id}`.slice(0, 40);
    const order = await getRazorpay().orders.create({
      amount: Math.round(price * 100),
      currency: 'INR',
      receipt,
      notes: {
        type: 'acode_pro',
        userId: user.id,
        userEmail: user.email,
      },
    });

    res.send({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.PG_KEY_ID,
      userEmail: user.email,
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
      res.status(400).send({ error: 'You already have Acode Pro' });
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
      res.status(400).send({ error: 'Order not paid' });
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

    // Verify against the amount set at order creation (not current config price,
    // which may have changed between order creation and payment verification)
    const createdAmount = Math.round(rzpOrder.amount);
    const expectedPrice = Number(await AppConfig.getValue('acode_pro_price')) || 370;
    const expectedAmount = Math.round(expectedPrice * 100);
    if (createdAmount !== expectedAmount) {
      // Price changed after order was created — accept the payment since
      // the server set the correct amount at creation time
      console.warn(`Pro price changed: order amount ${createdAmount} vs current config ${expectedAmount}. Accepting payment.`);
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

    sendEmail(
      user.email,
      user.name,
      'You are awesome! Welcome to Acode Pro',
      'You just made our day!<br><br>By getting <strong>Acode Pro</strong>, you\'re not just unlocking an ad-free experience and exclusive themes \u2014 you\'re directly supporting a small team of developers who pour their hearts into keeping Acode free and open-source for everyone.<br><br>Every Pro purchase means we can spend more time building features, fixing bugs, and making Acode the best mobile code editor out there. Seriously, thank you. It means the world to us.<br><br>If for any reason you need a refund, no hard feelings \u2014 you can request one within 2 hours from the <a href="https://acode.app/pro">Pro page</a>.<br><br>Happy coding!',
    ).catch((err) => console.error('Failed to send pro activation email:', err));

    res.send({ success: true, message: 'Acode Pro activated' });
  } catch (error) {
    console.error('Razorpay verify pro error:', error);
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

    const elapsed = Date.now() - new Date(`${purchasedAt}Z`).getTime();
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

    sendEmail(
      user.email,
      user.name,
      "We're sorry to see you go",
      'Your <strong>Acode Pro</strong> refund has been initiated and should reflect in your account within 5-7 business days.<br><br>We\'re sad to see you go, and we\'d honestly love to know what made you change your mind. Was it something we could do better? A missing feature? Or just not the right time?<br><br>If you have a moment, please drop us a note at <a href="https://acode.app/contact">acode.app/contact</a> \u2014 your feedback genuinely helps us improve Acode for everyone.<br><br>The door is always open if you ever want to come back.',
    ).catch((err) => console.error('Failed to send pro refund email:', err));

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

    const elapsed = Date.now() - new Date(`${order.created_at}Z`).getTime();
    if (elapsed > REFUND_WINDOW_MS) {
      res.status(400).send({ error: 'Refund window has expired. Refunds are only available within 2 hours of purchase.' });
      return;
    }

    // Issue full refund via Razorpay
    await getRazorpay().payments.refund(order.token, {
      speed: 'normal',
    });

    // Update order state to canceled and zero out amount
    await Order.update(
      [
        [Order.STATE, Order.STATE_CANCELED],
        [Order.AMOUNT, 0],
      ],
      [Order.ID, order.id],
    );

    // Get plugin name for email
    const [plugin] = await Plugin.get([Plugin.ID, order.plugin_id]);
    const pluginName = plugin?.name || 'a plugin';

    sendEmail(
      user.email,
      user.name,
      "We're sorry to see you go",
      `Your refund for <strong>${pluginName}</strong> has been initiated and should reflect in your account within 5-7 business days.<br><br>We'd honestly love to know what made you change your mind. Was it something we could do better? A missing feature? Or just not the right fit?<br><br>If you have a moment, please drop us a note at <a href="https://acode.app/contact">acode.app/contact</a> \u2014 your feedback genuinely helps us improve Acode for everyone.<br><br>The door is always open if you ever want to come back.`,
    ).catch((err) => console.error('Failed to send plugin refund email:', err));

    res.send({ success: true, message: 'Refund initiated. It may take 5-7 business days to reflect.' });
  } catch (error) {
    console.error('Razorpay refund plugin error:', error);
    res.status(500).send({ error: 'Failed to process refund' });
  }
});

module.exports = router;
