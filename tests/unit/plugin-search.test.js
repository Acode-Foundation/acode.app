const Module = require('node:module');
const Database = require('better-sqlite3');
const { pluginSearchRank, pluginSearchWhere } = require('../../server/lib/pluginSearch');

let db;
let Plugin;

function loadPlugin(database) {
  const entityPath = require.resolve('../../server/entities/entity');
  const pluginPath = require.resolve('../../server/entities/plugin');
  delete require.cache[entityPath];
  delete require.cache[pluginPath];

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === '../lib/db' && parent?.filename.startsWith(`${process.cwd()}/server/entities/`)) return database;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(pluginPath);
  } finally {
    Module._load = originalLoad;
  }
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, verified INTEGER, github TEXT, website TEXT, email TEXT);
    CREATE TABLE comment (id INTEGER PRIMARY KEY, plugin_id TEXT, comment TEXT);
    INSERT INTO user (id, name) VALUES (1, 'Raunak Raj'), (2, 'Someone Else');
  `);
  Plugin = loadPlugin(db);
  const insert = db.prepare('INSERT INTO plugin (id, name, keywords, user_id, downloads, status) VALUES (?, ?, ?, ?, ?, 1)');
  for (const row of [
    ['acode.python', 'Python', '["python","lsp"]', 2, '500'],
    ['acode.pyright', 'Pyright Language Server', '["python","lsp","types"]', 1, '900'],
    ['acode.python.tools', 'Python Tools', '["python"]', 2, '50'],
    ['acode.ai.agent', 'Acode AI Agent', '["ai","agent"]', 1, '3000'],
    ['acode.markdown', 'Markdown Preview', '["md"]', 2, '700'],
  ]) {
    insert.run(...row);
  }
});

afterEach(() => db.close());

async function search(query) {
  const rank = pluginSearchRank(query);
  const rows = await Plugin.get(['id'], [[Plugin.STATUS, Plugin.STATUS_APPROVED], ...pluginSearchWhere(query)], {
    orderBy: [...rank.orderBy, 'CAST(downloads AS INTEGER) DESC'],
    orderValues: rank.values,
  });
  return rows.map((row) => row.id);
}

it('finds plugins by their author', async () => {
  expect(await search('raunak')).toEqual(['acode.ai.agent', 'acode.pyright']);
});

it('matches every word against any field, ranking name matches before keyword matches', async () => {
  expect(await search('python lsp')).toEqual(['acode.python', 'acode.pyright']);
  expect(await search('python')).toEqual(['acode.python', 'acode.python.tools', 'acode.pyright']);
});

it('finds plugins by id and keyword, case-insensitively', async () => {
  expect(await search('ACODE.MARKDOWN')).toEqual(['acode.markdown']);
  expect(await search('Types')).toEqual(['acode.pyright']);
});

it('keeps the other filters when the search ORs across fields', async () => {
  db.prepare('UPDATE plugin SET status = 0 WHERE id = ?').run('acode.ai.agent');
  expect(await search('raunak')).toEqual(['acode.pyright']);
});
