/**
 * Razorpay Checkout Component
 * Handles web-based plugin purchases via Razorpay payment gateway
 */

import alert from 'components/dialogs/alert';
import Ref from 'html-tag-js/ref';

// Load Razorpay script dynamically
let razorpayLoaded = false;
function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (razorpayLoaded) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => {
      razorpayLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Razorpay script'));
    document.head.appendChild(script);
  });
}

/**
 * Check if user owns a plugin
 * @param {string} pluginId
 * @returns {Promise<boolean>}
 */
export async function checkPluginOwnership(pluginId) {
  try {
    const res = await fetch(`/api/razorpay/check-ownership/${pluginId}`);
    const data = await res.json();
    return data.owned === true;
  } catch {
    return false;
  }
}

/**
 * Razorpay checkout configuration
 */
const RAZORPAY_CONFIG = {
  theme: {
    color: '#2563eb',
    backdrop_color: 'rgba(15, 23, 42, 0.8)',
  },
  branding: {
    name: 'Acode Plugin Store',
    image: '/logo-512.png',
  },
};

/**
 * Initiate Razorpay checkout for a plugin
 * @param {string} pluginId
 * @param {Object} userInfo - User information for prefill
 * @param {string} [userInfo.email] - User's email address
 * @param {string} [userInfo.name] - User's name
 * @param {Function} onSuccess - Callback on successful payment
 * @returns {Promise<void>}
 */
export async function initiateCheckout(pluginId, userInfo = {}, onSuccess) {
  try {
    // Load Razorpay script if not already loaded
    await loadRazorpayScript();

    // Create order on server
    const orderRes = await fetch('/api/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId }),
    });

    const orderData = await orderRes.json();

    if (orderData.error) {
      alert('ERROR', orderData.error);
      return;
    }

    const { orderId, amount, currency, keyId, pluginName, userEmail } = orderData;

    // Open Razorpay checkout with customization
    const options = {
      key: keyId,
      amount,
      currency,
      name: RAZORPAY_CONFIG.branding.name,
      description: `Purchase: ${pluginName}`,
      image: RAZORPAY_CONFIG.branding.image,
      order_id: orderId,
      handler: async (response) => {
        // Verify payment on server
        const verifyRes = await fetch('/api/razorpay/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            pluginId,
          }),
        });

        const verifyData = await verifyRes.json();

        if (verifyData.success) {
          alert('SUCCESS', 'Payment successful! You can now download this plugin.');
          if (onSuccess) onSuccess();
        } else {
          alert('ERROR', verifyData.error || 'Payment verification failed');
        }
      },
      // Prefill user information (email preferred over contact for web)
      prefill: {
        email: userInfo.email || userEmail || '',
        name: userInfo.name || '',
        // Note: contact (phone) is required by Razorpay for Indian regulations
        // but email will be shown as primary identifier
      },
      // Theme customization
      theme: {
        color: RAZORPAY_CONFIG.theme.color,
        backdrop_color: RAZORPAY_CONFIG.theme.backdrop_color,
      },
      // Modal behavior
      modal: {
        confirm_close: true, // Ask before closing
        escape: true, // Allow ESC to close
        animation: true, // Enable animations
        ondismiss: () => {
          // Checkout closed by user
        },
      },
      // Additional checkout preferences
      notes: {
        pluginId,
        source: 'acode_web',
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', (response) => {
      alert('ERROR', `Payment failed: ${response.error.description}`);
    });
    rzp.open();
  } catch (error) {
    console.error('Checkout error:', error);
    alert('ERROR', error.message || 'Failed to initiate checkout');
  }
}

/**
 * Buy Button Component for paid plugins
 * @param {Object} props
 * @param {string} props.pluginId - Plugin ID
 * @param {number} props.price - Plugin price in INR
 * @param {Object} [props.user] - Logged in user object
 * @param {Function} [props.onPurchaseComplete] - Callback after successful purchase
 * @returns {HTMLElement}
 */
export default function BuyButton({ pluginId, price, user, onPurchaseComplete }) {
  const buttonRef = Ref();
  const buttonTextRef = Ref();

  const handleClick = async () => {
    buttonRef.el.disabled = true;
    buttonTextRef.el.textContent = 'Processing...';

    // Pass user info for email prefill
    const userInfo = user ? { email: user.email, name: user.name } : {};
    await initiateCheckout(pluginId, userInfo, () => {
      buttonTextRef.el.textContent = 'Purchased ✓';
      buttonRef.el.disabled = true;
      if (onPurchaseComplete) onPurchaseComplete();
    });

    // Reset button if payment was cancelled
    if (buttonTextRef.el.textContent === 'Processing...') {
      buttonTextRef.el.textContent = `Buy ₹${price}`;
      buttonRef.el.disabled = false;
    }
  };

  return (
    <button ref={buttonRef} type='button' className='buy-button' onclick={handleClick}>
      <span className='icon shopping_cart' />
      <span ref={buttonTextRef}>Buy ₹{price}</span>
    </button>
  );
}
