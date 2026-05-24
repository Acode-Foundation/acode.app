const Plugin = require('../entities/plugin');
const User = require('../entities/user');
const RazorpayOrder = require('../entities/razorpayOrder');
const sendEmail = require('./sendEmail');
const { formatAmount } = require('./helpers');
const { getSubunitDigits, getCurrencySymbol } = require('./currencyMap');

const PRO_WELCOME_MESSAGE =
  'You just made our day!<br><br>By getting <strong>Acode Pro</strong>, you\'re not just unlocking an ad-free experience and exclusive themes \u2014 you\'re directly supporting a small team of developers who pour their hearts into keeping Acode free and open-source for everyone.<br><br>Every Pro purchase means we can spend more time building features, fixing bugs, and making Acode the best mobile code editor out there. Seriously, thank you. It means the world to us.<br><br>If for any reason you need a refund, no hard feelings \u2014 you can request one within 2 hours from the <a href="https://acode.app/pro">Pro page</a>.<br><br>Happy coding!';

function pluginWelcomeMessage(pluginName, symbol, amount) {
  return `You've successfully purchased <strong>${pluginName}</strong> for ${symbol}${amount}.<br><br>You can now download and use the plugin right away. If you run into any issues or have questions, feel free to reach out at <a href="https://acode.app/contact">acode.app/contact</a>.<br><br>Thank you for supporting the Acode ecosystem and the developer behind this plugin!`;
}

/**
 * Send purchase confirmation email to user based on Razorpay payment ID.
 * @param {string} paymentId - Razorpay payment ID
 * @param {{ email: string, name: string }} [knownUser] - User object if already available (avoids DB lookup)
 */
async function notifyPurchase(paymentId, knownUser) {
  const [order] = await RazorpayOrder.get(
    [RazorpayOrder.USER_ID, RazorpayOrder.PLUGIN_ID, RazorpayOrder.PRODUCT_TYPE, RazorpayOrder.AMOUNT, RazorpayOrder.CURRENCY],
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
    sendEmail(user.email, user.name, 'You are awesome! Welcome to Acode Pro', PRO_WELCOME_MESSAGE).catch((err) =>
      console.error('Failed to send pro activation email:', err),
    );
  } else if (order.plugin_id) {
    const [plugin] = await Plugin.get([Plugin.ID, order.plugin_id]);
    const subunitDigits = getSubunitDigits(order.currency) ?? 2;
    const baseUnits = order.amount / 10 ** subunitDigits;
    const symbol = getCurrencySymbol(order.currency) || '';
    const amount = formatAmount(baseUnits, order.currency);
    const pluginName = plugin?.name || 'a plugin';
    sendEmail(user.email, user.name, 'Thank you for your purchase!', pluginWelcomeMessage(pluginName, symbol, amount)).catch((err) =>
      console.error('Failed to send plugin purchase email:', err),
    );
  }
}

module.exports = notifyPurchase;
