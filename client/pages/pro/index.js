import './style.scss';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import { initiateProCheckout } from 'components/razorpayCheckout';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser, hideLoading, showLoading } from 'lib/helpers';

export default async function Pro() {
  const statusRef = Ref();
  const loggedInUser = await getLoggedInUser();

  showLoading();
  let proStatus;
  try {
    const res = await fetch('/api/razorpay/pro-status');
    proStatus = await res.json();
  } catch {
    proStatus = { isPro: false, price: 370, refundEligible: false };
  }
  hideLoading();

  const { isPro, price, refundEligible, purchasedAt } = proStatus;

  return (
    <section id='pro-page'>
      <div className='pro-hero'>
        <span className='pro-badge-label'>One-time purchase</span>
        <h1>
          Support <span className='highlight'>Acode</span>
        </h1>
        <p className='subtitle'>
          Acode is a free, open-source code editor built for mobile developers. Your support keeps the project alive, independent, and growing.
        </p>
      </div>

      <div className='pro-perks'>
        <div className='perk-card'>
          <div className='perk-icon'>
            <span className='icon certificate' />
          </div>
          <h3>Ad-free experience</h3>
          <p>Code without interruptions or distractions</p>
        </div>
        <div className='perk-card'>
          <div className='perk-icon'>
            <span className='icon star' />
          </div>
          <h3>Exclusive themes</h3>
          <p>Access premium editor themes and color schemes</p>
        </div>
        <div className='perk-card'>
          <div className='perk-icon'>
            <span className='icon favorite' />
          </div>
          <h3>Supporter badge</h3>
          <p>A Pro badge on your profile to show your support</p>
        </div>
      </div>

      <div ref={statusRef} className='pro-action'>
        {process.env.RAZORPAY_ENABLED && (
          <div className='website-purchase-info' style={{ justifyContent: 'center', marginBottom: '16px' }}>
            <span className='icon info' />
            Purchases made via website are supported in Acode v1.12.0 and above.
          </div>
        )}
        {renderAction()}
      </div>

      <div className='pro-footer-note'>
        <p>100% of proceeds go to the maintainers of this open-source project.</p>
        <p>Refunds available within 2 hours of purchase — no questions asked.</p>
      </div>
    </section>
  );

  function renderAction() {
    if (!loggedInUser) {
      return (
        <div className='login-prompt'>
          <div className='price-tag'>
            <span className='currency'>&#8377;</span>
            <span className='amount'>{price}</span>
          </div>
          <a href={`/login?redirect=/pro`} className='btn primary'>
            Login to Purchase
          </a>
        </div>
      );
    }

    if (isPro) {
      return (
        <div className='pro-active'>
          <div className='active-badge'>
            <span className='icon verified' />
            <span>You have Acode Pro</span>
          </div>
          <p className='thank-you'>Thank you for supporting open source!</p>
          {refundEligible && (
            <div className='refund-section'>
              <p className='refund-info'>
                Purchased {formatTimeAgo(purchasedAt)} &middot; Refund window closes in {formatTimeRemaining(purchasedAt)}
              </p>
              <button type='button' className='btn-refund' onclick={handleRefund}>
                Request Refund
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className='buy-section'>
        <div className='price-tag'>
          <span className='currency'>&#8377;</span>
          <span className='amount'>{price}</span>
        </div>
        <button type='button' className='btn-buy' onclick={handleBuy}>
          <span className='icon favorite' />
          <span>Get Acode Pro</span>
        </button>
        <p className='one-time'>One-time payment. No subscriptions.</p>
      </div>
    );
  }

  async function handleBuy() {
    const btn = statusRef.el.get('.btn-buy');
    if (btn) btn.disabled = true;

    const userInfo = { email: loggedInUser.email, name: loggedInUser.name };
    await initiateProCheckout(
      userInfo,
      () => {
        window.location.reload();
      },
      () => {
        if (btn) btn.disabled = false;
      },
    );
  }

  async function handleRefund() {
    const confirmed = await confirm('Refund Acode Pro', 'Are you sure you want to refund? You will lose all Pro features.');
    if (!confirmed) return;

    showLoading();
    try {
      const res = await fetch('/api/razorpay/refund-pro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (data.success) {
        window.location.reload();
      } else {
        alert('Error', data.error || 'Failed to process refund');
      }
    } catch (error) {
      alert('Error', error.message || 'Failed to process refund');
    } finally {
      hideLoading();
    }
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ago`;
  }

  function formatTimeRemaining(dateStr) {
    if (!dateStr) return '';
    const twoHours = 2 * 60 * 60 * 1000;
    const remaining = twoHours - (Date.now() - new Date(dateStr).getTime());
    if (remaining <= 0) return '0m';
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
}
