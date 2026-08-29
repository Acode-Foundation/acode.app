const { installVoteCounterTriggers } = require('../lib/pluginReview');

module.exports = {
  version: 14,
  name: 'add_plugin_review_vote_triggers',
  up(db) {
    installVoteCounterTriggers(db);
  },
};
