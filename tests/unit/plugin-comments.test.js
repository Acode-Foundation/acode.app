// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import tag from 'html-tag-js';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import moment from 'moment';

function loadClient(file, dependencies, extraExports = '') {
  const { code } = transformSync(`${fs.readFileSync(path.resolve(import.meta.dirname, '../..', file), 'utf8')}\n${extraExports}`, {
    configFile: false,
    babelrc: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
    plugins: ['html-tag-js/jsx/jsx-to-tag.js', 'html-tag-js/jsx/syntax-parser.js'],
  });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    tag,
    document,
    window,
    navigator,
    FormData,
    CustomEvent,
    process: { env: {} },
    Promise,
    setTimeout,
    queueMicrotask,
    getComputedStyle,
    fetch,
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}
const fetch = vi.fn();
const { default: Tabs } = loadClient('client/components/tabs/index.js', {
  './style.scss': {},
  'html-tag-js/ref': Ref,
  'html-tag-js/reactive': Reactive,
});
const dependencies = {
  './style.scss': {},
  'html-tag-js/ref': Ref,
  'moment/moment': moment,
  'lib/helpers': {
    gravatar: () => '/user.png',
    getLoggedInUser: async () => ({ id: 7 }),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    calcRating: (up, down) => `${up}/${up + down}`,
  },
  'lib/pageMetadata': { applyPluginMetadata: vi.fn() },
  'lib/Router': { setUrl: vi.fn() },
  '../../../shared/repositoryUrl': { safeRepositoryUrl: () => null },
  'lib/relativeTime': { since: () => '2 days ago' },
  'components/dialogs/confirm': async () => true,
  'components/dialogs/alert': vi.fn(),
  'components/dialogs/prompt': {},
  // html-tag-js checks instanceof Promise, so bridge the VM's async return into this realm.
  'components/tabs': (...args) => Promise.resolve(Tabs(...args)),
};
for (const name of [
  'adsense',
  'currencySelector',
  'editorType',
  'MonthSelect',
  'markdown',
  'pluginSecurity',
  'pluginStatus',
  'razorpayCheckout',
  'YearSelect',
]) {
  dependencies[`components/${name}`] = () => tag('div');
}
const {
  default: Plugin,
  Comment,
  renderComments,
  deleteComment,
  setCommentReply,
} = loadClient('client/pages/plugin/index.js', dependencies, 'export { Comment, renderComments, deleteComment, setCommentReply };');
const review = {
  id: 42,
  user_id: 7,
  name: 'Sam Developer',
  comment: 'Useful plugin.\nWorks well.',
  vote: 1,
  updated_at: '2026-11-14T12:00:00Z',
  pluginUserId: 9,
  pluginAuthor: 'Plugin maker',
};

afterEach(() => {
  document.body.replaceChildren();
  fetch.mockReset();
  dependencies['components/dialogs/alert'].mockClear();
  vi.restoreAllMocks();
});

it.each(['2026-11-14 12:00:00', '2026-11-14T12:00:00Z'])('renders UTC timestamp %s in the viewer’s timezone', (updatedAt) => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-11-14T14:00:00Z'));
  const time = Comment({ ...review, updated_at: updatedAt }).querySelector('time');
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date('2026-11-14T12:00:00Z'));
  const part = (type) => parts.find((entry) => entry.type === type).value;
  const localTime = `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')}`;
  expect(time.dateTime).toBe('2026-11-14T12:00:00.000Z');
  expect(time.title).toBe(localTime);
  expect(time.textContent.trim()).toBe('2 hours ago');
});

it('renders visible reviewer identity, accessible vote text, and untrusted content as text', () => {
  const card = Comment({ ...review, name: '<b>Sam</b>', author_reply: '<script>reply</script>' });
  expect(card.querySelector('.reviewer-name').textContent).toBe('<b>Sam</b>');
  expect(card.querySelector('.reviewer-name b')).toBeNull();
  expect(card.querySelector('.review-vote').getAttribute('aria-label')).toBe('Recommended');
  expect(card.querySelector('time').getAttribute('datetime')).toBe('2026-11-14T12:00:00.000Z');
  expect(card.querySelector('.developer-label').textContent).toBe('Developer');
  expect(card.querySelector('.comment-author-reply-text').textContent).toBe('<script>reply</script>');
  expect(card.querySelector('script')).toBeNull();
  expect(card.querySelector('button')).toBeNull();
});

