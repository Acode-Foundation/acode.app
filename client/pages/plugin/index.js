import './style.scss';
import 'highlight.js/styles/github-dark.css';
import AdSense from 'components/adsense';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import prompt from 'components/dialogs/prompt';
import Input from 'components/input';
import MonthSelect from 'components/MonthSelect';
import PluginStatus from 'components/pluginStatus';
import YearSelect from 'components/YearSelect';
import hilightjs from 'highlight.js';
import Ref from 'html-tag-js/ref';
import { calcRating, getLoggedInUser, gravatar, since } from 'lib/helpers';
import Router from 'lib/Router';
import { marked } from 'marked';
import moment from 'moment/moment';

export default async function Plugin({ id: pluginId, section = 'description' }) {
  const plugin = await fetch(`/api/plugin/${pluginId}`).then((res) => res.json());
  if (plugin.error) {
    return <div className='error'>{plugin.error}</div>;
  }

  const {
    id,
    name,
    price,
    status,
    author,
    version,
    license,
    downloads,
    repository,
    description,
    user_id: userId,
    votes_up: votesUp,
    votes_down: votesDown,
    comment_count: commentCount,
    package_updated_at: updatedAt,
    author_verified: authorVerified,
  } = plugin;

  const user = await getLoggedInUser();
  const userComment = await getUserComment(pluginId);
  const sectionDescription = Ref();
  const sectionChangelogs = Ref();
  const sectionComments = Ref();
  const sectionOrders = Ref();
  const ordersList = Ref();
  const mainBody = Ref();
  const commentListRef = Ref();
  const selectYear = Ref();
  const selectMonth = Ref();
  const $comments = <CommentsContainerAndForm listRef={commentListRef} plugin={plugin} user={user} id={pluginId} userComment={userComment} />;
  const $description = (
    <article style={{ width: '100%', overflow: 'auto' }}>
      <AdSense name='readme' style={{ position: 'relative' }} />
      <p className='md' innerHTML={marked.parse(description)} />
    </article>
  );
  const updateOrder = () => {
    renderOrders(ordersList, pluginId, selectYear.value, selectMonth.value);
  };
  const $orders = <Order />;
  const shouldShowOrders = user && (user.id === userId || user.isAdmin) && !!plugin.price;

  let canInstall = /android/i.test(navigator.userAgent);

  if (user?.isAdmin && plugin.status !== 'approved') {
    canInstall = false;
  }

  /** @type {Ref} */
  let currentSection;

  for (const code of $description.getAll('pre code')) {
    hilightjs.highlightElement(code);
  }

  changeSection(section, false);
  renderComments(commentListRef, userId, user, pluginId, author);

  if (shouldShowOrders) {
    renderOrders(ordersList, pluginId);
  }

  for (const table of $description.getAll('table')) {
    table.replaceWith(<div className='table-wrapper'>{table.cloneNode(true)}</div>);
  }

  return (
    <section id='plugin'>
      <div className='row plugin-head'>
        <div className='plugin-logo'>
          <img src={`/plugin-icon/${id}`} alt={name} />
          {canInstall && (
            <button type='button' onclick={() => window.open(`acode://plugin/install/${pluginId}`)}>
              <span className='icon download' /> Install
            </button>
          )}
          <PluginStatus status={status} id={id} style='button' />
        </div>
        <div className='info-container'>
          <div className='info'>
            <strong>{name}</strong>
            {updatedAt && <small>Updated {since(updatedAt)}</small>}
          </div>
          <div className='info'>
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
            <div className='chip'>
              {price ? (
                <>
                  <span style={{ marginRight: '10px' }}>&#8377;</span>
                  <span>{price}</span>
                </>
              ) : (
                <span style={{ color: 'lightgreen' }}>Free</span>
              )}
            </div>
            {commentCount > 0 && (
              <div className='chip' onclick={() => changeSection('comments')}>
                <div className='icon chat_bubble' />
                <span>{commentCount}</span>
              </div>
            )}
            {license && license.toLowerCase() !== 'unknown' && (
              <div className='chip'>
                <span className='icon certificate' />
                <span>{license}</span>
              </div>
            )}
            {votesUp + votesDown > 0 && (
              <div className='chip' onclick={() => changeSection('comments')}>
                <img src='/thumbs-up.gif' alt='thumbs up' />
                <span>{calcRating(votesUp, votesDown)}</span>
              </div>
            )}
            {user?.isAdmin && (
              <button type='button' className='chip' onclick={() => window.open(`/api/plugin/download/${id}`)}>
                <span className='icon download' />
                <span>Download</span>
              </button>
            )}
          </div>
          <div className='info'>
            <span className='chip'>
              <a href={`/user/${userId}`}>{author}</a>&nbsp;{!!authorVerified && <span className='icon verified' />}
            </span>
            {repository && (
              <a className='chip' href={repository}>
                repository
              </a>
            )}
          </div>
        </div>
      </div>
      <div className='detailed'>
        <div
          className='options'
          onwheel={(e) => {
            const target = e.target.closest('.options');
            target.scrollLeft += e.deltaY;
            e.preventDefault();
          }}
        >
          <h2 onclick={() => changeSection('description')} ref={sectionDescription}>
            Description
          </h2>
          <h2 onclick={() => changeSection('changelogs')} ref={sectionChangelogs}>
            Changelogs
          </h2>
          <h2 onclick={() => changeSection('comments')} ref={sectionComments}>
            Reviews
          </h2>
          {shouldShowOrders && (
            <h2 onclick={() => changeSection('orders')} ref={sectionOrders}>
              Orders
            </h2>
          )}
        </div>
        <div ref={mainBody} className='body' />
      </div>
    </section>
  );

  /**
   *
   * @param {'comments' | 'description' | 'changelogs' | 'orders'} sectionName
   */
  function changeSection(sectionName, updateLocation = true) {
    if (currentSection) currentSection.className = '';
    mainBody.innerHTML = '';

    switch (sectionName) {
      case 'comments':
        currentSection = sectionComments;
        mainBody.append($comments);
        break;
      case 'orders':
        currentSection = sectionOrders;
        mainBody.append($orders);
        break;
      case 'changelogs': {
        currentSection = sectionChangelogs;
        const changelogs = plugin.changelogs ? marked.parse(plugin.changelogs) : '';
        mainBody.append(
          <p className='md' innerHTML={changelogs}>
            {!changelogs && <span style={{ opacity: 0.8, fontSize: 'italic' }}>No changelogs</span>}
          </p>,
        );
        break;
      }
      default:
        currentSection = sectionDescription;
        mainBody.append($description);
    }

    currentSection.className = 'selected';

    if (updateLocation) {
      Router.setUrl(`/plugin/${pluginId}/${sectionName}`);
    }
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
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody ref={ordersList}>
              <tr>
                <td colspan='3'>Loading...</td>
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

  for (const order of orders) {
    const date = moment(order.created_at).format('DD MMMM YYYY');
    const status = order.state === '0' ? 'Completed' : 'Cancelled';
    const packageName = /free$/.test(order.package) ? 'Free' : 'Paid';
    ref.append(
      <tr className='order'>
        <td className='date'>{date}</td>
        <td className='date'>{packageName}</td>
        <td className='amount'>&#8377; {order.amount.toFixed(2)}</td>
        <td className={`order-status ${status}`}>{status}</td>
      </tr>,
    );
  }
}

async function renderComments(ref, pluginUserId, user, id, author) {
  const comments = await fetch(`/api/comments/${id}`).then((res) => res.json());

  for (const comment of comments) {
    if (!comment.comment) confirm;
    comment.user = user;
    comment.pluginUserId = pluginUserId;
    comment.pluginAuthor = author;
    ref.append(<Comment {...comment} />);
  }
}

function Comment({
  id,
  comment,
  name,
  github,
  vote,
  author_reply: authorReply,
  updated_at: updatedAt,
  flagged_by_author: flaggedByAuthor,
  pluginUserId,
  pluginAuthor,
  user,
}) {
  const dp = Ref();
  const meta = Ref();
  const flagRef = Ref();
  const reply = Ref();
  const createTime = moment(updatedAt);
  const args = [id, pluginAuthor, pluginUserId, user];
  const userIsPluginAuthor = user && pluginUserId === user?.id;

  const createDuration = since(createTime);

  if (vote === 1) {
    dp.append(<div className='icon thumb_up primary' />);
  } else if (vote === -1) {
    dp.append(<div className='icon thumb_down danger' />);
  }

  meta.append(<time datetime={createTime}>{createDuration} ago</time>);

  if (userIsPluginAuthor) {
    let icon = 'outlined_flag';
    if (flaggedByAuthor) {
      icon = 'flag';
    }

    meta.append(
      <button type='button' ref={flagRef} onclick={() => flagComment(id, flagRef)} className={`icon ${icon} danger`} title='Flag this comment' />,
      <button type='button' onclick={() => replyToComment(...args)} className='icon chat_bubble primary' title='Reply to this comment' />,
    );
  } else if (user?.isAdmin && flaggedByAuthor) {
    meta.append(<span className='icon flag danger' title='Flag this comment' />);
  }

  if (authorReply) {
    reply.append(
      <div className='plugin-author'>
        {pluginAuthor}
        {userIsPluginAuthor && (
          <button type='button' title='Delete this reply.' onclick={() => deleteReply(...args)} className='icon delete danger' />
        )}
      </div>,
      <span className='comment-author-reply-text'>{authorReply}</span>,
    );
  }

  if (user?.isAdmin) {
    meta.append(<button type='button' onclick={() => deleteComment(id)} className='icon delete danger' title='Delete this comment' />);
  }

  return (
    <div id={`comment_${id}`} className='comment'>
      <div className='row'>
        <div ref={dp} className='dp' title={name}>
          <img src={gravatar(github)} alt={name} />
        </div>
        <div className='comment-body'>
          <div className='comment-text'>{comment}</div>
          <div ref={reply} className='comment-author-reply' />
          <div ref={meta} className='comment-meta' />
        </div>
      </div>
    </div>
  );
}

/**
 *
 * @param {object} param0
 * @param {string} [param0.id]
 * @param {object} [param0.userComment]
 * @param {Ref} param0.listRef
 * @param {object} param0.plugin
 * @param {object} param0.user
 * @returns
 */
function CommentsContainerAndForm({ plugin, listRef, user, id, userComment }) {
  if (!user) {
    return (
      <div className='comments'>
        <span>
          <a href={`/login?redirect=/plugin/${id}/comments`}>Sign in</a> to write your review.
        </span>
        <div ref={listRef} className='list' />
      </div>
    );
  }

  const { comment, vote } = userComment;
  const form = Ref();
  let commentId = userComment.id;

  return (
    <div className='comments'>
      <AjaxForm ref={form} onerror={onerror} onloadend={onloadend} action='/api/comment' method='POST'>
        <div className='row' style={{ justifyContent: 'space-around' }}>
          <IconInput checked={vote === 1} title='Vote up' name='vote' iconSelected='thumb_up primary' icon='thumb_up_alt primary' value='1' />
          <IconInput checked={vote === -1} title='Vote down' name='vote' iconSelected='thumb_down danger' icon='thumb_down_alt danger' value='-1' />
        </div>
        <Input type='hidden' name='plugin_id' value={id} />
        <Input maxlength={250} type='textarea' name='comment' placeholder='Comment' value={comment} />
        <div className='buttons-container'>
          <button type='submit'>Submit</button>
          {commentId ? (
            <button onclick={deleteUserComment} type='button' className='danger' title='Delete your review'>
              <span className='icon delete' />
            </button>
          ) : (
            ''
          )}
        </div>
      </AjaxForm>

      <div ref={listRef} className='list' />
    </div>
  );

  async function onloadend(res) {
    if (res.error) {
      onerror(res.error);
      return;
    }

    let $comment;

    commentId = commentId || res.id;
    if (commentId) {
      userComment = await fetch(`/api/comment/${commentId}`).then((userRes) => userRes.json());
      $comment = tag.get(`#comment_${commentId}`);
    } else {
      userComment = await getUserComment(id);
    }

    if (!userComment?.comment) {
      alert('INFO', 'Comment updated successfully');
      $comment?.remove();
      return;
    }

    userComment.user = user;
    userComment.pluginAuthor = plugin.author;
    userComment.pluginUserId = plugin.user_id;
    const $updatedComment = <Comment {...userComment} />;

    if ($comment) {
      listRef.el.replaceChild($updatedComment, $comment);
      return;
    }

    const { firstChild } = listRef.el;
    if (firstChild) {
      listRef.el.insertBefore($updatedComment, firstChild);
      return;
    }

    listRef.el.append($updatedComment);
  }

  async function deleteUserComment() {
    try {
      const deleted = await deleteComment(commentId);
      if (!deleted) return;
      form.el.reset();
      for (const input of form.getAll('input[name=vote]')) {
        input.checked = false;
        input.onchange();
      }
    } catch (error) {
      alert('ERROR', error);
    }
  }

  async function onerror(err) {
    alert('ERROR', err);
  }
}

/**
 * Renders an icon input element with customizable icon states and selection behavior.
 *
 * @param {Object} props - The properties for this component.
 * @param {string} props.name - The name attribute of the input, used for grouping.
 * @param {string} props.icon - The default icon class to display.
 * @param {string} props.iconSelected - The icon class to display when selected.
 * @param {string} props.value - The value attribute of the input.
 * @param {string} props.title - The title attribute used for the label and input.
 * @param {boolean} props.checked - Whether the input is initially checked.
 * @returns {HTMLElement} The rendered icon-based radio input component.
 */
function IconInput({ name, icon, iconSelected, value, title, checked }) {
  const input = Ref();
  const iconHolder = Ref();
  const className = checked ? `icon ${iconSelected}` : `icon ${icon}`;

  const updateIcon = (val) => {
    let iconNewClassName = `icon ${icon}`;
    if (val) {
      iconNewClassName = `icon ${iconSelected}`;
    }

    iconHolder.className = iconNewClassName;
  };

  const onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    for (const input of tag.getAll(`input[name=${name}]`)) {
      if (input === input.el) return;
      input.checked = false;
      input.onchange();
    }

    const isChecked = !input.el.checked;
    input.el.checked = isChecked;
    updateIcon(isChecked);
  };

  input.onref = (el) => {
    el.onchange = () => {
      updateIcon(el.checked);
    };
  };

  return (
    <label onclick={onclick} title={title} className='icon-input'>
      <input checked={checked} hidden ref={input} title={title} type='radio' name={name} value={value} />
      <span ref={iconHolder} className={className} />
    </label>
  );
}

