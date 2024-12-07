import './style.scss';
import Router from 'lib/Router';
import { marked } from 'marked';
import Ref from 'html-tag-js/ref';
import moment from 'moment/moment';
import Input from 'components/input';
import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import prompt from 'components/dialogs/prompt';
import YearSelect from 'components/YearSelect';
import MonthSelect from 'components/MonthSelect';
import confirm from 'components/dialogs/confirm';
import { calcRating, getLoggedInUser, gravatar } from 'lib/helpers';

export default async function Plugin({ id: pluginId, section = 'description' }) {
  /** @type string */
  const plugin = await fetch(`/api/plugin/${pluginId}`).then((res) => res.json());
  if (plugin.error) {
    return <div className='error'>{plugin.error}</div>;
  }

  const {
    icon,
    name,
    price,
    author,
    version,
    downloads,
    repository,
    description,
    user_id: userId,
    votes_up: votesUp,
    votes_down: votesDown,
    author_email: authorEmail,
    comment_count: commentCount,
    author_verified: authorVerified,
  } = plugin;

  const user = await getLoggedInUser();
  const userComment = await getUserComment(pluginId);
  const sectionDescription = new Ref();
  const sectionComments = new Ref();
  const sectionOrders = new Ref();
  const ordersList = new Ref();
  const mainBody = new Ref();
  const commentListRef = new Ref();
  const selectYear = new Ref();
  const selectMonth = new Ref();
  const $comments = <CommentsContainerAndForm
    listRef={commentListRef}
    plugin={plugin}
    user={user}
    id={pluginId}
    userComment={userComment}
  />;
  const $description = <p className='md' innerHTML={marked.parse(description)}></p>;
  const updateOrder = () => {
    renderOrders(ordersList, pluginId, selectYear.value, selectMonth.value);
  };
  const $orders = <Order />;
  const isSameUser = user && (user.id === userId || user.isAdmin) && plugin.price;

  changeSection(section, false);
  renderComments(commentListRef, userId, user, pluginId, author);

  if (isSameUser) {
    renderOrders(ordersList, pluginId);
  }

  $description.getAll('table')
    .forEach((table) => {
      table.replaceWith(<div className='table-wrapper'>{table.cloneNode(true)}</div>);
    });

  return <section id='plugin'>
    <div className='row plugin-head'>
      <div className='plugin-logo'>
        <img src={icon} alt={name} />
        {
          /android/i.test(navigator.userAgent)
            ? <button onclick={() => window.open(`acode://plugin/install/${pluginId}`)} >Install</button>
            : <></>
        }
      </div>
      <div className='info-container'>
        <div className='info'>
          <strong>{name}</strong>
        </div>
        <div className='info'>
          <span className='chip'>v {version}</span>
          <div className='chip'>
            <span className='icon download'></span>
            <span>{downloads.toLocaleString()}</span>
          </div>
          <div className='chip'>
            {
              price
                ? <><span style={{ marginRight: '10px' }}>&#8377;</span>
                  <span>{price}</span></>
                : <span>Free</span>
            }
          </div>
          {
            commentCount > 0
              ? <div className='chip' onclick={() => changeSection('comments')}>
                <div className='icon chat_bubble'></div>
                <span>{commentCount}</span>
              </div>
              : ''
          }
          <div className='chip' onclick={() => changeSection('comments')}>
            <img src='/thumbs-up.gif' alt='thumbs up' />
            <span>{calcRating(votesUp, votesDown)}</span>
          </div>
        </div>
        <div className='info'>
          <span className='chip'>
            <a href={`/user/${authorEmail}`}>{author}</a>&nbsp;{
              authorVerified
                ? <span className='icon verified'></span>
                : ''
            }
          </span>
          {
            repository
              ? <a className='chip' href={repository}>repository</a>
              : ''
          }
        </div>
      </div>
    </div>
    <div className='detailed'>
      <div className='options'>
        <h2 onclick={() => changeSection('description')} ref={sectionDescription}>Description</h2>
        <h2 onclick={() => changeSection('comments')} ref={sectionComments}>Reviews</h2>
        {
          isSameUser
            ? <h2 onclick={() => changeSection('orders')} ref={sectionOrders}>Orders</h2>
            : ''
        }
      </div>
      <div ref={mainBody} className='body'></div>
    </div>
  </section>;

  /**
   *
   * @param {'comments' | 'description'} sectionName
   */
  function changeSection(sectionName, updateLocation = true) {
    sectionDescription.className = '';
    sectionComments.className = '';
    sectionOrders.className = '';
    mainBody.innerHTML = '';

    if (sectionName === 'comments') {
      sectionComments.className = 'selected';
      mainBody.append($comments);
    } else if (sectionName === 'orders') {
      sectionOrders.className = 'selected';
      mainBody.append($orders);
    } else {
      sectionDescription.className = 'selected';
      mainBody.append($description);
    }

    if (updateLocation) {
      Router.setUrl(`/plugin/${pluginId}/${sectionName}`);
    }
  }

  function Order() {
    return <div>
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
    </div>;
  }
}

async function renderOrders(ref, pluginId, year, month) {
  ref.innerHTML = '';
  if (!month) month = moment().month();
  if (!year) year = moment().year();
  const url = `/api/plugin/orders/${pluginId}/${year}/${month}`;
  const orders = await fetch(url).then((res) => res.json());
  orders.forEach((order) => {
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
  });
}

