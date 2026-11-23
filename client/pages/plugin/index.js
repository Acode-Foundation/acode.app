import './style.scss';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import prompt from 'components/dialogs/prompt';
import AdSense from 'components/adsense';
import CurrencySelector from 'components/currencySelector';
import EditorType from 'components/editorType';
import MonthSelect from 'components/MonthSelect';
import Markdown from 'components/markdown';
import PluginSecurity from 'components/pluginSecurity';
import PluginStatus from 'components/pluginStatus';
import BuyButton, { checkPluginOwnership } from 'components/razorpayCheckout';
import Tabs from 'components/tabs';
import YearSelect from 'components/YearSelect';
import Ref from 'html-tag-js/ref';
import { calcRating, getLoggedInUser, gravatar, hideLoading, showLoading } from 'lib/helpers';
import { applyErrorMetadata, applyPluginMetadata } from 'lib/pageMetadata';
import Router from 'lib/Router';
import { since } from 'lib/relativeTime';
import moment from 'moment/moment';
import { safeRepositoryUrl } from '../../../shared/repositoryUrl';

export default async function Plugin({ id: pluginId, section = 'description', callback = '', initialDetail }) {
  const pathname = window.location.pathname;
  let plugin = null;

  try {
    showLoading();
    const response = await fetch(`/api/plugin/${pluginId}`);
    if (response.status === 404) {
      applyErrorMetadata(pathname, 'Plugin not found');
      return (
        <div className='error'>
          Plugin not found. <a href='/plugins'>All plugins</a>
        </div>
      );
    }
    plugin = await response.json();
    if (response.ok === false || plugin.error) {
      throw new Error(plugin.error || 'Unable to load plugin');
    }
  } catch (error) {
    if (initialDetail) return initialDetail;
    applyErrorMetadata(pathname, 'Unable to load plugin');
    return <div className='error'>{error.message}</div>;
  } finally {
    hideLoading();
  }

  const {
    id,
    name,
    price,
    status_text,
    author,
    version,
    license,
    downloads,
    repository,
    description,
    currencySymbol,
    user_id: userId,
    votes_up: votesUp,
    votes_down: votesDown,
    comment_count: commentCount,
    package_updated_at: updatedAt,
    author_verified: authorVerified,
    supported_editor: supportedEditor,
  } = plugin;

  if (window.location.pathname === pathname) applyPluginMetadata(plugin);

  const repositoryUrl = safeRepositoryUrl(repository);

  const user = await getLoggedInUser().catch(() => null);
  const pluginSectionRef = Ref();
  const ordersList = Ref();
  const commentListRef = Ref();
  const ratingRef = Ref();
  const selectYear = Ref();
  const selectMonth = Ref();
  const $comments = (
    <div className='comments' on:reviewdeleted={updateReviewSummary}>
      <p className='review-status' role='status' aria-live='polite' aria-atomic='true' />
      <div ref={commentListRef} className='list' />
      <p className='review-help'>Write a review in the Acode app.</p>
    </div>
  );
  const $description = (
    <article className='plugin-description' style={{ width: '100%', overflow: 'auto' }}>
      <AdSense name='readme' style={{ position: 'relative' }} />
      <Markdown content={description} />
    </article>
  );
  const updateOrder = () => {
    renderOrders(ordersList, pluginId, selectYear.value, selectMonth.value);
  };
  const $orders = <Order />;
  const shouldShowOrders = user && (user.id === userId || user.isAdmin) && !!plugin.price;
  const canSeeScans = Boolean(user && (user.id === userId || user.isAdmin));

  const canInstall =
    /android|iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  let userOwnsPlugin = false;
  let purchaseInfo = null;

  // Check if logged-in user owns this paid plugin (for web purchases)
  if (user && price) {
    userOwnsPlugin = await checkPluginOwnership(id);
    if (userOwnsPlugin) {
      try {
        purchaseInfo = await fetch(`/api/razorpay/my-purchases/${id}`).then((r) => r.json());
      } catch (err) {
        console.error('Failed to fetch purchase info:', err);
      }
    }
  }

  let hasPendingOrder = false;
  if (user && price && !userOwnsPlugin) {
    try {
      const pendingOrders = await fetch('/api/razorpay/orders?status=pending&productType=plugin').then((r) => r.json());
      hasPendingOrder = pendingOrders.some((o) => String(o.pluginId) === String(id));
    } catch {
      // Ignore
    }
  }

  if (shouldShowOrders) {
    renderOrders(ordersList, pluginId);
  }

  function PurchaseSection() {
    if (userOwnsPlugin) {
      const refundHandler = async (e) => {
        const ok = await confirm('REFUND', 'Are you sure you want to refund this plugin? This action cannot be undone.');
        if (!ok) return;
        const btn = e.target.closest('.refund-button');
        btn.disabled = true;
        btn.querySelector('span:last-child').textContent = 'Processing...';
        try {
          const res = await fetch('/api/razorpay/refund-plugin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: purchaseInfo.purchaseOrderId }),
          });
          const data = await res.json();
          if (data.success) {
            if (callback === 'app') {
              window.location = `acode://plugin/uninstall/${id}`;
            } else {
              window.location.reload();
            }
          } else {
            alert('ERROR', data.error || 'Refund failed');
            btn.disabled = false;
            btn.querySelector('span:last-child').textContent = 'Request Refund';
          }
        } catch (err) {
          console.error('Plugin refund error:', err);
          alert('ERROR', 'Failed to process refund. Please try again.');
          btn.disabled = false;
          btn.querySelector('span:last-child').textContent = 'Request Refund';
        }
      };

      return (
        <div className='purchase-card purchased'>
          <div className='purchase-card-main'>
            <div className='purchase-card-badge'>
              <span className='icon check_circle' />
              <span>You own this plugin</span>
            </div>
            {purchaseInfo && (
              <div className='purchase-card-details'>
                Paid
                <span style={{ fontWeight: 'bold' }}>
                  {purchaseInfo.purchaseAmountCurrencySymbol}
                  {purchaseInfo.purchaseAmount}
                </span>
                <span className='dot'>·</span>
                <span>{moment(purchaseInfo.purchasedAt).format('DD MMM YYYY')}</span>
                <span className='dot'>·</span>
                <span>{purchaseInfo.purchaseProvider === 'razorpay' ? 'Razorpay' : 'Google Play'}</span>
              </div>
            )}
          </div>
          {Boolean(purchaseInfo?.refundEligible) && (
            <button type='button' className='refund-button' onclick={refundHandler}>
              <span className='icon replay' />
              <span>Request Refund</span>
            </button>
          )}
        </div>
      );
    }

    if (hasPendingOrder) {
      return (
        <div className='purchase-card pending'>
          <div className='purchase-card-main'>
            <div className='purchase-card-badge pending'>
              <span className='icon hourglass_top' />
              <span>Payment Pending</span>
            </div>
            <div className='purchase-card-details'>
              <span>Your payment is being processed</span>
              <span className='dot'>·</span>
              <span>We'll notify you once confirmed</span>
            </div>
          </div>
          <a href='/orders' className='view-orders-link'>
            <span>View Orders</span>
            <span className='icon chevron_right' />
          </a>
        </div>
      );
    }

    if (user) {
      return (
        <div className='purchase-card'>
          <div className='purchase-card-main'>
            <div className='purchase-card-price'>
              <CurrencySelector>
                <span className='currency'>{currencySymbol}</span>
                <span className='amount'>{price}</span>
              </CurrencySelector>
            </div>
            <div className='purchase-card-details'>
              <span>One-time purchase</span>
              <span className='dot'>·</span>
              <span>Instant access</span>
            </div>
          </div>
          <BuyButton
            user={user}
            pluginId={id}
            onPurchaseComplete={() => {
              if (callback === 'app') {
                window.location = `acode://plugin/purchased/${id}`;
              } else {
                window.location.reload();
              }
            }}
          />
        </div>
      );
    }

    return (
      <div className='purchase-card'>
        <div className='purchase-card-main'>
          <div className='purchase-card-price'>
            <CurrencySelector>
              <span className='currency'>{currencySymbol}</span>
              <span className='amount'>{price}</span>
            </CurrencySelector>
          </div>
          <div className='purchase-card-details'>
            <span>One-time purchase</span>
          </div>
        </div>
        <a href={`/login?redirect=/plugin/${pluginId}`} className='login-to-buy' data-google-vignette='false'>
          <span className='icon account_circle' />
          <span>Login to Purchase</span>
        </a>
      </div>
    );
  }

  return (
    <section ref={pluginSectionRef} id='plugin' className={user?.isAdmin && status_text ? 'has-status-actions' : ''}>
      <div className='row plugin-head google-anno-skip'>
        <div className='plugin-logo'>
          <img src={`/plugin-icon/${id}`} alt={name} attr-fetchpriority='high' />
          {canInstall && (
            <button type='button' onclick={() => window.open(`acode://plugin/install/${pluginId}`)}>
              <span className='icon download' /> Install
            </button>
          )}
        </div>
        <div className='info-container'>
          <div className='plugin-title'>
            <strong>{name}</strong>
            <PluginStatus status={status_text} id={id} name={name} style='page' />
          </div>
          {updatedAt && <small>Updated {since(updatedAt)}</small>}
          <div className='info'>
            {supportedEditor && <EditorType type={supportedEditor} className='chip' />}
            <span className='chip'>v {version}</span>
            {+downloads ? (
              <div className='chip'>
                <span className='icon download' />
                <span>{downloads.toLocaleString()}</span>
              </div>
            ) : (
              <div className='chip'>
                <span style={{ color: 'gold' }}>New</span>
              </div>
            )}
            {license && license.toLowerCase() !== 'unknown' && (
              <div className='chip'>
                <span className='icon certificate' />
                <span>{license}</span>
              </div>
            )}
            {votesUp + votesDown > 0 && (
              <div
                className='chip'
                onclick={() => {
                  const btn = pluginSectionRef.get('[data-tab="comments"]');
                  if (btn) btn.click();
                }}
              >
                <img src='/thumbs-up.gif' alt='thumbs up' />
                <span ref={ratingRef}>{calcRating(votesUp, votesDown)}</span>
              </div>
            )}
          </div>
          <div className='info'>
            <span className='chip'>
              <a href={`/profile/${userId}`}>{author}</a>&nbsp;{!!authorVerified && <span className='icon verified' />}
            </span>
            {repositoryUrl && (
              <a className='chip' href={repositoryUrl} rel='noopener noreferrer nofollow'>
                repository
              </a>
            )}
          </div>
        </div>
      </div>
      {Boolean(process.env.RAZORPAY_ENABLED && price) && (
        <div className='plugin-head'>
          <PurchaseSection />
          <div className='website-purchase-info'>
            <span className='icon info' />
            Purchases made via website are supported in Acode v1.12.0 and above.
          </div>
        </div>
      )}
      <div className='detailed'>
        <Tabs
          variant='underline'
          defaultActive={section}
          onChange={(tabId) => {
            Router.setUrl(`/plugin/${pluginId}/${tabId}`);
            applyPluginMetadata(plugin);
          }}
          tabs={[
            { id: 'description', label: 'Description', content: $description },
            {
              id: 'changelogs',
              label: 'Changelogs',
              content: () =>
                plugin.changelogs ? (
                  <Markdown content={plugin.changelogs} />
                ) : (
                  <span style={{ opacity: 0.8, fontSize: 'italic' }}>No changelogs</span>
                ),
            },
            {
              id: 'comments',
              label: reviewTabLabel(commentCount),
              content: () => {
                renderComments(commentListRef, userId, user, pluginId, author);
                return $comments;
              },
            },
            { id: 'orders', label: 'Orders', visible: shouldShowOrders, content: $orders },
            {
              id: 'security',
              label: 'Security',
              visible: canSeeScans,
              content: () => <PluginSecurity pluginId={pluginId} isAdmin={Boolean(user?.isAdmin)} />,
            },
          ]}
        />
      </div>
    </section>
  );

  function updateReviewSummary({ detail: { vote } }) {
    plugin.comment_count = Math.max(0, plugin.comment_count - 1);
    if (vote === 1) plugin.votes_up = Math.max(0, plugin.votes_up - 1);
    if (vote === -1) plugin.votes_down = Math.max(0, plugin.votes_down - 1);
    const tab = pluginSectionRef.el.querySelector('[data-tab="comments"]');
    if (tab) tab.textContent = reviewTabLabel(plugin.comment_count);
    if (ratingRef.el) {
      ratingRef.textContent = calcRating(plugin.votes_up, plugin.votes_down);
      if (!plugin.votes_up && !plugin.votes_down) ratingRef.el.parentElement.remove();
    }
    applyPluginMetadata(plugin);
  }

  function Order() {
    return (
      <div>
        <div style={{ textAlign: 'center' }}>
          <YearSelect ref={selectYear} onChange={updateOrder} />
          <MonthSelect ref={selectMonth} onChange={updateOrder} />
        </div>
        <div className='table-wrapper'>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Package</th>
                <th>Provider</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody ref={ordersList}>
              <tr>
                <td colspan='5'>Loading...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }
}

