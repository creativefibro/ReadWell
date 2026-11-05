// All reads and writes of ReadWell's database.
import {randomUUID} from 'node:crypto';
import {canonicalKey, firstLinkIn, isMediumUrl, parseHttpUrl, titleFromUrl, withoutTracking} from './urls.mjs';
import {extractMetadata, readingMinutes, tidyByline} from './metadata.mjs';

export const ORDERS = ['oldest', 'newest', 'shortest'];
const MAX_HTML = 6_000_000;
const MAX_CLEAN = 3_000_000;

export function londonDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
}

function isoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const fail = (status, message) => Object.assign(new Error(message), {status});

const SUMMARY = `id, url, title, author, site, published, excerpt, kind, minutes, saved_at, opened_at, position,
  fetch_error, added_by, (raw_html IS NOT NULL AND content_html IS NULL) AS needs_cleaning`;

function summary(row) {
  if (!row) return null;
  return {
    id: row.id, url: row.url, title: row.title, author: row.author, site: row.site, published: row.published,
    excerpt: row.excerpt, kind: row.kind, minutes: row.minutes, savedAt: row.saved_at, openedAt: row.opened_at,
    position: row.position, fetchError: row.fetch_error, addedBy: row.added_by, needsCleaning: !!row.needs_cleaning,
  };
}