async function renderComments(ref, pluginUserId, user, id, author) {
  const comments = await fetch(`/api/comments/${id}`).then((res) => res.json());
  comments.forEach((comment) => {
    if (!comment.comment) return;
    comment.user = user;
    comment.pluginUserId = pluginUserId;
    comment.pluginAuthor = author;
    ref.append(<Comment {...comment} />);
  });
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
  const dp = new Ref();
  const meta = new Ref();
  const flagRef = new Ref();
  const reply = new Ref();
  const now = moment().add(new Date().getTimezoneOffset(), 'minutes');
  const createTime = moment(updatedAt);
  const args = [id, pluginAuthor, pluginUserId, user];
  const userIsPluginAuthor = user && pluginUserId === user?.id;

  const createDuration = moment.duration(now.diff(createTime)).humanize();

  if (vote === 1) {
    dp.append(<div className='icon thumb_up primary'></div>);
  } else if (vote === -1) {
    dp.append(<div className='icon thumb_down danger'></div>);
  }

  meta.append(<time datetime={createTime}>{createDuration} ago</time>);

  if (userIsPluginAuthor) {
    let icon = 'outlined_flag';
    if (flaggedByAuthor) {
      icon = 'flag';
    }

    meta.append(
      <button ref={flagRef} onclick={() => flagComment(id, flagRef)} className={`icon ${icon} danger`} title='Flag this comment'></button>,
      <button onclick={() => replyToComment(...args)} type='button' className='icon chat_bubble primary' title='Reply to this comment'></button>,
    );
  } else if (user?.isAdmin && flaggedByAuthor) {
    meta.append(
      <span className='icon flag danger' title='Flag this comment'></span>,
    );
  }

  if (authorReply) {
    reply.append(
      <div className='plugin-author'>
        {pluginAuthor}
        {
          userIsPluginAuthor
            ? <button title='Delete this reply.' onclick={() => deleteReply(...args)} className='icon delete danger'></button>
            : ''
        }
      </div>,
      <span className='comment-author-reply-text'>{authorReply}</span>,
    );
  }

  if (user && user.isAdmin) {
    meta.append(
      <button onclick={() => deleteComment(id)} className='icon delete danger' title='Delete this comment'></button>,
    );
  }

  return <div id={`comment_${id}`} className='comment'>
    <div className='row'>
      <div ref={dp} className='dp' title={name}>
        <img src={gravatar(github)} alt={name} />
      </div>
      <div className='comment-body'>
        <div className='comment-text'>{comment}</div>
        <div ref={reply} className='comment-author-reply'></div>
        <div ref={meta} className='comment-meta'></div>
      </div>
    </div>
  </div>;
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
function CommentsContainerAndForm({
  plugin, listRef, user, id, userComment,
}) {
  if (!user) {
    return <div className='comments'>
      <span><a href={`/login?redirect=/plugin/${id}/comments`}>Sign in</a> to write your review.</span>
      <div ref={listRef} className='list'></div>
    </div>;
  }

  const { comment, vote, id: commentId } = userComment;
  const form = new Ref();

  return <div className='comments'>
    <AjaxForm
      ref={form}
      onerror={onerror}
      onloadend={onloadend}
      action='/api/comment'
      method='POST'
    >
      <div className='row' style={{ justifyContent: 'space-around' }}>
        <IconInput checked={vote === 1} title='Vote up' name='vote' iconSelected='thumb_up primary' icon='thumb_up_alt primary' value='1' />
        <IconInput checked={vote === -1} title='Vote down' name='vote' iconSelected='thumb_down danger' icon='thumb_down_alt danger' value='-1' />
      </div>
      <Input type='hidden' name='plugin_id' value={id} />
      <Input maxlength={250} type='textarea' name='comment' placeholder='Comment' value={comment} />
      <div className='buttons-container'>
        <button type='submit'>Submit</button>
        {
          commentId
            ? <button onclick={deleteUserComment} type='button' className='danger' title='Delete your review'><span className='icon delete'></span></button>
            : ''
        }
      </div>
    </AjaxForm>

    <div ref={listRef} className='list'></div>
  </div>;

  async function onloadend(res) {
    if (res.error) {
      onerror(res.error);
      return;
    }

    let $comment;

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
      form.el.getAll('input[name=vote]').forEach((i) => {
        i.checked = false;
        i.onchange();
      });
    } catch (error) {
      alert('ERROR', error);
    }
  }

  async function onerror(err) {
    alert('ERROR', err);
  }
}

function IconInput({
  name, icon, iconSelected, value, title, checked,
}) {
  const input = new Ref();
  const iconHolder = new Ref();
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
    tag.getAll(`input[name=${name}]`).forEach((i) => {
      if (i === input.el) return;
      i.checked = false;
      i.onchange();
    });

    const isChecked = !input.el.checked;
    input.el.checked = isChecked;
    updateIcon(isChecked);
  };

  input.onref = (el) => {
    el.onchange = () => {
      updateIcon(el.checked);
    };
  };

  return <label onclick={onclick} title={title} className='icon-input'>
    <input checked={checked} hidden ref={input} title={title} type='radio' name={name} value={value} />
    <span ref={iconHolder} className={className}></span>
  </label>;
}

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

async function getUserComment(id) {
  const res = await fetch(`/api/user/comment/${id}`).then((commentRes) => commentRes.json());
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
