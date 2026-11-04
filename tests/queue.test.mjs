import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup, articlePage, ORIGIN} from './helpers.mjs';

async function seeded() {
  const pages = {
    'https://a.test/long': articlePage({title: 'Long Read', words: 4600, site: 'Alpha'}),
    'https://b.test/short': articlePage({title: 'Short Note on Pacing', words: 460, site: 'Beta', author: 'Pat Calm'}),
    'https://c.test/mid': articlePage({title: 'Middle Piece', words: 2300, site: 'Gamma', extra: '<p>Mention of hedgehogs.</p>'}),
  };
  const t = setup({pages});
  const ids = {};
  for (const [url, key] of [['https://a.test/long', 'long'], ['https://b.test/short', 'short'], ['https://c.test/mid', 'mid']]) {
    ids[key] = (await t.capture({url})).body.id;
    t.tick(3600_000);
  }
  ids.medium = (await t.capture({url: 'https://medium.com/@x/pending-0011', title: 'A Medium One'})).body.id;
  return {...t, ids};
}

test('S-004 each order returns the Queue correctly and defaults to Oldest first', async () => {
  const t = await seeded();
  const titles = (order) => t.store.queue({order}).articles.map((a) => a.title);
  assert.deepEqual(titles(undefined), ['Long Read', 'Short Note on Pacing', 'Middle Piece', 'A Medium One']);
  assert.deepEqual(titles('newest'), ['A Medium One', 'Middle Piece', 'Short Note on Pacing', 'Long Read']);
  assert.deepEqual(titles('shortest'), ['Short Note on Pacing', 'Middle Piece', 'Long Read', 'A Medium One']);
});

test('S-004 the chosen order is remembered on the server for every device', async () => {
  const t = await seeded();
  const saved = await t.call('/api/settings/order', {method: 'POST', body: {order: 'shortest'}});
  assert.equal(saved.status, 200);
  const q = await t.call('/api/queue');
  assert.equal(q.body.order, 'shortest');
  assert.equal(q.body.articles[0].title, 'Short Note on Pacing');
  const bad = await t.call('/api/settings/order', {method: 'POST', body: {order: 'random'}});
  assert.equal(bad.status, 400);
});

test('S-004 Queue rows carry only what the row shows, not article text', async () => {
  const t = await seeded();
  const row = (await t.call('/api/queue')).body.articles[0];
  assert.deepEqual(Object.keys(row).sort(), ['addedBy', 'author', 'excerpt', 'fetchError', 'id', 'kind', 'minutes', 'needsCleaning', 'openedAt', 'position', 'published', 'savedAt', 'site', 'title', 'url'].sort());
});

test('S-005 search matches title, author, site and text, as plain text', async () => {
  const t = await seeded();
  const find = (q) => t.store.queue({search: q}).articles.map((a) => a.title);
  assert.deepEqual(find('PACING'), ['Short Note on Pacing']);
  assert.deepEqual(find('pat calm'), ['Short Note on Pacing']);
  assert.deepEqual(find('gamma'), ['Middle Piece']);
  assert.deepEqual(find('hedgehogs'), ['Middle Piece']);
  assert.deepEqual(find('%'), []);
  assert.deepEqual(find("'; DROP TABLE articles; --"), []);
  assert.equal(t.store.count(), 4);
});

test('S-006 Lucky Dip picks a Queue article other than the one in Continue Reading', async () => {
  const t = await seeded();
  assert.ok(Object.values(t.ids).includes(t.store.luckyDip()));
  t.store.recordOpen(t.ids.mid);
  for (let i = 0; i < 40; i++) assert.notEqual(t.store.luckyDip(), t.ids.mid);
  assert.equal(t.store.luckyDip(() => 0.999), t.store.queue({order: 'oldest'}).articles.at(-1).id);
  const lucky = await t.call('/api/lucky-dip');
  assert.ok(Object.values(t.ids).includes(lucky.body.id));
});

test('S-006 Lucky Dip with an empty Queue returns nothing', () => {
  assert.equal(setup().store.luckyDip(), null);
});

test('S-007 Continue Reading is the most recently opened unfinished article, shown once', async () => {
  const t = await seeded();
  assert.equal(t.store.queue().continueReading, null);
  t.store.recordOpen(t.ids.long);
  t.tick(1000);
  t.store.recordOpen(t.ids.short);
  const q = t.store.queue();
  assert.equal(q.continueReading.id, t.ids.short);
  assert.ok(!q.articles.some((a) => a.id === t.ids.short));
  assert.equal(q.articles.length, 3);
  t.store.finish(t.ids.short, {});
  assert.equal(t.store.queue().continueReading.id, t.ids.long);
});

