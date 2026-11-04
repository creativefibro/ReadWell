import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalKey, isMediumUrl, titleFromUrl} from '../lib/urls.mjs';
import {extractMetadata} from '../lib/metadata.mjs';
import {isPrivateAddress, assertPublicHost, fetchPage} from '../lib/fetch-page.mjs';
import {setup, articlePage, KEY} from './helpers.mjs';

test('S-002 links that differ only by tracking, fragment, slash or host case share one key', () => {
  const base = canonicalKey('https://example.com/blog/rest');
  for (const v of [
    'https://EXAMPLE.com/blog/rest/', 'http://www.example.com/blog/rest#part-2',
    'https://example.com/blog/rest?utm_source=x&utm_medium=email&fbclid=1', 'https://example.com:443/blog/rest?gclid=abc',
  ]) assert.equal(canonicalKey(v), base, v);
  assert.notEqual(canonicalKey('https://example.com/blog/rest?page=2'), base);
  assert.equal(canonicalKey('https://medium.com/@ada/rest-well-1a2b3c4d5e6f?source=email-digest&sk=abc'),
    canonicalKey('https://medium.com/@ada/rest-well-1a2b3c4d5e6f'));
  assert.equal(canonicalKey('javascript:alert(1)'), null);
  assert.equal(canonicalKey('https://user:pw@example.com/'), null);
});

test('S-003 Medium links are recognised', () => {
  assert.ok(isMediumUrl('https://medium.com/@ada/x'));
  assert.ok(isMediumUrl('https://ada.medium.com/x'));
  assert.ok(!isMediumUrl('https://notmedium.com/x'));
  assert.equal(titleFromUrl('https://example.com/2026/how-to-rest-well.html'), 'example.com: how to rest well');
});

test('S-001 metadata comes from meta tags, JSON-LD and the title', () => {
  const m = extractMetadata(articlePage({words: 500, canonical: '/blog/rest'}), 'https://example.com/blog/rest?utm_source=x');
  assert.equal(m.title, 'How to Rest Well');
  assert.equal(m.author, 'Ada Writer');
  assert.equal(m.site, 'Calm Times');
  assert.equal(m.published, '2026-10-01T09:30:00Z');
  assert.equal(m.excerpt, 'A gentle guide & some advice.');
  assert.equal(m.canonical, 'https://example.com/blog/rest');
  assert.ok(m.words >= 500 && m.words < 560, String(m.words));
  assert.ok(!m.text.includes('window.evil'));
  const ld = extractMetadata(`<html><head><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","headline":"LD Title","author":[{"name":"Bo"},{"name":"Cy"}],"datePublished":"2025-05-05"}]}</script></head><body>x</body></html>`, 'https://news.test/a');
  assert.deepEqual([ld.title, ld.author, ld.published, ld.site], ['LD Title', 'Bo, Cy', '2025-05-05', 'news.test']);
});

test('S-001 saving a link fetches the page and stores its details', async () => {
  const t = setup({pages: {'https://example.com/blog/rest': articlePage({words: 1150})}});
  const r = await t.capture({url: 'https://example.com/blog/rest', source: 'shortcut'});
  assert.equal(r.status, 201);
  assert.equal(r.body.result, 'saved');
  assert.equal(r.body.message, 'Saved to ReadWell');
  const a = t.store.getArticle(r.body.id);
  assert.equal(a.title, 'How to Rest Well');
  assert.equal(a.author, 'Ada Writer');
  assert.equal(a.site, 'Calm Times');
  assert.equal(a.published, '2026-10-01');
  assert.equal(a.savedAt, '2026-11-04T10:00:00.000Z');
  assert.equal(a.kind, 'reader');
  assert.equal(a.minutes, 5);
  assert.ok(a.needsCleaning && a.rawHtml.includes('<article>'));
});

test('S-001 a page that cannot be fetched is still saved and opens in the original', async () => {
  const t = setup();
  const r = await t.capture({url: 'https://example.com/2026/gone-page'});
  assert.equal(r.body.result, 'saved');
  const a = t.store.getArticle(r.body.id);
  assert.equal(a.kind, 'original');
  assert.equal(a.title, 'example.com: gone page');
  assert.match(a.fetchError, /404/);
  assert.equal(a.rawHtml, null);
});

test('S-001 a title supplied by the Shortcut is used when the page has none', async () => {
  const t = setup();
  const r = await t.capture({url: 'https://example.com/x', title: '  A Shared   Title '});
  assert.equal(t.store.getArticle(r.body.id).title, 'A Shared Title');
});

test('S-002 saving the same article again keeps one copy and says so', async () => {
  const t = setup({pages: {
    'https://example.com/blog/rest': articlePage(),
    'https://other.example/share/123': {html: articlePage({canonical: 'https://example.com/blog/rest'}), finalUrl: 'https://other.example/share/123'},
  }});
  const first = await t.capture({url: 'https://example.com/blog/rest'});
  const again = await t.capture({url: 'https://www.example.com/blog/rest/?utm_source=newsletter#top'});
  assert.equal(again.status, 200);
  assert.equal(again.body.result, 'duplicate');
  assert.equal(again.body.message, 'Already in your Queue');
  assert.equal(again.body.id, first.body.id);
  assert.equal(t.fetched.length, 1, 'no second fetch for a known link');
  const viaCanonical = await t.capture({url: 'https://other.example/share/123'});
  assert.equal(viaCanonical.body.result, 'duplicate');
  assert.equal(t.store.count(), 1);
});