it('handles missing names and distinguishes negative and neutral reviews', () => {
  const negative = Comment({ ...review, name: '  ', vote: -1 });
  expect(negative.querySelector('.reviewer-name').textContent).toBe('Acode user');
  expect(negative.querySelector('.review-vote').getAttribute('aria-label')).toBe('Not recommended');
  expect(Comment({ ...review, vote: 0 }).querySelector('.review-vote')).toBeNull();
});

it.each([null, undefined, 'not-a-date'])('keeps review content without inventing a date for %s', async (updatedAt) => {
  const list = document.createElement('div');
  fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => [
      { ...review, updated_at: updatedAt },
      { ...review, id: 43 },
    ],
  });
  await renderComments(list, 9, null, 'test.plugin', 'Plugin maker');
  expect(list.querySelectorAll('.comment')).toHaveLength(2);
  expect(list.querySelector('#comment_42 time')).toBeNull();
  expect(list.querySelector('#comment_42 .comment-text').textContent).toBe(review.comment);
  expect(list.querySelector('#comment_43 time')).not.toBeNull();
});

it('keeps moderation actions scoped to the reviewer, developer, and web admin', () => {
  const buttons = (user) => [...Comment({ ...review, user }).querySelectorAll('button')].map((button) => button.title);
  expect(buttons({ id: 7 })).toEqual(['Delete this comment']);
  expect(buttons({ id: 9 })).toEqual(['Flag this comment', 'Reply to this comment']);
  expect(buttons({ id: 10 })).toEqual([]);
  expect(buttons({ id: 10, isAdmin: true, authType: 'web' })).toEqual(['Delete this comment']);
  expect(buttons({ id: 10, isAdmin: true, authType: 'app' })).toEqual([]);
});

it('preserves developer controls after deleting a reply and rerendering', async () => {
  document.body.append(Comment({ ...review, user: { id: 9 }, author_reply: 'Thank you' }));
  fetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Reply deleted' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...review, author_reply: '' }) });
  document.querySelector('[title="Delete this reply."]').click();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(document.querySelector('.comment-author-reply').textContent).toBe('');
  expect(document.querySelector('[title="Reply to this comment"]')).not.toBeNull();
});

it('shows loading until reviews resolve and ignores vote-only entries', async () => {
  const list = document.createElement('div');
  let resolve;
  fetch.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = renderComments(list, 9, null, 'test.plugin', 'Plugin maker');
  expect(list.textContent.trim()).toBe('Loading reviews…');
  resolve({ ok: true, json: async () => [null, review, { ...review, id: 43, comment: '' }, { ...review, id: 44, comment: '  \n ' }] });
  await pending;
  expect(list.querySelectorAll('.comment')).toHaveLength(1);
  expect(list.querySelector('.reviews-state')).toBeNull();
});

it('offers a retry on failure, then shows the empty state when there are no written reviews', async () => {
  const list = document.createElement('div');
  fetch.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => [] });
  await renderComments(list, 9, null, 'test.plugin', 'Plugin maker');
  expect(list.textContent).toContain('Reviews couldn’t be loaded.');
  list.querySelector('button').click();
  await vi.waitFor(() => expect(list.textContent).toContain('No reviews yet.'));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('shows the empty state only after the final review is successfully deleted', async () => {
  const ref = Ref();
  const list = tag('div', { ref, className: 'list' });
  document.body.append(list);
  fetch.mockResolvedValueOnce({ ok: true, json: async () => [review, { ...review, id: 43 }] });
  await renderComments(ref, 9, { id: 7 }, 'test.plugin', 'Plugin maker');

  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Deleted' }) });
  expect(await deleteComment(42)).toBe(true);
  expect(list.querySelectorAll('.comment')).toHaveLength(1);
  expect(list.querySelector('.reviews-state')).toBeNull();

  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ error: 'Unable to delete' }) });
  expect(await deleteComment(43)).toBe(false);
  expect(list.querySelectorAll('.comment')).toHaveLength(1);
  expect(list.querySelector('.reviews-state')).toBeNull();

  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Deleted' }) });
  expect(await deleteComment(43)).toBe(true);
  expect(list.querySelectorAll('.comment')).toHaveLength(0);
  expect(list.querySelector('.reviews-state')?.textContent).toContain('No reviews yet.');
});

