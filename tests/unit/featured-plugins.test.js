import Database from 'better-sqlite3';
import { getFeaturedPluginIds, setPluginFeatured } from '../../server/lib/featuredPlugins';

let db;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE plugin (id TEXT PRIMARY KEY, status INTEGER);`);
  const insert = db.prepare('INSERT INTO plugin VALUES (?, ?)');
  for (const [id, status] of [
    ['one', 1],
    ['two', 1],
    ['three', 1],
    ['four', 1],
    ['pending', 0],
    ['rejected', 2],
    ['deleted', 3],
  ]) {
    insert.run(id, status);
  }
});

afterEach(() => db.close());

it('caps featured plugins at three, allows repeat requests, and frees a slot when unfeatured', () => {
  for (const id of ['one', 'two', 'three']) expect(setPluginFeatured(id, true, db)).toEqual({ featured: true });
  expect(setPluginFeatured('one', true, db)).toEqual({ featured: true });
  expect(setPluginFeatured('four', true, db)).toMatchObject({ status: 409 });
  expect(getFeaturedPluginIds(db)).toEqual(['one', 'three', 'two']);
  setPluginFeatured('two', false, db);
  expect(setPluginFeatured('four', true, db)).toEqual({ featured: true });
  expect(getFeaturedPluginIds(db)).toEqual(['four', 'one', 'three']);
});

it('rejects invalid requests and non-public plugins without saving settings', () => {
  for (const [id, featured] of [
    ['one', 'false'],
    [[], true],
    ['', true],
  ]) {
    expect(setPluginFeatured(id, featured, db)).toMatchObject({ status: 400 });
  }
  for (const id of ['pending', 'rejected', 'deleted']) expect(setPluginFeatured(id, true, db)).toMatchObject({ status: 400 });
  expect(setPluginFeatured('missing', true, db)).toMatchObject({ status: 404 });
  expect(db.prepare('SELECT * FROM app_config').all()).toEqual([]);
});

it('hides a featured plugin immediately when unpublished or deleted and makes its slot available', () => {
  for (const id of ['one', 'two', 'three']) setPluginFeatured(id, true, db);
  db.prepare('UPDATE plugin SET status = 3 WHERE id = ?').run('one');
  db.prepare('UPDATE plugin SET status = 0 WHERE id = ?').run('two');
  expect(getFeaturedPluginIds(db)).toEqual(['three']);
  expect(setPluginFeatured('four', true, db)).toEqual({ featured: true });
  expect(getFeaturedPluginIds(db)).toEqual(['four', 'three']);
});