/**
 * Toggles the flagged state of the provided element by updating its class name and title.
 *
 * @param {boolean} flagged - Indicates whether the element should be set as flagged.
 * @param {HTMLElement} flagRef - A reference to the HTML element that needs its class and title updated.
 */
function toggleFlag(flagged, flagRef) {
  if (flagged) {
    flagRef.className = 'icon flag danger';
    flagRef.title = 'Flagged';
    return;
  }

  flagRef.className = 'icon outlined_flag danger';
  flagRef.title = 'Flag';
}

/**
 * Flag a comment
 * @param {number} id
 * @param {Ref} flagRef
 */
async function flagComment(id, flagRef) {
  const res = await fetch(`/api/comment/toggle-flag/${id}`, {
    method: 'PATCH',
  }).then((flagRes) => flagRes.json());

  if (res.error) {
    alert('ERROR', res.error);
    return;
  }

  toggleFlag(res.flagged, flagRef);
  if (res.flagged) {
    alert('INFO', 'Thank you for flagging this comment. We will review it shortly.');
  }
}

/**
 * Gets the current user's comment for a specific plugin.
 * @param {string} pluginId Plugin ID
 * @returns {Promise<Object>} The user's comment for the specified plugin.
 */
async function getUserComment(pluginId) {
  const res = await fetch(`/api/user/comment/${pluginId}`).then((commentRes) => commentRes.json());
  return res;
}

