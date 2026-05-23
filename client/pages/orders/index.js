import './style.scss';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import DialogBox from 'components/dialogs/dialogBox';
import { getLoggedInUser, hideLoading, showLoading } from 'lib/helpers';
import Router from 'lib/Router';
import moment from 'moment';

export default async function Orders() {
  let user;
  try {
    showLoading();
    user = await getLoggedInUser();
  } catch (err) {
    console.error(err);
  } finally {
    hideLoading();
  }

  if (!user) {
    return (
      <section id='orders'>
        <div className='empty-state'>
          <span className='icon account_circle' style={{ fontSize: '48px', opacity: 0.3 }} />
          <h2>Login to view your orders</h2>
          <p>You need to be logged in to see your order history.</p>
          <a href='/login?redirect=/orders' className='login-link'>
            <span className='icon login' />
            <span>Login</span>
          </a>
        </div>
      </section>
    );
  }

  const orders = await fetchOrders();

  const hasPending = orders.some((o) => o.status === 'created');
  if (hasPending) {
    const pollInterval = setInterval(async () => {
      try {
        const fresh = await fetchOrders();
        const stillPending = fresh.filter((o) => o.status === 'created');
        if (stillPending.length !== orders.filter((o) => o.status === 'created').length) {
          window.location.reload();
        }
      } catch {
        // Ignore polling errors
      }
    }, 30000);

    function cleanup() {
      clearInterval(pollInterval);
      window.removeEventListener('beforeunload', cleanup);
      Router.off('navigate', cleanup);
    }

    window.addEventListener('beforeunload', cleanup);
    Router.on('navigate', cleanup);
  }

  /**
   * @param {{ id: number, pluginName: string, status: string, amount: string, currencySymbol: string, createdAt: string, productType: string, razorpayOrderId: string }} order
   */
  function OrderRow(order) {
    const statusConfig = {
      paid: { label: 'Paid', className: 'status-paid' },
      created: { label: 'Pending', className: 'status-pending' },
      failed: { label: 'Failed', className: 'status-failed' },
      refunded: { label: 'Refunded', className: 'status-refunded' },
      cancelled: { label: 'Cancelled', className: 'status-cancelled' },
    };

    const config = statusConfig[order.status] || { label: order.status, className: '' };

    const handleView = async () => {
      showLoading();
      try {
        if (!order.razorpayOrderId) {
          hideLoading();
          alert('ORDER DETAILS', `Acode Pro purchased on ${moment(order.createdAt).format('DD MMMM YYYY')}.`);
          return;
        }

        const detail = await fetch(`/api/razorpay/orders/${order.razorpayOrderId}`).then((r) => r.json());
        hideLoading();

        const body = <div className='order-detail-body' />;

        const rows = [
          { label: 'Status', value: config.label },
          { label: 'Amount', value: `${order.currencySymbol}${order.amount}` },
          { label: 'Date', value: moment(order.createdAt).format('DD MMMM YYYY, hh:mm A') },
        ];

        if (detail.razorpayOrderId) rows.push({ label: 'Order ID', value: detail.razorpayOrderId });
        if (detail.razorpayPaymentId) rows.push({ label: 'Payment ID', value: detail.razorpayPaymentId });
        if (detail.receipt) rows.push({ label: 'Receipt', value: detail.receipt });

        body.append(
          <div className='order-detail-item'>
            <strong>{order.productType === 'acode_pro' ? 'Acode Pro' : detail.pluginName}</strong>
          </div>,
        );

        for (const row of rows) {
          body.append(
            <div className='order-detail-row'>
              <span className='order-detail-label'>{row.label}</span>
              <span className='order-detail-value'>{row.value}</span>
            </div>,
          );
        }

        let refundBtn = null;

        if (detail.refundEligible) {
          refundBtn = (
            <button
              type='button'
              className='refund-button'
              onclick={async () => {
                if (order.productType === 'acode_pro') {
                  const ok = await confirm('REFUND', 'Are you sure you want to refund Acode Pro?');
                  if (!ok) return;
                  const res = await fetch('/api/razorpay/refund-pro', { method: 'POST' }).then((r) => r.json());
                  if (res.success) {
                    alert('SUCCESS', 'Refund initiated. It may take 5-7 business days to reflect.');
                    setTimeout(() => window.location.reload(), 2000);
                  } else {
                    alert('ERROR', res.error || 'Refund failed');
                  }
                } else {
                  const ok = await confirm('REFUND', 'Are you sure you want to refund this plugin?');
                  if (!ok) return;
                  const res = await fetch('/api/razorpay/refund-plugin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId: detail.purchaseOrderId }),
                  }).then((r) => r.json());
                  if (res.success) {
                    alert('SUCCESS', 'Refund initiated.');
                    setTimeout(() => window.location.reload(), 2000);
                  } else {
                    alert('ERROR', res.error || 'Refund failed');
                  }
                }
              }}
            >
              Request Refund
            </button>
          );
          body.append(refundBtn);
        }

        document.querySelector('.dialog-box-container')?.remove();
        document.body.append(<DialogBox title='ORDER DETAILS' body={body} onok={(hide) => hide()} oncancel={(hide) => hide()} />);
      } catch (err) {
        console.error(err);
        hideLoading();
        alert('ERROR', 'Failed to load order details');
      }
    };

    const handleCancel = async (e) => {
      e.stopPropagation();
      const ok = await confirm('CANCEL', 'Cancel this pending order?');
      if (!ok) return;
      try {
        const res = await fetch('/api/razorpay/cancel-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ razorpayOrderId: order.razorpayOrderId }),
        }).then((r) => r.json());
        if (res.success) {
          alert('INFO', `Order ${res.status || 'cancelled'} successfully.`);
          setTimeout(() => window.location.reload(), 800);
        } else {
          alert('ERROR', res.error);
        }
      } catch (err) {
        console.error(err);
        alert('ERROR', 'Failed to cancel order');
      }
    };

    const handleRetry = (e) => {
      e.stopPropagation();
      if (order.productType === 'acode_pro') {
        Router.loadUrl('/pro');
      } else if (order.pluginId) {
        Router.loadUrl(`/plugin/${order.pluginId}`);
      }
    };

    return (
      <tr className='order-row' onclick={handleView}>
        <td className='order-plugin'>
          <span className={order.productType === 'acode_pro' ? 'icon star' : 'icon extension'} />
          <span>{order.productType === 'acode_pro' ? 'Acode Pro' : order.pluginName}</span>
        </td>
        <td className='order-amount'>
          {order.currencySymbol}
          {order.amount}
        </td>
        <td className='order-status'>
          <span className={`status-badge ${config.className}`}>{config.label}</span>
        </td>
        <td className='order-date'>{moment(order.createdAt).format('DD MMM YYYY')}</td>
        <td className='order-actions'>
          {order.status === 'created' && (
            <button type='button' onclick={handleCancel} className='cancel-btn'>
              Cancel
            </button>
          )}
          {order.status === 'failed' && (
            <button type='button' onclick={handleRetry} className='retry-btn'>
              Retry
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <section id='orders'>
      <div className='orders-header'>
        <h1>My Orders</h1>
        <p>Your purchase history and pending orders</p>
      </div>

      {orders.length === 0 ? (
        <div className='empty-state'>
          <span className='icon shopping_cart' style={{ fontSize: '48px', opacity: 0.3 }} />
          <h2>No orders yet</h2>
          <p>Browse the plugin store to discover plugins you might like.</p>
          <a href='/plugins' className='login-link'>
            <span className='icon store' />
            <span>Browse Plugins</span>
          </a>
        </div>
      ) : (
        <div className='table-wrapper'>
          <table className='orders-table'>
            <thead>
              <tr>
                <th>Item</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <OrderRow {...order} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className='orders-info'>
        <h3>Need help?</h3>
        <p>
          If your payment is stuck in <strong>Pending</strong> for more than a few hours, payments are usually confirmed automatically. If you see a{' '}
          <strong>Failed</strong> status, no money was deducted and you can try again. For other issues, contact us at{' '}
          <a href='/contact'>acode.app/contact</a>.
        </p>
      </div>
    </section>
  );
}

async function fetchOrders() {
  try {
    const res = await fetch('/api/razorpay/orders');
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error('Unexpected response format');
    }
    return data;
  } catch (error) {
    console.error('Failed to fetch orders:', error);
    return [];
  }
}
