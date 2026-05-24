/* eslint-disable no-console */
const updateRazorpayOrders = require('../lib/updateRazorpayOrders');
const { createNotifier } = require('../lib/cronNotifier');

const notifier = createNotifier('Razorpay sync', { threshold: 3 });

module.exports = async () => {
  try {
    await updateRazorpayOrders();
    notifier.success();
  } catch (error) {
    notifier.failure(error);
  }
};