async function renderOrders(ref, pluginId, year, month) {
  ref.innerHTML = '';
  if (!month) month = moment().month();
  if (!year) year = moment().year();
  const url = `/api/plugin/orders/${pluginId}/${year}/${month}`;
  const orders = await fetch(url).then((res) => res.json());

  if (!orders.length) {
    ref.append(
      <tr>
        <td colspan='5' style={{ textAlign: 'center', opacity: 0.6, padding: '20px 0' }}>
          No orders for this period
        </td>
      </tr>,
    );
    return;
  }

  for (const order of orders) {
    const date = moment(order.created_at).format('DD MMMM YYYY');
    const statusLabel = ['Completed', 'Cancelled', 'Pending'][Number(order.state)] || 'Unknown';
    const statusClass = statusLabel.toLowerCase();
    const packageName = /free$/.test(order.package) ? 'Free' : 'Paid';
    const provider = order.provider === 'razorpay' ? 'Razorpay' : 'Google Play';
    ref.append(
      <tr className='order'>
        <td className='date'>{date}</td>
        <td className='date'>{packageName}</td>
        <td>{provider}</td>
        <td className='amount' style={{ whiteSpace: 'nowrap' }}>
          {order.currency}
          {order.amount.toFixed(2)}
        </td>
        <td className={`order-status ${statusClass}`}>{statusLabel}</td>
      </tr>,
    );
  }
}

