const crypto = require('node:crypto');
const { Router } = require('express');
const Razorpay = require('razorpay');
const Plugin = require('../entities/plugin');
const Order = require('../entities/purchaseOrder');
const { getLoggedInUser } = require('../lib/helpers');

const router = Router();

// Lazy initialization of Razorpay instance
let razorpayInstance = null;
function getRazorpay() {
  if (!razorpayInstance) {
    const keyId = process.env.PG_KEY_ID;
    const keySecret = process.env.PG_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new Error('Razorpay API keys not configured');
    }

    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }
  return razorpayInstance;
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

    // Create Razorpay order (amount in paise)
    const order = await getRazorpay().orders.create({
      amount: Math.round(plugin.price * 100),
      currency: 'INR',
      receipt: `plugin_${plugin.id}_${user.id}_${Date.now()}`,
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

    // Verify signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.PG_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      res.status(400).send({ error: 'Invalid payment signature' });
      return;
    }

    const [plugin] = await Plugin.get([Plugin.ID, pluginId]);
    if (!plugin) {
      res.status(404).send({ error: 'Plugin not found' });
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
      [Order.PLUGIN_ID, Order.AMOUNT, Order.CREATED_AT, Order.PROVIDER],
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

        return {
          ...plugin,
          purchasedAt: order.created_at,
          purchaseAmount: order.amount,
          purchaseProvider: order.provider || 'google_play',
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

      if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
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

module.exports = router;