// Belt and braces only: the browser sanitises with an allowlist before display.
function stripActive(html) {
  return String(html)
    .replace(/<(script|style|iframe|object|embed|form|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"');
}

export function createStore(db, {now = () => new Date()} = {}) {
  const raw = db.raw;
  const q = (sql) => raw.prepare(sql);
  const stamp = () => now().toISOString();

  function findExisting(...keys) {
    const list = [...new Set(keys.filter(Boolean))];
    for (const key of list) {
      const row = q(`SELECT ${SUMMARY} FROM articles WHERE canonical_key = ? OR url_key = ?`).get(key, key);
      if (row) return summary(row);
    }
    return null;
  }

  function lastFinished(...keys) {
    const list = [...new Set(keys.filter(Boolean))];
    let latest = null;
    for (const key of list) {
      const row = q('SELECT MAX(finished_at) AS at FROM history WHERE canonical_key = ?').get(key);
      if (row?.at && (!latest || row.at > latest)) latest = row.at;
    }
    return latest;
  }

  // capture: {url, html?, title?, source}. html is the page as seen (extension) or null.
  async function saveCapture(input, {fetchPage}) {
    const given = input?.url ?? firstLinkIn(input?.text);
    if (given == null) throw fail(400, 'No link found in what was shared. In Medium, tap Copy link first, then Share via… › Save to ReadWell.');
    const url = parseHttpUrl(withoutTracking(given));
    if (!url) throw fail(400, 'This doesn’t look like a web link.');
    const urlKey = canonicalKey(url.href);
    const existing = findExisting(urlKey);
    if (existing) return {result: 'duplicate', article: existing};

    let html = typeof input.html === 'string' && input.html.length ? input.html : null;
    if (html && html.length > MAX_HTML) throw fail(413, 'This page is too large to save.');
    let pageUrl = url.href;
    let fetchError = null;
    if (!html) {
      try {
        const page = await fetchPage(url.href);
        html = page.html;
        pageUrl = page.finalUrl;
      } catch (error) {
        fetchError = error.message || 'Couldn’t fetch this page';
      }
    }

    const meta = html ? extractMetadata(html, pageUrl) : null;
    const medium = isMediumUrl(url.href) || isMediumUrl(pageUrl) || !!meta?.medium;
    const canonical = canonicalKey(meta?.canonical || pageUrl) || urlKey;
    const again = findExisting(canonical, canonicalKey(pageUrl));
    if (again) return {result: 'duplicate', article: again};

    const givenTitle = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    const words = meta?.words || 0;
    const kind = medium ? 'medium' : (html && words >= 40 ? 'reader' : 'original');
    const at = stamp();
    const row = {
      id: randomUUID(), url: url.href, url_key: urlKey, canonical_key: canonical,
      title: (meta && meta.title !== titleFromUrl(pageUrl) ? meta.title : null) || givenTitle || meta?.title || titleFromUrl(url.href),
      author: meta?.author || null, site: meta?.site || (medium ? 'Medium' : url.hostname.replace(/^www\./, '')),
      published: isoDate(meta?.published), excerpt: meta?.excerpt || null, image: meta?.image || null, kind,
      raw_html: kind === 'reader' ? html : null,
      search_text: kind === 'reader' ? (meta.text || '').slice(0, 1_000_000) : '',
      words: kind === 'reader' ? words : null, minutes: kind === 'reader' ? readingMinutes(words) : null,
      fetch_error: kind === 'original' ? (fetchError || 'Couldn’t find article text on this page') : null,
      saved_at: at, updated_at: at, added_by: 'susan',
      source: ['extension', 'shortcut', 'inbox', 'app'].includes(input.source) ? input.source : 'app',
    };
    try {
      q(`INSERT INTO articles (id, url, url_key, canonical_key, title, author, site, published, excerpt, image, kind,
          raw_html, search_text, words, minutes, fetch_error, saved_at, updated_at, added_by, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.url, row.url_key, row.canonical_key, row.title, row.author, row.site, row.published, row.excerpt,
        row.image, row.kind, row.raw_html, row.search_text, row.words, row.minutes, row.fetch_error, row.saved_at,
        row.updated_at, row.added_by, row.source);
    } catch (error) {
      if (/UNIQUE/.test(error.message)) return {result: 'duplicate', article: findExisting(canonical)};
      throw error;
    }
    return {result: 'saved', article: getSummary(row.id), lastFinished: lastFinished(urlKey, canonical)};
  }

  function getSummary(id) {
    return summary(q(`SELECT ${SUMMARY} FROM articles WHERE id = ?`).get(String(id)));
  }

  function getArticle(id) {
    const row = q(`SELECT ${SUMMARY}, content_html, raw_html, image FROM articles WHERE id = ?`).get(String(id));
    if (!row) throw fail(404, 'This article is no longer in your Queue.');
    return {...summary(row), image: row.image, contentHtml: row.content_html, rawHtml: row.needs_cleaning ? row.raw_html : null};
  }

  function queue({order = getOrder(), search = ''} = {}) {
    if (!ORDERS.includes(order)) order = 'oldest';
    const sort = {
      oldest: 'saved_at ASC',
      newest: 'saved_at DESC',
      shortest: 'minutes IS NULL, minutes ASC, saved_at ASC',
    }[order];
    const cont = summary(q(`SELECT ${SUMMARY} FROM articles WHERE status = 'queue' AND opened_at IS NOT NULL
      ORDER BY opened_at DESC LIMIT 1`).get());
    const term = String(search || '').trim().slice(0, 200);
    let rows;
    if (term) {
      const like = '%' + term.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      rows = q(`SELECT ${SUMMARY} FROM articles WHERE status = 'queue' AND (
          lower(title) LIKE ?1 ESCAPE '\\' OR lower(ifnull(author, '')) LIKE ?1 ESCAPE '\\'
          OR lower(ifnull(site, '')) LIKE ?1 ESCAPE '\\' OR lower(search_text) LIKE ?1 ESCAPE '\\')
        ORDER BY ${sort}`).all(like);
    } else {
      rows = q(`SELECT ${SUMMARY} FROM articles WHERE status = 'queue' ORDER BY ${sort}`).all();
    }
    const articles = rows.map(summary).filter((a) => term || !cont || a.id !== cont.id);
    return {order, search: term, continueReading: term ? null : cont, articles, total: count()};
  }

  function count() {
    return q(`SELECT COUNT(*) AS n FROM articles WHERE status = 'queue'`).get().n;
  }

  function luckyDip(random = Math.random) {
    const rows = q(`SELECT id, opened_at FROM articles WHERE status = 'queue'`).all();
    if (!rows.length) return null;
    const latest = rows.filter((r) => r.opened_at).sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1))[0];
    const pool = rows.length > 1 && latest ? rows.filter((r) => r.id !== latest.id) : rows;
    return pool[Math.floor(random() * pool.length)].id;
  }

  function recordOpen(id) {
    const at = stamp();
    const changed = q(`UPDATE articles SET opened_at = ?, updated_at = ? WHERE id = ?`).run(at, at, String(id)).changes;
    if (!changed) throw fail(404, 'This article is no longer in your Queue.');
    q(`INSERT OR IGNORE INTO reading_days (day) VALUES (?)`).run(londonDay(now()));
    return getSummary(id);
  }

  function savePosition(id, position) {
    const p = Number(position);
    if (!Number.isFinite(p) || p < 0 || p > 1) throw fail(400, 'Reading position must be between 0 and 1.');
    const changed = q(`UPDATE articles SET position = ?, updated_at = ? WHERE id = ?`).run(p, stamp(), String(id)).changes;
    if (!changed) throw fail(404, 'This article is no longer in your Queue.');
    return {position: p};
  }

  function saveCleaned(id, input) {
    const html = typeof input?.contentHtml === 'string' ? input.contentHtml : '';
    const text = typeof input?.text === 'string' ? input.text.replace(/\s+/g, ' ').trim() : '';
    if (!html || html.length > MAX_CLEAN) throw fail(400, 'Cleaned article is missing or too large.');
    const current = q(`SELECT id, title, author, excerpt FROM articles WHERE id = ?`).get(String(id));
    if (!current) throw fail(404, 'This article is no longer in your Queue.');
    const words = text ? text.split(' ').length : 0;
    const author = current.author || (typeof input.byline === 'string' ? tidyByline(input.byline.slice(0, 200)) : null);
    const excerpt = current.excerpt || (typeof input.excerpt === 'string' ? input.excerpt.trim().slice(0, 400) || null : null);
    q(`UPDATE articles SET content_html = ?, raw_html = NULL, search_text = ?, words = ?, minutes = ?,
        author = ?, excerpt = ?, updated_at = ? WHERE id = ?`).run(
      stripActive(html), text.slice(0, 1_000_000), words, readingMinutes(words), author, excerpt, stamp(), String(id));
    return getSummary(id);
  }

  // Finishing writes History first; the article goes only after History is saved.
  function finish(id, {rating = null, outcome = 'deleted'} = {}) {
    if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw fail(400, 'Rating must be one to five stars, or none.');
    if (outcome !== 'deleted') throw fail(400, 'Only Delete is available until exports arrive.');
    const a = q(`SELECT * FROM articles WHERE id = ?`).get(String(id));
    if (!a) throw fail(404, 'This article is no longer in your Queue.');
    const entry = {id: randomUUID(), finishedAt: stamp()};
    raw.exec('BEGIN IMMEDIATE');
    try {
      q(`INSERT INTO history (id, article_id, url, canonical_key, title, author, site, kind, saved_at, finished_at,
          rating, highlight_count, outcome, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
        entry.id, a.id, a.url, a.canonical_key, a.title, a.author, a.site, a.kind, a.saved_at, entry.finishedAt,
        rating, outcome, a.added_by);
      q(`INSERT OR IGNORE INTO reading_days (day) VALUES (?)`).run(londonDay(now()));
      q(`DELETE FROM articles WHERE id = ?`).run(a.id);
      raw.exec('COMMIT');
    } catch (error) {
      raw.exec('ROLLBACK');
      throw error;
    }
    return {historyId: entry.id, finishedAt: entry.finishedAt, rating};
  }

  function getOrder() {
    const v = q(`SELECT value FROM settings WHERE key = 'order'`).get()?.value;
    return ORDERS.includes(v) ? v : 'oldest';
  }

  function setOrder(order) {
    if (!ORDERS.includes(order)) throw fail(400, 'Choose Oldest first, Newest first or Shortest first.');
    q(`INSERT INTO settings (key, value) VALUES ('order', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(order);
    return {order};
  }

  return {saveCapture, getArticle, getSummary, queue, luckyDip, recordOpen, savePosition, saveCleaned, finish, getOrder, setOrder, count};
}
