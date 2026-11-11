import fs from 'node:fs';
import vm from 'node:vm';
import { Router } from 'express';

const source = fs.readFileSync(new URL('../../server/apis/comment.js', import.meta.url), 'utf8');

it.each([
  [null, 401, 'Unauthorized'],
  ['web', 403, 'Write your review in the Acode app.'],
  ['api_key', 403, 'Write your review in the Acode app.'],
  ['app', 200, 'Comment added'],
])('enforces the review write rule for a %s session', async (authType, status, message) => {
  const review = { id: 3, comment: 'Works well', vote: 1 };
  const plugin = { get: vi.fn().mockResolvedValue([{ name: 'Example' }]) };
  const comment = {
    PLUGIN_ID: 'plugin_id',
    USER_ID: 'user_id',
    COMMENT: 'comment',
    VOTE: 'vote',
    get: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([review]),
    isValidVote: (vote) => vote === 1,
    getVoteString: () => 'up',
    insert: vi.fn(),
  };
  const sendEmail = vi.fn();
  const dependencies = {
    express: { Router },
    '../lib/helpers': { getLoggedInUser: async () => authType && { id: 7, authType } },
    '../lib/pluginReview': {},
    '../entities/plugin': plugin,
    '../entities/comment': comment,
    '../entities/user': {},
    '../lib/sendEmail': sendEmail,
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: (name) => dependencies[name] });
  const response = await new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(body) {
        resolve([this.statusCode, body]);
      },
    };
    module.exports.handle({ method: 'POST', url: '/', body: { plugin_id: 'example', comment: review.comment, vote: review.vote } }, res, reject);
  });
  if (authType === 'app') {
    expect(response).toEqual([status, { message, ...review }]);
    expect(comment.insert).toHaveBeenCalledExactlyOnceWith(['plugin_id', 'example'], ['user_id', 7], ['comment', review.comment], ['vote', 1]);
    expect(sendEmail).toHaveBeenCalledOnce();
  } else {
    expect(response).toEqual([status, { error: message }]);
    expect(plugin.get).not.toHaveBeenCalled();
    expect(comment.insert).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  }
});