function reviewTabLabel(count) {
  return `${count} ${count === 1 ? 'Review' : 'Reviews'}`;
}

/** @param {HTMLElement | Ref} ref A list element or a Ref already bound to one. */
async function renderComments(ref, pluginUserId, user, id, author) {
  const list = ref.el || ref;
  const restoreFocus = list.contains(document.activeElement);
  setReviewStatus(list, 'Loading reviews…');
  ref.innerHTML = '';
  ref.append(<p className='reviews-state'>Loading reviews…</p>);
  try {
    const response = await fetch(`/api/comments/${id}`);
    if (!response.ok) throw new Error('Unable to load reviews');
    const comments = await response.json();
    const reviews = comments.filter((comment) => comment?.comment?.trim());
    const cards = reviews.map((comment) => <Comment {...comment} user={user} pluginUserId={pluginUserId} pluginAuthor={author} />);
    ref.innerHTML = '';
    ref.append(...(cards.length ? cards : [<EmptyReviews />]));
    setReviewStatus(list, cards.length ? `${cards.length} ${cards.length === 1 ? 'review' : 'reviews'} loaded.` : 'No reviews yet.');
    if (restoreFocus && list.isConnected && document.activeElement === document.body) list.firstElementChild?.focus();
  } catch {
    ref.innerHTML = '';
    ref.append(
      <div className='reviews-state'>
        <p>Reviews couldn’t be loaded.</p>
        <button type='button' onclick={() => renderComments(ref, pluginUserId, user, id, author)}>
          Try again
        </button>
      </div>,
    );
    setReviewStatus(list, 'Reviews couldn’t be loaded. Try again.');
    if (restoreFocus && list.isConnected && document.activeElement === document.body) list.querySelector('button')?.focus();
  }
}

