function canDeleteReview(comment, loggedInUser) {
  if (!comment || !loggedInUser) return false;
  if (comment.user_id === loggedInUser.id) return true;
  return loggedInUser.isAdmin === true && loggedInUser.authType === 'web';
}

function installVoteCounterTriggers(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS plugin_review_vote_insert
    AFTER INSERT ON comment
    WHEN NEW.vote IN (1, -1)
    BEGIN
      UPDATE plugin
      SET votes_up = MAX(0, COALESCE(votes_up, 0) + CASE WHEN NEW.vote = 1 THEN 1 ELSE 0 END),
          votes_down = MAX(0, COALESCE(votes_down, 0) + CASE WHEN NEW.vote = -1 THEN 1 ELSE 0 END)
      WHERE id = NEW.plugin_id;
    END;

    CREATE TRIGGER IF NOT EXISTS plugin_review_vote_update
    AFTER UPDATE OF vote ON comment
    WHEN OLD.vote IS NOT NEW.vote
    BEGIN
      UPDATE plugin
      SET votes_up = MAX(
            0,
            COALESCE(votes_up, 0)
              - CASE WHEN OLD.vote = 1 THEN 1 ELSE 0 END
              + CASE WHEN NEW.vote = 1 THEN 1 ELSE 0 END
          ),
          votes_down = MAX(
            0,
            COALESCE(votes_down, 0)
              - CASE WHEN OLD.vote = -1 THEN 1 ELSE 0 END
              + CASE WHEN NEW.vote = -1 THEN 1 ELSE 0 END
          )
      WHERE id = NEW.plugin_id;
    END;

    CREATE TRIGGER IF NOT EXISTS plugin_review_vote_delete
    AFTER DELETE ON comment
    WHEN OLD.vote IN (1, -1)
    BEGIN
      UPDATE plugin
      SET votes_up = MAX(0, COALESCE(votes_up, 0) - CASE WHEN OLD.vote = 1 THEN 1 ELSE 0 END),
          votes_down = MAX(0, COALESCE(votes_down, 0) - CASE WHEN OLD.vote = -1 THEN 1 ELSE 0 END)
      WHERE id = OLD.plugin_id;
    END;
  `);
}

module.exports = {
  canDeleteReview,
  installVoteCounterTriggers,
};
