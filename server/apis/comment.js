const { Router } = require('express');
const { getLoggedInUser } = require('../lib/helpers');
const Comment = require('../entities/comment');
const Plugin = require('../entities/plugin');
const user = require('../entities/user');
const sendEmail = require('../lib/sendEmail');

const router = Router();

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, page, limit } = req.query;

    if (type === 'comment') {
      const [comment] = await Comment.get([Comment.ID, id]);
      if (!comment) {
        res.status(404).send({ error: 'Comment not found' });
        return;
      }

      res.send(comment);
      return;
    }

    const loggedInUser = await getLoggedInUser(req);
    const [plugin] = await Plugin.get([Plugin.USER_ID], [Plugin.ID, id]);

    if (!plugin) {
      const [comment] = await Comment.get([Comment.ID, id]);
      if (!comment) {
        res.status(404).send({ error: 'Comment/Plugin not found' });
        return;
      }

      res.send(comment);
      return;
    }

    let { columns } = Comment;
    if (loggedInUser?.isAdmin || loggedInUser?.id === plugin.user_id) {
      columns = Comment.allColumns;
    }

    const rows = await Comment.get(columns, [Comment.PLUGIN_ID, id], { page, limit, orderBy: `${Comment.UPDATED_AT} DESC` });

    res.send(rows);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);
    // message to be sent as notification to plugin author
    let voteMessage = '';
    let commentMessage = '';
    const getNotificationMessage = () => `<table>
      <tr>
        ${voteMessage ? `<td>${voteMessage}</td>` : ''}
        ${commentMessage ? `<td>${commentMessage}</td>` : ''}
      </tr>
    </table>`;

    if (!loggedInUser) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { plugin_id: pluginId, comment = '', vote: voteStr = 0 } = req.body;

    if (!pluginId) {
      res.status(400).send({ error: 'Plugin ID is required' });
      return;
    }

    const [plugin] = await Plugin.get([Plugin.AUTHOR, Plugin.AUTHOR_EMAIL, Plugin.NAME], [Plugin.ID, pluginId]);

    if (!plugin) {
      res.status(404).send({ error: 'Plugin not found' });
      return;
    }

    const vote = Number.parseInt(voteStr, 10);
    if (typeof vote !== 'number' || !Comment.isValidVote(vote)) {
      res.status(400).send({ error: 'Invalid vote' });
      return;
    }

    if (vote === Comment.VOTE_DOWN && !comment) {
      res.status(400).send({ error: 'Comment is required for downvote' });
      return;
    }
    if (vote === Comment.VOTE_NULL && !comment) {
      res.status(400).send({ error: 'Comment is required' });
      return;
    }

    if (comment && comment.length > 250) {
      res.status(400).send({ error: 'Comment is too long' });
      return;
    }

    const [alreadyVoted] = await Comment.get(
      [Comment.ID, Comment.VOTE, Comment.COMMENT],
      [
        [Comment.PLUGIN_ID, pluginId],
        [Comment.USER_ID, loggedInUser.id],
      ],
    );

    if (alreadyVoted) {
      const updates = [];
      let isVoteChanged = false;
      if (alreadyVoted.vote !== vote) {
        voteMessage = `${loggedInUser.name} changed vote from ${Comment.getVoteString(alreadyVoted.vote)} to ${Comment.getVoteString(vote)}`;
        updates.push([Comment.VOTE, vote]);
        isVoteChanged = true;
      }

      if (alreadyVoted.comment !== comment) {
        commentMessage = `${loggedInUser.name} updated comment to: ${comment}`;
        updates.push([Comment.COMMENT, comment]);
      }

      if (updates.length) {
        await Comment.update(updates, [Comment.ID, alreadyVoted.id]);
        res.send({ message: 'Comment updated' });
        if (isVoteChanged) {
          updateVoteInPlugin(vote, pluginId);
        }

        sendEmail(plugin.author_email, plugin.author, `Review update for your Acode plugin - ${plugin.name}.`, getNotificationMessage());

        return;
      }

      res.send({ message: 'Comment unchanged' });
      return;
    }

    const [row] = await Comment.insert(
      [Comment.PLUGIN_ID, pluginId],
      [Comment.USER_ID, loggedInUser.id],
      [Comment.COMMENT, comment],
      [Comment.VOTE, vote],
    );

    if (vote !== Comment.VOTE_NULL) {
      updateVoteInPlugin(vote, pluginId);
    }
    res.send({ message: 'Comment added', comment: row });
    voteMessage = vote !== Comment.VOTE_NULL ? `${loggedInUser.name} voted ${Comment.getVoteString(vote)}` : '';
    commentMessage = comment ? `${loggedInUser.name} commented: ${comment}` : '';
    sendEmail(plugin.author_email, plugin.author, `New review for your Acode plugin - ${plugin.name}.`, getNotificationMessage());
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.patch('/toggle-flag/:id', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);
    if (!loggedInUser) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { id: commentId } = req.params;
    if (!commentId) {
      res.status(400).send({ error: 'Comment ID is required' });
      return;
    }

    const [comment] = await Comment.get([Comment.ID, commentId]);

    if (!comment) {
      res.status(404).send({ error: 'Comment not found' });
      return;
    }

    const [plugin] = await Plugin.get([Plugin.USER_ID], [Plugin.ID, comment.plugin_id]);
    if (!plugin) {
      res.status(404).send({ error: 'Plugin not found' });
      return;
    }

    if (plugin.user_id !== loggedInUser.id) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    let flag = Comment.FLAGGED;

    if (comment.flagged_by_author) {
      flag = Comment.NOT_FLAGGED;
    }

    await Comment.update([Comment.FLAGGED_BY_AUTHOR, flag], [Comment.ID, commentId]);
    res.send({ message: 'Comment flagged', flagged: flag === Comment.FLAGGED });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.post('/:commentId/reply', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { reply } = req.body;
    const loggedInUser = await getLoggedInUser(req);

    if (!loggedInUser) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const [comment] = await Comment.get(Comment.allColumns, [Comment.ID, commentId]);

    if (!comment) {
      res.status(404).send({ error: 'Comment not found' });
      return;
    }

    const [plugin] = await Plugin.get([Plugin.USER_ID, Plugin.NAME], [Plugin.ID, comment.plugin_id]);

    if (!plugin) {
      res.status(404).send({ error: 'Plugin not found' });
      return;
    }

    if (plugin.user_id !== loggedInUser.id) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    await Comment.update([Comment.AUTHOR_REPLY, reply], [Comment.ID, commentId]);

    res.send({ message: 'Reply added successfully' });

    try {
      const [commenter] = await user.get([user.NAME, user.EMAIL], [user.ID, comment.user_id]);
      sendEmail(commenter.email, commenter.name, `Reply to your comment on Acode plugin - ${plugin.name}.`, `<p>${reply}</p>`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const loggedInUser = await getLoggedInUser(req);

    if (!loggedInUser) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const [comment] = await Comment.get([Comment.ID, id]);

    if (!comment) {
      res.status(404).send({ error: 'Comment not found' });
      return;
    }

    const authorized = comment.user_id === loggedInUser.id || loggedInUser.isAdmin;
    if (!authorized) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    await Comment.delete([Comment.ID, id]);
    res.send({ message: 'Comment deleted' });

    try {
      if (comment.vote === Comment.VOTE_UP) {
        await Plugin.decrement(Plugin.VOTES_UP, 1, [Plugin.ID, comment.plugin_id]);
      } else if (comment.vote === Comment.VOTE_DOWN) {
        await Plugin.decrement(Plugin.VOTES_DOWN, 1, [Plugin.ID, comment.plugin_id]);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

async function updateVoteInPlugin(vote, pluginId) {
  if (vote === Comment.VOTE_UP) {
    // add 1 to plugin's votes_up
    await Plugin.increment(Plugin.VOTES_UP, 1, [Plugin.ID, pluginId]);
  } else if (vote === Comment.VOTE_DOWN) {
    // add 1 to plugin's vote_down
    await Plugin.increment(Plugin.VOTES_DOWN, 1, [Plugin.ID, pluginId]);
  }
}

module.exports = router;