test('S-002 an article finished before is saved again and says when', async () => {
  const t = setup({pages: {'https://example.com/a': articlePage()}});
  const first = await t.capture({url: 'https://example.com/a'});
  t.store.finish(first.body.id, {rating: 4});
  t.tick(86400000);
  const again = await t.capture({url: 'https://example.com/a'});
  assert.equal(again.body.result, 'saved');
  assert.equal(again.body.lastFinished, '2026-11-04T10:00:00.000Z');
});

test('S-003 Medium articles are saved without their text', async () => {
  const t = setup({pages: {
    'https://medium.com/@ada/rest-1a2b3c4d5e6f': articlePage({title: 'Medium Piece', site: 'Medium', words: 3000}),
    'https://pub.example/rest': articlePage({title: 'Custom Domain Medium', medium: true}),
  }});
  const r = await t.capture({url: 'https://medium.com/@ada/rest-1a2b3c4d5e6f?source=email-digest'});
  const a = t.store.getArticle(r.body.id);
  assert.equal(a.kind, 'medium');
  assert.equal(a.title, 'Medium Piece');
  assert.equal(a.author, 'Ada Writer');
  assert.equal(a.rawHtml, null);
  assert.equal(a.minutes, null);
  const custom = await t.capture({url: 'https://pub.example/rest'});
  assert.equal(t.store.getArticle(custom.body.id).kind, 'medium');
  const blocked = await t.capture({url: 'https://medium.com/@ada/members-only-99', title: 'Members Only'});
  const b = t.store.getArticle(blocked.body.id);
  assert.deepEqual([b.kind, b.title], ['medium', 'Members Only']);
});

test('S-011 HTML sent by the extension is used without fetching', async () => {
  const t = setup();
  const r = await t.capture({url: 'https://paywalled.example/story', html: articlePage({title: 'Signed In Story'}), source: 'extension'});
  assert.equal(r.body.result, 'saved');
  assert.equal(t.fetched.length, 0);
  assert.equal(t.store.getArticle(r.body.id).title, 'Signed In Story');
});

test('capture requires the device key and a web link', async () => {
  const t = setup();
  const noKey = await t.call('/api/capture', {method: 'POST', body: {url: 'https://example.com/'}});
  assert.equal(noKey.status, 401);
  const wrong = await t.call('/api/capture', {method: 'POST', body: {url: 'https://example.com/'}, headers: {'x-readwell-key': KEY + 'x'}});
  assert.equal(wrong.status, 401);
  const bad = await t.capture({url: 'file:///etc/passwd'});
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /web link/);
});

test('the server refuses to fetch local or private addresses', async () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.100.1.1'])
    assert.ok(isPrivateAddress(a), a);
  for (const a of ['93.184.216.34', '2606:4700::1111']) assert.ok(!isPrivateAddress(a), a);
  await assert.rejects(assertPublicHost(new URL('http://localhost:6391/'), async () => []), /Local addresses/);
  await assert.rejects(assertPublicHost(new URL('https://sneaky.test/'), async () => [{address: '127.0.0.1'}]), /Local addresses/);
  const redirects = async (url) => url.includes('start')
    ? new Response(null, {status: 302, headers: {location: 'http://127.0.0.1:6391/api'}})
    : new Response('<html></html>', {headers: {'content-type': 'text/html'}});
  await assert.rejects(fetchPage('https://ok.test/start', {fetcher: redirects, resolve: async (h) => [{address: h === '127.0.0.1' ? h : '93.184.216.34'}]}), /Local addresses/);
});

test('fetchPage decodes the declared charset and refuses non-HTML', async () => {
  const resolve = async () => [{address: '93.184.216.34'}];
  const latin = Buffer.from('<html><head><meta charset="iso-8859-1"><title>Caf\xe9</title></head></html>', 'latin1');
  const page = await fetchPage('https://ok.test/', {resolve, fetcher: async () => new Response(latin, {headers: {'content-type': 'text/html'}})});
  assert.match(page.html, /Café/);
  await assert.rejects(fetchPage('https://ok.test/f.pdf', {resolve, fetcher: async () => new Response('x', {headers: {'content-type': 'application/pdf'}})}), /not a web page/);
});

test('titles lose a trailing site or author name; bylines lose "By"', async () => {
  const {tidyTitle, tidyByline} = await import('../lib/metadata.mjs');
  assert.equal(tidyTitle('Obama admits US gun laws are his biggest frustration - BBC News', ['BBC News']), 'Obama admits US gun laws are his biggest frustration');
  assert.equal(tidyTitle('What is the sea telling us? | Eleanor Ainge Roy', ['the Guardian', 'Eleanor Ainge Roy']), 'What is the sea telling us?');
  assert.equal(tidyTitle('Rust | Rust', ['Rust']), 'Rust | Rust', 'never shortens to almost nothing');
  assert.equal(tidyTitle('Mind-body pacing - a guide', ['Calm Times']), 'Mind-body pacing - a guide');
  assert.equal(tidyByline('By Joshua Sokol'), 'Joshua Sokol');
  assert.equal(tidyByline('by: Ada'), 'Ada');
  assert.equal(tidyByline('Bystander Ann'), 'Bystander Ann');
});

test('a Medium link with no fetched details shows Medium as its site', async () => {
  const t = setup();
  const r = await t.capture({url: 'https://medium.com/@a/b-0011', title: 'B'});
  assert.equal(t.store.getArticle(r.body.id).site, 'Medium');
});