function setReviewStatus(list, message) {
  const status = list.closest('.comments')?.querySelector('.review-status');
  if (status) status.textContent = message;
}

function EmptyReviews() {
  return (
    <p className='reviews-state' tabIndex={-1}>
      No reviews yet. Be the first to share your experience in the app.
    </p>
  );
}

function Comment({
  id,
  comment,
  name,
  github,
  user_id: reviewerId,
  vote,
  author_reply: authorReply,
  updated_at: updatedAt,
  flagged_by_author: flaggedByAuthor,
  pluginUserId,
  pluginAuthor,
  user,
}) {
  const meta = Ref();
  const flagRef = Ref();
  const reply = Ref();
  // SQLite timestamps are UTC but do not include a timezone suffix.
  const createTime = moment.utc(updatedAt || null, ['YYYY-MM-DD HH:mm:ss', moment.ISO_8601], true).local();
  const args = [id, pluginAuthor, pluginUserId, user];
  const userIsPluginAuthor = user && pluginUserId === user?.id;
  const reviewerName = name?.trim() || 'Acode user';
  const createDuration = createTime.fromNow();

  if (userIsPluginAuthor) {
    let icon = 'outlined_flag';
    if (flaggedByAuthor) {
      icon = 'flag';
    }

    meta.append(
      <button
        type='button'
        ref={flagRef}
        onclick={() => flagComment(id, flagRef)}
        className={`icon ${icon} danger`}
        title={flaggedByAuthor ? 'Unflag this comment' : 'Flag this comment'}
        aria-label={flaggedByAuthor ? 'Unflag this comment' : 'Flag this comment'}
      />,
      <button
        type='button'
        onclick={() => replyToComment(...args)}
        className='icon chat_bubble primary'
        title='Reply to this comment'
        aria-label='Reply to this comment'
      />,
    );
  } else if (user?.isAdmin && flaggedByAuthor) {
    meta.append(<span className='icon flag danger' title='Flag this comment' />);
  }

  if (authorReply) {
    reply.append(
      <div className='plugin-author'>
        <strong>{pluginAuthor}</strong>
        <span className='developer-label'>Developer</span>
        {userIsPluginAuthor && (
          <button
            type='button'
            title='Delete this reply.'
            aria-label='Delete this reply'
            onclick={() => deleteReply(...args)}
            className='icon delete danger'
          />
        )}
      </div>,
      <p className='comment-author-reply-text'>{authorReply}</p>,
    );
  }

  if (user && (user.id === reviewerId || (user.isAdmin && user.authType === 'web'))) {
    meta.append(
      <button
        type='button'
        onclick={() => deleteComment(id, vote)}
        className='icon delete danger'
        title='Delete this comment'
        aria-label='Delete this comment'
      />,
    );
  }

  return (
    <article id={`comment_${id}`} className='comment' aria-label={`Review by ${reviewerName}`} tabIndex={-1}>
      <img className='reviewer-avatar' src={gravatar(github)} alt='' loading='lazy' width='32' height='32' />
      <div className='comment-header'>
        <span className='reviewer-name'>{reviewerName}</span>
        {(vote === 1 || vote === -1) && (
          <span
            className='review-vote'
            role='img'
            aria-label={vote === 1 ? 'Recommended' : 'Not recommended'}
            title={vote === 1 ? 'Recommended' : 'Not recommended'}
          >
            <span className={`icon ${vote === 1 ? 'thumb_up' : 'thumb_down'}`} aria-hidden='true' />
          </span>
        )}
        {createTime.isValid() && (
          <time dateTime={createTime.toISOString()} title={createTime.format('D MMMM YYYY, HH:mm')}>
            {createDuration}
          </time>
        )}
      </div>
      <p className='comment-text'>{comment}</p>
      <div ref={reply} className='comment-author-reply' />
      <div ref={meta} className='comment-meta' />
    </article>
  );
}

