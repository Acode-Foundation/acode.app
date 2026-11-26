import PolicyPage from 'components/policyPage';

export default function RefundPolicy() {
  return (
    <PolicyPage id='refund-policy'>
      <h1>Refund Policy</h1>
      <p className='policy-meta'>
        <strong>Company:</strong> Foxbiz Software Pvt. Ltd.
        <br />
        <strong>Effective Date:</strong> March 11, 2026
        <br />
        <strong>Last Updated:</strong> April 16, 2026
      </p>
      <h2>Overview</h2>
      <p>
        This Refund Policy applies to all purchases made on the Acode platform (acode.app), operated by <strong>Foxbiz Software Pvt. Ltd.</strong>,
        including <strong>plugin purchases</strong> and <strong>Acode Pro purchases</strong>.
      </p>
      <p>We want you to be satisfied with your purchase. If you are not completely satisfied, we are here to help.</p>
      <h2>Self-Service Refunds (Razorpay Purchases)</h2>
      <p>
        All purchases made via Razorpay, including plugin purchases on the website and Acode Pro, are eligible for a{' '}
        <strong>self-service refund within 2 hours</strong> of purchase.
      </p>
      <ul>
        <li>
          <strong>Plugin purchases:</strong> A "Request Refund" button is available on the plugin page while you are within the refund window.
        </li>
        <li>
          <strong>Acode Pro:</strong> A "Request Refund" button is available on the <a href='/pro'>Pro page</a> while you are within the refund
          window.
        </li>
      </ul>
      <p>Self-service refunds are processed automatically. No email or support ticket is required.</p>
      <p>
        Once the 2-hour window has passed, self-service refunds are no longer available. You may still contact our support team for assistance (see
        below).
      </p>
      <h2>Google Play Purchases</h2>
      <p>
        For purchases made through the Acode mobile app via Google Play, refunds are subject to <strong>Google Play's refund policies</strong>. Please
        request a refund through the Google Play Store or contact Google Play support directly.
      </p>
      <h2>Manual Refund Requests</h2>
      <p>If you are outside the self-service refund window, you may still be eligible for a manual refund if:</p>
      <ul>
        <li>You were charged but did not receive access to the plugin or Acode Pro.</li>
        <li>The plugin was significantly different from its description on the listing page.</li>
        <li>
          You experienced a technical issue that prevented you from using the plugin or Acode Pro, and it could not be resolved within a reasonable
          time.
        </li>
        <li>You were accidentally charged more than once for the same purchase.</li>
      </ul>
      <h2>Non-Refundable Situations</h2>
      <p>
        Refunds will <strong>not</strong> be issued in the following cases:
      </p>
      <ul>
        <li>You changed your mind after purchasing (and the 2-hour self-service window has passed).</li>
        <li>You do not have the technical skills required to use the plugin.</li>
        <li>You purchased the plugin or Acode Pro accidentally but have already accessed or used it beyond the refund window.</li>
        <li>The refund request is made more than 7 days after the original purchase date.</li>
      </ul>
      <h2>How to Request a Manual Refund</h2>
      <p>To request a manual refund (outside the 2-hour self-service window), please contact us at:</p>
      <p>
        <strong>Email:</strong> <a href='mailto:contact@acode.app'>contact@acode.app</a>
      </p>
      <p>Include the following details in your email:</p>
      <ul>
        <li>Your registered email address</li>
        <li>Whether this is a plugin purchase or Acode Pro purchase</li>
        <li>The name of the plugin (if applicable)</li>
        <li>The date of purchase</li>
        <li>The reason for your refund request</li>
        <li>Any relevant screenshots or transaction details</li>
      </ul>
      <h2>Refund Processing</h2>
      <ul>
        <li>
          <strong>Self-service refunds</strong> are initiated immediately. Please allow <strong>5-7 business days</strong> for the refund to appear in
          your account, depending on your bank or payment provider.
        </li>
        <li>
          <strong>Manual refund requests</strong> will be reviewed by our support team and responded to within <strong>3-5 business days</strong>.
          Approved refunds will be processed back to your original payment method. Please allow an additional <strong>5-10 business days</strong> for
          the refund to appear in your account.
        </li>
      </ul>
      <h2>Contact Us</h2>
      <p>If you have any questions about this Refund Policy, please reach out to us:</p>
      <ul>
        <li>
          <strong>Email:</strong> <a href='mailto:contact@acode.app'>contact@acode.app</a>
        </li>
        <li>
          <strong>Company:</strong> Foxbiz Software Pvt. Ltd.
        </li>
      </ul>
      <p>We are committed to resolving any issues fairly and promptly.</p>
    </PolicyPage>
  );
}