test('S-008 reading position is saved and restored, within 0 to 1', async () => {
  const t = await seeded();
  const r = await t.call(`/api/articles/${t.ids.mid}/position`, {method: 'POST', body: {position: 0.42}});
  assert.equal(r.status, 200);
  assert.equal(t.store.getArticle(t.ids.mid).position, 0.42);
  assert.equal((await t.call(`/api/articles/${t.ids.mid}/position`, {method: 'POST', body: {position: 1.5}})).status, 400);
  assert.equal((await t.call(`/api/articles/${t.ids.mid}/position`, {method: 'POST', body: {position: 'x'}})).status, 400);
});

test('S-008 S-009 opening an article records a reading day and makes it Continue Reading', async () => {
  const t = await seeded();
  const r = await t.call(`/api/articles/${t.ids.medium}/opened`, {method: 'POST'});
  assert.equal(r.status, 200);
  assert.deepEqual(t.db.raw.prepare('SELECT day FROM reading_days').all().map((d) => d.day), ['2026-11-04']);
  assert.equal(t.store.queue().continueReading.id, t.ids.medium);
});

test('reading days follow London time, not UTC', async () => {
  const t = setup({now: '2026-07-01T23:30:00Z', pages: {'https://a.test/x': articlePage()}});
  const id = (await t.capture({url: 'https://a.test/x'})).body.id;
  t.store.recordOpen(id);
  assert.deepEqual(t.db.raw.prepare('SELECT day FROM reading_days').all().map((d) => d.day), ['2026-07-02']);
});

test('S-008 cleaned text replaces the raw page and refines reading length', async () => {
  const t = await seeded();
  const before = t.store.getArticle(t.ids.long);
  assert.ok(before.needsCleaning && before.rawHtml);
  const text = Array.from({length: 920}, () => 'word').join(' ');
  const r = await t.call(`/api/articles/${t.ids.long}/cleaned`, {method: 'POST', body: {
    contentHtml: '<p onclick="x()">Clean <a href="javascript:alert(1)">text</a></p><script>bad()</script>', text,
  }});
  assert.equal(r.status, 200);
  const after = t.store.getArticle(t.ids.long);
  assert.equal(after.needsCleaning, false);
  assert.equal(after.rawHtml, null);
  assert.equal(after.minutes, 4);
  assert.ok(!/onclick|javascript:|<script/i.test(after.contentHtml), after.contentHtml);
});

test('S-010 finishing writes History before removing the article, with an optional rating', async () => {
  const t = await seeded();
  const r = await t.call(`/api/articles/${t.ids.short}/finish`, {method: 'POST', body: {rating: 5}});
  assert.equal(r.status, 200);
  const h = t.db.raw.prepare('SELECT * FROM history').all();
  assert.equal(h.length, 1);
  assert.equal(h[0].title, 'Short Note on Pacing');
  assert.equal(h[0].rating, 5);
  assert.equal(h[0].outcome, 'deleted');
  assert.equal(h[0].author, 'Pat Calm');
  assert.equal((await t.call(`/api/articles/${t.ids.short}`)).status, 404);
  const none = await t.call(`/api/articles/${t.ids.long}/finish`, {method: 'POST', body: {}});
  assert.equal(none.body.rating, null);
  for (const rating of [0, 6, 2.5, '3']) assert.equal((await t.call(`/api/articles/${t.ids.mid}/finish`, {method: 'POST', body: {rating}})).status, 400);
  assert.equal(t.store.count(), 2);
});

test('S-010 if History cannot be written the article stays in the Queue', async () => {
  const t = await seeded();
  t.db.raw.exec("CREATE TRIGGER block BEFORE INSERT ON history BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  assert.throws(() => t.store.finish(t.ids.short, {rating: 3}));
  assert.equal(t.store.getArticle(t.ids.short).title, 'Short Note on Pacing');
});

test('changes from another origin are blocked; unknown routes are 404', async () => {
  const t = await seeded();
  const cross = await t.app(new Request(ORIGIN + `/api/articles/${t.ids.short}/finish`, {method: 'POST', headers: {origin: 'https://evil.test', 'content-type': 'application/json'}, body: '{}'}));
  assert.equal(cross.status, 403);
  const noOrigin = await t.app(new Request(ORIGIN + '/api/settings/order', {method: 'POST', body: '{"order":"newest"}'}));
  assert.equal(noOrigin.status, 403);
  assert.equal((await t.call('/api/nothing')).status, 404);
  assert.equal(t.store.count(), 4);
});

test('the app shell is served with a strict content policy for every page route', async () => {
  const t = setup();
  const home = await t.call('/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self';/);
  assert.match(home.body, /<title>ReadWell<\/title>/);
  assert.equal((await t.call('/article/123')).status, 200);
  assert.equal((await t.call('/../package.json')).status, 404);
  assert.equal((await t.call('/missing.js')).status, 404);
});