async function deleteComment(commentId) {
  try {
    const confirmation = await confirm('CONFIRM', 'Are you sure you want to delete your review?');
    if (!confirmation) return false;
    const res = await fetch(`/api/comment/${commentId}`, {
      method: 'DELETE',
    }).then((commentRes) => commentRes.json());

    if (res.error) {
      throw res.error;
    }

    alert('SUCCESS', res.message);
    tag.get(`#comment_${commentId}`)?.remove();
    return true;
  } catch (error) {
    alert('ERROR', error);
    return false;
  }
}

async function replyToComment(commentId, pluginAuthor, pluginUserId, user) {
  try {
    const reply = await prompt('Enter your reply', { type: 'textarea', required: true });
    if (!reply) return;

    await setCommentReply(reply, commentId, pluginAuthor, pluginUserId, user);
  } catch (error) {
    alert('ERROR', error);
  }
}

async function setCommentReply(reply, commentId, pluginAuthor, pluginUserId, user) {
  const formData = new FormData();
  formData.append('reply', reply);
  const res = await fetch(`/api/comment/${commentId}/reply`, {
    method: 'POST',
    body: formData,
  }).then((replyRes) => replyRes.json());

  if (res.error) {
    throw res.error;
  }

  alert('SUCCESS', res.message);

  const $comment = tag.get(`#comment_${commentId}`);
  const comment = await fetch(`/api/comment/${commentId}`).then((commentRes) => commentRes.json());
  comment.user = user;
  comment.pluginAuthor = pluginAuthor;
  comment.pluginUserId = pluginUserId;
  const $updatedComment = <Comment {...comment} />;
  $comment.parentElement.replaceChild($updatedComment, $comment);
}

async function deleteReply(commentId, pluginAuthor, user) {
  try {
    const confirmation = await confirm('CONFIRM', 'Are you sure you want to delete your reply?');
    if (!confirmation) return;
    await setCommentReply('', commentId, pluginAuthor, user);
  } catch (error) {
    alert('ERROR', error);
  }
}
