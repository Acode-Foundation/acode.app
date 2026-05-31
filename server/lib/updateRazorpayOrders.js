const moment = require('moment');
const RazorpayOrder = require('../entities/razorpayOrder');
const Order = require('../entities/purchaseOrder');
const User = require('../entities/user');
const Sponsor = require('../entities/sponsor');
const getRazorpay = require('./razorpay');
const ensurePurchaseOwnership = require('./ensurePurchaseOwnership');
const notifyRefund = require('./notifyRefund');

async function syncPendingOrders() {
  const fifteenMinAgo = moment().subtract(15, 'minutes').format('YYYY-MM-DD HH:mm:ss');

  const pendingOrders = await RazorpayOrder.for('internal').get('*', [
    [RazorpayOrder.STATUS, [RazorpayOrder.STATUS_CREATED, RazorpayOrder.STATUS_PENDING], 'IN'],
    'AND',
    [RazorpayOrder.CREATED_AT, fifteenMinAgo, '<'],
  ]);

  console.log(`Found ${pendingOrders.length} pending razorpay orders older than 15 minutes`);

  for (const order of pendingOrders) {
    try {
      const rzpOrder = await getRazorpay().orders.fetch(order.razorpay_order_id);

      if (rzpOrder.status === RazorpayOrder.STATUS_PAID) {
        const payments = await getRazorpay().orders.fetchPayments(order.razorpay_order_id);
        const capturedPayment = payments.items?.find((p) => p.status === 'captured');
        const paymentId = capturedPayment?.id;

        await RazorpayOrder.update(
          [
            [RazorpayOrder.STATUS, RazorpayOrder.STATUS_PAID],
            [RazorpayOrder.RAZORPAY_PAYMENT_ID, paymentId],
          ],
          [RazorpayOrder.ID, order.id],
        );

        await ensurePurchaseOwnership(order.razorpay_order_id, paymentId);
        console.log(`Synced paid razorpay order ${order.razorpay_order_id}`);
      } else {
        // rzpOrder is 'attempted' or still 'created' — check individual payment statuses.
        // Prioritise in-progress payments: a retry after a failed first attempt
        // creates a second payment while the first remains 'failed' in items[].
        const payments = await getRazorpay().orders.fetchPayments(order.razorpay_order_id);
        const inProgress = payments.items?.find((p) => p.status === 'authorized' || p.status === 'created');
        if (inProgress) {
          if (order.status !== RazorpayOrder.STATUS_PENDING) {
            await RazorpayOrder.update(
              [
                [RazorpayOrder.STATUS, RazorpayOrder.STATUS_PENDING],
                [RazorpayOrder.RAZORPAY_PAYMENT_ID, inProgress.id],
              ],
              [RazorpayOrder.ID, order.id],
            );
            console.log(`Transitioned order ${order.razorpay_order_id} to pending (payment ${inProgress.id} in progress)`);
          }
        } else {
          const failedPayment = payments.items?.find((p) => p.status === 'failed');
          if (failedPayment) {
            await RazorpayOrder.update(
              [
                [RazorpayOrder.STATUS, RazorpayOrder.STATUS_FAILED],
                [RazorpayOrder.RAZORPAY_PAYMENT_ID, failedPayment.id],
              ],
              [RazorpayOrder.ID, order.id],
            );
            console.log(`Synced failed razorpay order ${order.razorpay_order_id} (payment ${failedPayment.id} failed)`);
          }
        }
      }
    } catch (error) {
      console.error(`Error syncing pending razorpay order ${order.razorpay_order_id}:`, error.message);
    }
  }
}

async function syncRefundsOnPaidOrders() {
  const ninetyDaysAgo = moment().subtract(90, 'days').format('YYYY-MM-DD HH:mm:ss');

  const ordersToCheck = await RazorpayOrder.for('internal').get('*', [
    [RazorpayOrder.STATUS, [RazorpayOrder.STATUS_PAID, RazorpayOrder.STATUS_REFUNDING], 'IN'],
    'AND',
    [RazorpayOrder.RAZORPAY_PAYMENT_ID, null, 'IS NOT'],
    'AND',
    [RazorpayOrder.CREATED_AT, ninetyDaysAgo, '>'],
  ]);

  console.log(`Checking ${ordersToCheck.length} paid/refunding razorpay orders for refunds`);

  for (const order of ordersToCheck) {
    try {
      const payment = await getRazorpay().payments.fetch(order.razorpay_payment_id);

      if (payment.status === 'refunded') {
        console.log(`Found refunded payment ${order.razorpay_payment_id} for order ${order.razorpay_order_id}`);

        await RazorpayOrder.update([[RazorpayOrder.STATUS, RazorpayOrder.STATUS_REFUNDED]], [RazorpayOrder.ID, order.id]);

        if (order.product_type === RazorpayOrder.PRODUCT_SPONSOR) {
          await Sponsor.update([[Sponsor.STATUS, Sponsor.STATE_CANCELED]], [Sponsor.TOKEN, order.razorpay_payment_id]);
        } else {
          await Order.update(
            [
              [Order.STATE, Order.STATE_CANCELED],
              [Order.AMOUNT, 0],
            ],
            [Order.TOKEN, order.razorpay_payment_id],
          );

          await User.update(
            [
              [User.ACODE_PRO, 0],
              [User.PRO_PURCHASE_TOKEN, null],
              [User.PRO_PURCHASED_AT, null],
            ],
            [
              [User.PRO_PURCHASE_TOKEN, order.razorpay_payment_id],
              [User.ACODE_PRO, 1],
            ],
          );
        }

        notifyRefund(order.razorpay_payment_id).catch((err) => console.error('Failed to send refund email via cron:', err));
      }
    } catch (error) {
      console.error(`Error checking refund for payment ${order.razorpay_payment_id}:`, error.message);
    }
  }
}

async function updateRazorpayOrders() {
  await syncPendingOrders();
  await syncRefundsOnPaidOrders();
}

module.exports = updateRazorpayOrders;