it('keeps a persistent status region and restores focus after retry', async () => {
  const status = tag('p', { className: 'review-status', role: 'status' });
  const list = tag('div', { className: 'list' });
  document.body.append(tag('div', { className: 'comments', children: [status, list] }));
  fetch.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => [review] });
  await renderComments(list, 9, null, 'test.plugin', 'Plugin maker');
  expect(status.textContent).toContain('couldn’t be loaded');
  const retry = list.querySelector('button');
  retry.focus();
  retry.click();
  await vi.waitFor(() => expect(status.textContent).toBe('1 review loaded.'));
  expect(document.querySelector('[role="status"]')).toBe(status);
  expect(document.activeElement).toBe(list.querySelector('.comment'));
});

it('moves focus to the next review or empty state when the success dialog closes', async () => {
  const list = tag('div', { children: [Comment(review), Comment({ ...review, id: 43 })] });
  document.body.append(list);
  fetch.mockResolvedValue({ ok: true, json: async () => ({ message: 'Deleted' }) });
  await deleteComment(42);
  dependencies['components/dialogs/alert'].mock.calls.at(-1)[2]();
  await Promise.resolve();
  expect(document.activeElement).toBe(list.querySelector('.comment'));
  await deleteComment(43);
  dependencies['components/dialogs/alert'].mock.calls.at(-1)[2]();
  await Promise.resolve();
  expect(document.activeElement).toBe(list.querySelector('.reviews-state'));
});

