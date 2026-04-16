const Razorpay = require('razorpay');

let razorpayInstance = null;

module.exports = function getRazorpay() {
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
};
