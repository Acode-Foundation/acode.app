import PolicyPage from 'components/policyPage';

export default function TermsOfService() {
  // The page does not wait for the current threshold.
  const thresholdDisplay = <span aria-live='polite'>loading…</span>;
  loadThreshold().then((threshold) => thresholdDisplay.replaceChildren(threshold));

  return (
    <PolicyPage id='terms-of-service'>
      <h1>Terms of Service</h1>
      <p className='policy-meta'>
        <strong>Last Updated:</strong> November 23, 2026
      </p>
      <h2>Introduction</h2>
      <p>These Terms of Service govern your use of our website and app. By using our services, you agree to these terms.</p>
      <h2>Account</h2>
      <p>
        You must create an account to upload plugins or make purchases on our website. You are responsible for maintaining the confidentiality of your
        account information and password.
      </p>
      <h2>Content</h2>
      <p>
        You retain ownership of any plugins you upload to our website. However, by uploading a plugin, you grant us a non-exclusive, worldwide,
        perpetual license to use, copy, modify, and distribute the plugin in connection with our services. You represent and warrant that you have the
        right to grant this license and that your plugin does not infringe the intellectual property rights of any third party.
      </p>
      <h2>Purchases</h2>
      <h3>Plugin Purchases</h3>
      <p>
        You may purchase paid plugins on the Acode platform. Payments for plugin purchases made on the website are processed through{' '}
        <strong>Razorpay</strong>. Payments made through the Acode mobile app are processed through <strong>Google Play</strong>. By making a
        purchase, you agree to the payment terms of the respective payment provider.
      </p>
      <p>
        Plugin developers set the original plugin price in <strong>Indian Rupees (INR)</strong>. Checkout may display a converted price in your local
        currency. The final amount and currency shown at checkout are what you will be charged.
      </p>
      <h3>Acode Pro</h3>
      <p>
        Acode Pro is a one-time purchase that unlocks an ad-free experience and exclusive themes. Acode Pro payments are processed through{' '}
        <strong>Razorpay</strong>. The price of Acode Pro is set by Foxbiz Software Pvt. Ltd. and may be updated from time to time. The price
        displayed at the time of purchase is the amount you will be charged.
      </p>
      <h3>Refunds</h3>
      <p>
        Plugin purchases and Acode Pro purchases made via Razorpay are eligible for a <strong>self-service refund within 2 hours</strong> of purchase.
        After the 2-hour window, refunds are handled on a case-by-case basis by our support team. For full details, please see our{' '}
        <a href='/refund'>Refund Policy</a>.
      </p>
      <p>For purchases made through Google Play, refunds are subject to Google Play's refund policies.</p>
      <h3>Support</h3>
      <p>
        Plugin developers are responsible for technical support for their plugins, including installation, functionality, compatibility, and bug
        fixes. Acode handles payment and refund issues, subject to the payment provider's rules and our <a href='/refund'>Refund Policy</a>.
      </p>
      <h2>Developer Payments</h2>
      <p>
        Developers earn from eligible plugin sales and download counts. Payments are made to the developer's default payment method. Available methods
        may include Indian and overseas bank accounts and PayPal, and are listed when you add a payment method.
      </p>
      <h3>Google Play Sales</h3>
      <p>
        Google deducts its service fees and applicable taxes before reporting net earnings. Acode imports these earnings reports through its scheduled
        earnings process. <strong>Developers receive 85% of the reported net earnings</strong>, and{' '}
        <strong>Foxbiz retains 15% of those net earnings as its platform commission</strong>. Google's service fees and taxes are not deducted again
        by Acode. Earnings without matching report data use the existing estimate of 70% of the recorded purchase amount; this is an estimate, not an
        additional deduction from Google's reported net earnings.
      </p>
      <h3>Razorpay Sales</h3>
      <p>
        <strong>Developers receive 70% of the original INR plugin price</strong>. Of that original price,{' '}
        <strong>15% is reserved for payment processing costs and applicable taxes</strong>, and{' '}
        <strong>15% is Foxbiz&#39;s platform commission</strong>. The developer share is based on the original INR plugin price, including when the
        buyer pays in another currency.
      </p>
      <h3>Payout Schedule</h3>
      <p>
        Eligible payouts are <strong>automatically initiated on the 16th of each month</strong> when unpaid earnings from previous months meet or
        exceed the current payout threshold and a valid default payment method is available. Foxbiz{' '}
        <strong>manually processes these payments within the next 10 business days</strong>. Initiation does not mean an immediate transfer; the
        receiving bank or payment provider may take additional time to credit the payment.
      </p>
      <h2>Payment Threshold</h2>
      <p className='policy-note'>
        The current minimum payout threshold is {thresholdDisplay}. This is the minimum accumulated unpaid earnings required for an eligible payout to
        be initiated. The threshold is managed through Acode's application settings, may be updated by the platform, and is also displayed on your{' '}
        <a href='/earnings'>Earnings page</a>. Earnings below the threshold carry forward to later months.
      </p>
      <p>Developers are responsible for their income-related tax obligations and any fees charged by their receiving bank or payment provider.</p>
      <h2>Limitation of Liability</h2>
      <p>
        Our services are provided "as is" without any warranties of any kind. We will not be liable for any damages, whether direct, indirect,
        incidental, or consequential, arising from your use of our services.
      </p>
      <h2>Termination</h2>
      <p>
        We may terminate your account and use of our services at any time, for any reason, with or without notice. If your account is terminated, any
        Acode Pro or plugin access associated with your account may be revoked without refund.
      </p>
      <h2>Changes to these Terms</h2>
      <p>
        We may update these Terms of Service from time to time. If we make changes, we will notify you by revising the date at the top of this policy.
        Your continued use of our services after any changes indicates your acceptance of the new terms.
      </p>
      <h2>Disputes</h2>
      <p>Any disputes arising from these Terms of Service will be resolved through arbitration.</p>
    </PolicyPage>
  );
}

async function loadThreshold() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch('/api/payment-threshold', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Payment threshold unavailable');
    const { threshold } = await response.json();
    if (!Number.isSafeInteger(threshold) || threshold <= 0) throw new Error('Invalid payment threshold');
    return <strong>₹{threshold.toLocaleString('en-IN')} INR</strong>;
  } catch {
    // Keep the Terms readable without displaying a guessed payout threshold.
    return (
      <span>
        temporarily unavailable; please check your <a href='/earnings'>Earnings page</a>
      </span>
    );
  } finally {
    clearTimeout(timeout);
  }
}