/**
 * Toggles the flagged state of the provided element by updating its class name and title.
 *
 * @param {boolean} flagged - Indicates whether the element should be set as flagged.
 * @param {HTMLElement} flagRef - A reference to the HTML element that needs its class and title updated.
 */
function toggleFlag(flagged, flagRef) {
  flagRef.title = flagged ? 'Unflag this comment' : 'Flag this comment';
  flagRef.setAttribute('aria-label', flagRef.title);
  if (flagged) {
    flagRef.className = 'icon flag danger';
    return;
  }

  flagRef.className = 'icon outlined_flag danger';
}

/**
 * Flag a comment
 * @param {number} id
 * @param {Ref} flagRef
 */
async function flagComment(id, flagRef) {
  try {
    const res = await requestComment(`/api/comment/toggle-flag/${id}`, { method: 'PATCH' });
    toggleFlag(res.flagged, flagRef);
    if (res.flagged) {
      alert('INFO', 'Thank you for flagging this comment. We will review it shortly.');
    }
  } catch (error) {
    alert('ERROR', error.message || error);
  }
}

async function deleteComment(commentId, vote) {
  try {
    const confirmation = await confirm('CONFIRM', 'Are you sure you want to delete your review?');
    if (!confirmation) return false;
    const res = await requestComment(`/api/comment/${commentId}`, {
      method: 'DELETE',
    });

    const comment = tag.get(`#comment_${commentId}`);
    const list = comment?.parentElement;
    const nextReview = comment?.nextElementSibling || comment?.previousElementSibling;
    comment?.dispatchEvent(new CustomEvent('reviewdeleted', { bubbles: true, detail: { vote } }));
    comment?.remove();
    if (list) {
      const count = list.querySelectorAll('.comment').length;
      if (!count) list.replaceChildren(<EmptyReviews />);
      setReviewStatus(list, count ? `Review deleted. ${count} ${count === 1 ? 'review remains' : 'reviews remain'}.` : 'No reviews yet.');
    }
    alert('SUCCESS', res.message, () => {
      queueMicrotask(() => {
        if (list?.isConnected && !document.querySelector('.dialog-box-container:not(.hide)')) {
          (nextReview?.isConnected ? nextReview : list.firstElementChild)?.focus();
        }
      });
    });
    return true;
  } catch (error) {
    alert('ERROR', error.message || error);
    return false;
  }
}

