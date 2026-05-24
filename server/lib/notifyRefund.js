const Plugin = require('../entities/plugin');
const User = require('../entities/user');
const RazorpayOrder = require('../entities/razorpayOrder');
const sendEmail = require('./sendEmail');

const PRO_REFUND_MESSAGE =
  'Your <strong>Acode Pro</strong> refund has been initiated and should reflect in your account within 5-7 business days.<br><br>We\'re sad to see you go, and we\'d honestly love to know what made you change your mind. Was it something we could do better? A missing feature? Or just not the right time?<br><br>If you have a moment, please drop us a note at <a href="https://acode.app/contact">acode.app/contact</a> \u2014 your feedback genuinely helps us improve Acode for everyone.<br><br>The door is always open if you ever want to come back.';

function pluginRefundMessage(pluginName) {
  return `Your refund for <strong>${pluginName}</strong> has been initiated and should reflect in your account within 5-7 business days.<br><br>We'd honestly love to know what made you change your mind. Was it something we could do better? A missing feature? Or just not the right fit?<br><br>If you have a moment, please drop us a note at <a href="https://acode.app/contact">acode.app/contact</a> \u2014 your feedback genuinely helps us improve Acode for everyone.<br><br>The door is always open if you ever want to come back.`;
}

/**
 * Send refund notification email to user based on Razorpay payment ID.
 * @param {string} paymentId - Razorpay payment ID
 * @param {{ email: string, name: string }} [knownUser] - User object if already available (avoids DB lookup)
 */
async function notifyRefund(paymentId, knownUser) {
  const [order] = await RazorpayOrder.get(
    [RazorpayOrder.USER_ID, RazorpayOrder.PLUGIN_ID, RazorpayOrder.PRODUCT_TYPE],
    [RazorpayOrder.RAZORPAY_PAYMENT_ID, paymentId],
  );
  if (!order) return;

  let user = knownUser;
  if (!user) {
    const [fetched] = await User.get([User.EMAIL, User.NAME], [User.ID, order.user_id]);
    user = fetched;
  }
  if (!user) return;

  if (order.product_type === RazorpayOrder.PRODUCT_PRO) {
    sendEmail(user.email, user.name, "We're sorry to see you go", PRO_REFUND_MESSAGE).catch((err) =>
      console.error('Failed to send pro refund email:', err),
    );
  } else if (order.plugin_id) {
    const [plugin] = await Plugin.get([Plugin.ID, order.plugin_id]);
    const pluginName = plugin?.name || 'a plugin';
    sendEmail(user.email, user.name, "We're sorry to see you go", pluginRefundMessage(pluginName)).catch((err) =>
      console.error('Failed to send plugin refund email:', err),
    );
  }
}

module.exports = notifyRefund;
