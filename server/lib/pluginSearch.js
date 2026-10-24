// Correlated with the `plugin` row in the inner query, where the author's user row isn't joined yet.
const AUTHOR_NAME = '(SELECT u.name FROM user AS u WHERE u.id = plugin.user_id)';
const SEARCH_FIELDS = ['name', 'id', 'keywords', AUTHOR_NAME];
const MAX_TERMS = 8;

/**
 * Words keep their original characters: SQLite's LIKE folds case for ASCII letters only, so
 * lowercasing here would stop "ÜBUNG" from matching a plugin named "ÜBUNG". Duplicates are
 * found the way LIKE compares, so "Go go" is one word and scores once.
 * @param {string} query
 * @returns {string[]} the distinct words of the query, each as first typed
 */
function searchTerms(query) {
  const terms = new Map();
  for (const term of query.split(/\s+/)) {
    const key = term.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    if (term && !terms.has(key)) terms.set(key, term);
  }
  return [...terms.values()].slice(0, MAX_TERMS);
}

/**
 * Where conditions for a plugin search: every word must appear in the plugin's name, id,
 * keywords, or its author's name, so "python lsp" or an author's name finds plugins too.
 * @param {string} query
 * @returns {Array<[string, string, string] | 'OR'>}
 */
function pluginSearchWhere(query) {
  return searchTerms(query).flatMap((term) => SEARCH_FIELDS.flatMap((field, i) => (i ? ['OR', [field, term, 'LIKE']] : [[field, term, 'LIKE']])));
}

/**
 * Orders the closest matches first: the exact name, then names starting with or containing the
 * query, then names holding more of its words, then the author's name. The listing's own order
 * breaks ties. Runs on the listing, after the author join.
 * @param {string} query
 * @returns {{ orderBy: string[], values: string[] }}
 */
function pluginSearchRank(query) {
  const terms = searchTerms(query);
  // The phrase is the query as typed, so "Go Go" stays an exact match for a plugin named "Go Go".
  const phrase = query.trim();
  return {
    orderBy: [
      'CASE WHEN name LIKE ? THEN 0 WHEN name LIKE ? THEN 1 WHEN name LIKE ? THEN 2 ELSE 3 END',
      `${terms.map(() => '(name LIKE ?)').join(' + ')} DESC`,
      'author LIKE ? DESC',
    ],
    values: [phrase, `${phrase}%`, `%${phrase}%`, ...terms.map((term) => `%${term}%`), `%${phrase}%`],
  };
}

module.exports = { pluginSearchWhere, pluginSearchRank };