it('keeps the review intact on HTTP errors without an error field', async () => {
  const card = Comment(review);
  document.body.append(card);
  fetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Service unavailable' }) });
  expect(await deleteComment(42)).toBe(false);
  await expect(setCommentReply('Reply', 42, 'Plugin maker', 9, { id: 9 })).rejects.toThrow('Unable to update review');
  expect(document.querySelector('#comment_42')).toBe(card);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(['Reply', ''])('preserves a review when refreshing reply %j fails or it was removed meanwhile', async (reply) => {
  const card = Comment(review);
  document.body.append(card);
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Saved' }) }).mockResolvedValueOnce({ ok: false, json: async () => ({}) });
  await setCommentReply(reply, 42, 'Plugin maker', 9, { id: 9 });
  expect(dependencies['components/dialogs/alert']).toHaveBeenCalledExactlyOnceWith(
    'INFO',
    'Your changes were saved, but the review couldn’t be refreshed. Reload the page to see it.',
  );
  expect(document.querySelector('#comment_42')).toBe(card);
  dependencies['components/dialogs/alert'].mockClear();
  let finish;
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Saved' }) }).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = setCommentReply('Reply', 42, 'Plugin maker', 9, { id: 9 });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(dependencies['components/dialogs/alert']).not.toHaveBeenCalled();
  card.remove();
  finish({ ok: true, json: async () => ({ ...review, author_reply: 'Reply' }) });
  await expect(pending).resolves.toBeUndefined();
  expect(dependencies['components/dialogs/alert']).toHaveBeenCalledExactlyOnceWith('SUCCESS', 'Saved');
  expect(document.querySelector('#comment_42')).toBeNull();
});

it.each([
  ['description', -1],
  ['comments', -1],
  ['comments', 0],
])('loads reviews once from %s and updates totals when the remaining review has vote %s', async (section, remainingVote) => {
  const plugin = {
    id: 'test.plugin',
    name: 'Example',
    author: 'Maker',
    user_id: 9,
    price: 0,
    votes_up: 1,
    votes_down: remainingVote === -1 ? 1 : 0,
    comment_count: 2,
  };
  fetch.mockImplementation(async (url, options) => {
    if (options?.method === 'DELETE') return { ok: true, json: async () => ({ message: 'Deleted' }) };
    if (url === '/api/plugin/test.plugin') return { ok: true, json: async () => plugin };
    if (url === '/api/comments/test.plugin') return { ok: true, json: async () => [review, { ...review, id: 43, vote: remainingVote }] };
    throw new Error(`Unexpected request: ${url}`);
  });
  const page = await Plugin({ id: 'test.plugin', section });
  document.body.append(page);
  const reviewRequests = () => fetch.mock.calls.filter(([url]) => url === '/api/comments/test.plugin');
  const reviewsTab = () => page.querySelector('[data-tab="comments"]');
  if (section === 'description') {
    await vi.waitFor(() => expect(page.querySelector('.plugin-description')).not.toBeNull());
    expect(reviewRequests()).toHaveLength(0);
    reviewsTab().click();
  }
  await vi.waitFor(() => expect(page.querySelectorAll('.comment')).toHaveLength(2));
  expect(reviewRequests()).toHaveLength(1);
  page.querySelector('[data-tab="description"]').click();
  await vi.waitFor(() => expect(page.querySelector('.plugin-description')).not.toBeNull());
  reviewsTab().click();
  await vi.waitFor(() => expect(page.querySelectorAll('.comment')).toHaveLength(2));
  expect(reviewRequests()).toHaveLength(1);

  page.querySelector('#comment_42 [title="Delete this comment"]').click();
  await vi.waitFor(() => expect(reviewsTab().textContent).toBe('1 Review'));
  expect(page.querySelector('.review-status').textContent).toBe('Review deleted. 1 review remains.');
  if (remainingVote === -1) expect(page.querySelector('[alt="thumbs up"]').nextElementSibling.textContent).toBe('0/1');
  else expect(page.querySelector('[alt="thumbs up"]')).toBeNull();
  dependencies['lib/pageMetadata'].applyPluginMetadata.mockClear();
  page.querySelector('#comment_43 [title="Delete this comment"]').click();
  await vi.waitFor(() => expect(reviewsTab().textContent).toBe('0 Reviews'));
  expect(page.querySelector('.review-status').textContent).toBe('No reviews yet.');
  expect(page.querySelector('[alt="thumbs up"]')).toBeNull();
  expect(dependencies['lib/pageMetadata'].applyPluginMetadata).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ comment_count: 0, votes_up: 0, votes_down: 0 }),
  );
});

it.each(['http', 'network'])('keeps flag state on a %s failure', async (failure) => {
  const card = Comment({ ...review, user: { id: 9 }, flagged_by_author: true });
  document.body.append(card);
  if (failure === 'http') fetch.mockResolvedValue({ ok: false, json: async () => ({}) });
  else fetch.mockRejectedValue(new Error('Offline'));
  const button = card.querySelector('[title="Unflag this comment"]');
  button.click();
  await vi.waitFor(() => expect(dependencies['components/dialogs/alert']).toHaveBeenCalledWith('ERROR', expect.any(String)));
  expect(button.title).toBe('Unflag this comment');
  expect(button.classList.contains('flag')).toBe(true);
});

it('does not move focus behind an alert that replaced the delete confirmation', async () => {
  const list = tag('div', { children: [Comment(review)] });
  document.body.append(list);
  fetch.mockResolvedValue({ ok: true, json: async () => ({ message: 'Deleted' }) });
  await deleteComment(42);
  dependencies['components/dialogs/alert'].mock.calls.at(-1)[2]();
  const button = tag('button');
  document.body.append(tag('div', { className: 'dialog-box-container', children: [button] }));
  button.focus();
  await Promise.resolve();
  expect(document.activeElement).toBe(button);
});