async function replyToComment(commentId, pluginAuthor, pluginUserId, user) {
  try {
    const reply = await prompt('Enter your reply', { type: 'textarea', required: true });
    if (!reply) return;

    await setCommentReply(reply, commentId, pluginAuthor, pluginUserId, user);
  } catch (error) {
    alert('ERROR', error.message || error);
  }
}

async function requestComment(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || 'Unable to update review');
  return result;
}

async function setCommentReply(reply, commentId, pluginAuthor, pluginUserId, user) {
  const formData = new FormData();
  formData.append('reply', reply);
  const res = await requestComment(`/api/comment/${commentId}/reply`, {
    method: 'POST',
    body: formData,
  });

  const $comment = tag.get(`#comment_${commentId}`);
  if ($comment) {
    let comment;
    try {
      comment = await requestComment(`/api/comment/${commentId}`);
    } catch {
      alert('INFO', 'Your changes were saved, but the review couldn’t be refreshed. Reload the page to see it.');
      return;
    }
    const $updatedComment = <Comment {...comment} user={user} pluginAuthor={pluginAuthor} pluginUserId={pluginUserId} />;
    $comment.replaceWith($updatedComment);
  }
  alert('SUCCESS', res.message);
}

async function deleteReply(commentId, pluginAuthor, pluginUserId, user) {
  try {
    const confirmation = await confirm('CONFIRM', 'Are you sure you want to delete your reply?');
    if (!confirmation) return;
    await setCommentReply('', commentId, pluginAuthor, pluginUserId, user);
  } catch (error) {
    alert('ERROR', error.message || error);
  }
}
