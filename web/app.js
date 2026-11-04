// ReadWell web app: Queue, Reader and Finish. No framework; one small module.
import {cleanArticle, sanitize} from './clean.js';

const main = document.querySelector('#main');
const toastEl = document.querySelector('.toast');
const finishDialog = document.querySelector('#finish');
const ORDER_LABELS = {oldest: 'Oldest first', newest: 'Newest first', shortest: 'Shortest first'};

let queueState = null;
let searchTerm = '';
let searchTimer = 0;
let current = null;          // article open in the Reader or details page
let positionTimer = 0;
let lastSent = -1;

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

async function api(path, {method = 'GET', body} = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: {'X-Requested-With': 'XMLHttpRequest', ...(body !== undefined ? {'Content-Type': 'application/json'} : {})},
    ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw Object.assign(new Error(data?.error || 'ReadWell couldn’t complete that. Please try again.'), {status: res.status});
  return data;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.hidden = true; }, 4000);
}

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }

function savedAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Saved today';
  if (days === 1) return 'Saved yesterday';
  if (days < 14) return `Saved ${days} days ago`;
  if (days < 60) return `Saved ${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `Saved ${Math.round(days / 30)} months ago`;
  return 'Saved over a year ago';
}
const longDate = (iso) => new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'});
const minutesText = (a) => (a.minutes ? `${a.minutes} min read` : null);
const opensText = (a) => (a.kind === 'medium' ? 'Opens in Medium' : a.kind === 'original' ? 'Opens in original' : null);

function ribbonWidth(minutes) {
  if (!minutes) return 0;
  return Math.round(Math.min(1, Math.log1p(minutes) / Math.log1p(40)) * 100); // 40 min fills the ribbon
}

// ---------- routing ----------
function go(path, {replace = false} = {}) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  route();
}
window.addEventListener('popstate', route);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});

async function route() {
  leaveArticle();
  const m = location.pathname.match(/^\/article\/([0-9a-f-]{36})$/);
  if (m) return showArticle(m[1]);
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  return showQueue();
}

// ---------- Queue ----------
function rowHtml(a) {
  const meta = [a.site, a.author && a.author !== a.site ? a.author : null, savedAgo(a.savedAt)].filter(Boolean);
  const opens = opensText(a);
  return `<li><a class="row" data-link href="/article/${a.id}">
    <span class="ribbon">${a.minutes ? `<i data-w="${ribbonWidth(a.minutes)}" aria-hidden="true"></i>${esc(minutesText(a))}` : opens ? `<span class="opens">${esc(opens)}</span>` : ''}</span>
    <h3 class="title">${esc(a.title)}</h3>
    <span class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}${a.minutes && opens ? `<span class="opens">${esc(opens)}</span>` : ''}</span>
  </a></li>`;
}

function continueHtml(a) {
  if (!a) return '';
  const progress = a.kind === 'reader' && a.position > 0.02 ? `${Math.round(a.position * 100)}% read` : opensText(a) || minutesText(a);
  return `<a class="continue" data-link href="/article/${a.id}">
    <span class="label">Continue Reading</span>
    <h2 class="title">${esc(a.title)}</h2>
    <span class="meta">${esc([a.site, progress].filter(Boolean).join(', '))}</span>
  </a>`;
}

function queueHtml(q) {
  const head = `<header class="masthead"><h1 class="wordmark"><a data-link href="/">ReadWell</a></h1>
    ${q.total ? '<button type="button" class="quiet" id="lucky" title="Open a random article from your Queue">Lucky Dip</button>' : ''}</header>`;
  if (!q.total) {
    return head + `<section class="empty"><h2>Nothing waiting</h2>
      <p>Save an article from Vivaldi or the Share menu and it will appear here.</p></section>`;
  }
  const list = q.articles.length
    ? `<ul class="queue">${q.articles.map(rowHtml).join('')}</ul>`
    : q.search
      ? `<section class="empty"><p>No articles match “${esc(q.search)}”.</p><button type="button" class="text-button" id="clear-search">Clear Search</button></section>`
      : '';
  const counted = q.search ? `${q.articles.length} ${q.articles.length === 1 ? 'match' : 'matches'}` : `${q.total} ${q.total === 1 ? 'article' : 'articles'} in your Queue`;
  return head + continueHtml(q.continueReading) + `
    <div class="controls">
      <div class="search"><label class="visually-hidden" for="search">Search your Queue</label>
        <input id="search" type="search" placeholder="Search your Queue" autocomplete="off" enterkeyhint="search" value="${esc(searchTerm)}"></div>
      <label class="order"><span>Order</span><select id="order">${Object.entries(ORDER_LABELS).map(([v, l]) => `<option value="${v}"${v === q.order ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <p class="count" role="status">${counted}</p>${list}`;
}

async function loadQueue() {
  const params = new URLSearchParams();
  if (searchTerm) params.set('q', searchTerm);
  queueState = await api('/api/queue' + (params.size ? '?' + params : ''));
  return queueState;
}

async function showQueue({keepFocus = false} = {}) {
  document.title = 'ReadWell';
  const scroll = sessionStorage.getItem('queue-scroll');
  try {
    const q = await loadQueue();
    const focused = keepFocus && document.activeElement?.id === 'search';
    const caret = focused ? document.activeElement.selectionStart : null;
    main.innerHTML = queueHtml(q);
    main.querySelectorAll('.ribbon i[data-w]').forEach((i) => i.style.setProperty('--w', i.dataset.w + '%'));
    if (focused) { const s = main.querySelector('#search'); s.focus(); s.setSelectionRange(caret, caret); }
    if (scroll && !keepFocus) { window.scrollTo(0, Number(scroll)); sessionStorage.removeItem('queue-scroll'); }
    cleanPending(q);
  } catch (error) {
    main.innerHTML = `<header class="masthead"><h1 class="wordmark">ReadWell</h1></header><section class="problem">
      <p>Unable to load your Queue. Check your connection and try again.</p>
      <button type="button" class="primary" id="retry">Try Again</button></section>`;
  }
}

main.addEventListener('input', (e) => {
  if (e.target.id !== 'search') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { searchTerm = e.target.value.trim(); showQueue({keepFocus: true}); }, 250);
});
main.addEventListener('keydown', (e) => {
  if (e.target.id === 'search' && e.key === 'Escape' && e.target.value) { e.target.value = ''; searchTerm = ''; showQueue({keepFocus: true}); }
});
main.addEventListener('change', async (e) => {
  if (e.target.id !== 'order') return;
  try { await api('/api/settings/order', {method: 'POST', body: {order: e.target.value}}); await showQueue(); }
  catch (error) { toast(error.message); }
});
main.addEventListener('click', async (e) => {
  const id = e.target.closest('button')?.id;
  if (id === 'retry') return route();
  if (id === 'clear-search') { searchTerm = ''; return showQueue(); }
  if (id === 'lucky') {
    try {
      const {id: pick} = await api('/api/lucky-dip');
      if (pick) go(`/article/${pick}`);
    } catch (error) { toast(error.message); }
  }
});
document.addEventListener('click', (e) => {
  if (e.target.closest('a.row, a.continue') && location.pathname === '/') sessionStorage.setItem('queue-scroll', String(window.scrollY));
}, true);

// Tidy articles saved by link (Shortcut) using this browser's parser, a few at a time.
let cleaning = false;
async function cleanPending(q) {
  if (cleaning || !globalThis.Readability) return;
  const pending = [q.continueReading, ...q.articles].filter((a) => a?.needsCleaning).slice(0, 4);
  if (!pending.length) return;
  cleaning = true;
  try {
    for (const a of pending) await cleanOne(a.id);
  } finally { cleaning = false; }
}

async function cleanOne(id, article) {
  const a = article || await api(`/api/articles/${id}`);
  if (!a.rawHtml) return a;
  const cleaned = cleanArticle(a.rawHtml, a.url);
  if (!cleaned) return a;
  const summary = await api(`/api/articles/${id}/cleaned`, {method: 'POST', body: cleaned});
  return {...a, ...summary, contentHtml: cleaned.contentHtml, rawHtml: null, needsCleaning: false};
}

// ---------- Reader and details ----------
function sizeControls() {
  const size = document.documentElement.dataset.size || 'medium';
  return `<span class="sizes" role="group" aria-label="Text size">${['small', 'medium', 'large'].map((s) =>
    `<button type="button" data-size="${s}" aria-pressed="${s === size}" title="${s[0].toUpperCase() + s.slice(1)} text"><span aria-hidden="true">A</span><span class="visually-hidden">${s} text</span></button>`).join('')}</span>`;
}

function headHtml(a) {
  const meta = [a.author, a.published ? longDate(a.published) : null, minutesText(a)].filter(Boolean);
  return `<header class="article-head">
    <div class="site">${esc(a.site || new URL(a.url).hostname)}</div>
    <h1>${esc(a.title)}</h1>
    <div class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>
  </header>`;
}

function openLabel(a) { return a.kind === 'medium' ? 'Open in Medium' : 'Open Original'; }

async function showArticle(id) {
  main.innerHTML = '<p class="loading" role="status">Opening article…</p>';
  let a;
  try {
    a = await api(`/api/articles/${id}`);
    if (a.kind === 'reader' && !a.contentHtml && a.rawHtml) a = await cleanOne(id, a);
  } catch (error) {
    main.innerHTML = `<section class="problem"><p>${esc(error.status === 404 ? 'This article is no longer in your Queue.' : 'Unable to open this article. Check your connection and try again.')}</p>
      <a class="primary" data-link href="/">Back to Queue</a></section>`;
    return;
  }
  current = a;
  document.title = `${a.title} – ReadWell`;
  api(`/api/articles/${id}/opened`, {method: 'POST'}).catch(() => {});
  const bar = `<nav class="reader-bar" aria-label="Article">
      <a class="back" data-link href="/" aria-label="Back to Queue">‹ <span class="wide">Back to&nbsp;</span>Queue</a>
      <span class="group">${a.kind === 'reader' && a.contentHtml ? sizeControls() + '<button type="button" class="quiet" id="finish-open">Finish…</button>' : ''}</span>
    </nav>`;
  const original = `<a class="quiet" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${openLabel(a)}</a>`;
  if (a.kind === 'reader' && a.contentHtml) {
    main.innerHTML = bar + `<article aria-labelledby="article-title">${headHtml(a).replace('<h1>', '<h1 id="article-title">')}
      <div class="prose">${sanitize(a.contentHtml, a.url)}</div>
      <footer class="article-end"><p>You’ve reached the end.</p>
        <button type="button" class="primary" id="finish-end">Finish…</button>${original}</footer></article>`;
    restorePosition(a.position);
    window.addEventListener('scroll', onScroll, {passive: true});
  } else {
    const why = a.kind === 'medium' ? '' : a.kind === 'original'
      ? `<p class="notice">Couldn’t fetch this page${a.fetchError ? ` (${esc(a.fetchError)})` : ''}. It opens in the original.</p>`
      : '<p class="notice">ReadWell couldn’t find the article text on this page. It opens in the original.</p>';
    main.innerHTML = bar + `<article aria-labelledby="article-title">${headHtml(a).replace('<h1>', '<h1 id="article-title">')}
      ${why}${a.excerpt ? `<p class="excerpt">${esc(a.excerpt)}</p>` : ''}
      <div class="link-actions"><a class="primary" id="open-original" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${openLabel(a)}</a>
        <span class="finished-it">Finished it? <button type="button" class="quiet" id="finish-end">Finish…</button></span></div></article>`;
  }
  main.focus({preventScroll: true});
}

function restorePosition(p) {
  lastSent = p || 0;
  if (!p || p < 0.01) { window.scrollTo(0, 0); return; }
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.max(0, p * max));
  });
}

function currentPosition() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

function sendPosition({beacon = false} = {}) {
  if (!current || current.kind !== 'reader') return;
  const p = Math.round(currentPosition() * 1000) / 1000;
  if (Math.abs(p - lastSent) < 0.005) return;
  lastSent = p;
  current.position = p;
  const url = `/api/articles/${current.id}/position`;
  fetch(url, {method: 'POST', keepalive: beacon, credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}, body: JSON.stringify({position: p})}).catch(() => {});
}

function onScroll() {
  clearTimeout(positionTimer);
  positionTimer = setTimeout(sendPosition, 1500);
}

function leaveArticle() {
  if (current) sendPosition({beacon: true});
  window.removeEventListener('scroll', onScroll);
  clearTimeout(positionTimer);
  current = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') sendPosition({beacon: true});
});
window.addEventListener('pagehide', () => sendPosition({beacon: true}));

// Text size: three sizes, remembered on this device.
document.documentElement.dataset.size = storageGet('readwell-size') || 'medium';
main.addEventListener('click', (e) => {
  const b = e.target.closest('.sizes button');
  if (!b) return;
  const before = currentPosition();
  document.documentElement.dataset.size = b.dataset.size;
  storageSet('readwell-size', b.dataset.size);
  main.querySelectorAll('.sizes button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  restorePosition(before);
});

// ---------- Finish ----------
const finishForm = document.querySelector('#finish-form');
const starLabels = [...finishForm.querySelectorAll('.star-row label')];
function paintStars() {
  const v = Number(finishForm.rating.value || 0);
  starLabels.forEach((l, i) => l.classList.toggle('on', i < v));
}
finishForm.addEventListener('change', paintStars);
finishForm.querySelector('.clear-rating').addEventListener('click', () => {
  finishForm.querySelectorAll('input[name=rating]').forEach((r) => { r.checked = false; });
  paintStars();
});

main.addEventListener('click', (e) => {
  if (!e.target.closest('#finish-open, #finish-end') || !current) return;
  finishForm.reset();
  paintStars();
  finishForm.querySelector('.form-error').textContent = '';
  finishDialog.querySelector('.finish-article').textContent = current.title;
  finishDialog.showModal();
});

finishForm.addEventListener('submit', async (e) => {
  const action = e.submitter?.value;
  if (action !== 'delete' || !current) return;
  e.preventDefault();
  const rating = finishForm.rating.value ? Number(finishForm.rating.value) : null;
  const button = e.submitter;
  button.disabled = true;
  try {
    await api(`/api/articles/${current.id}/finish`, {method: 'POST', body: {rating, outcome: 'deleted'}});
    current = null;
    finishDialog.close();
    sessionStorage.removeItem('queue-scroll');
    go('/', {replace: true});
    toast(rating ? 'Finished. Rating saved.' : 'Finished.');
  } catch (error) {
    finishForm.querySelector('.form-error').textContent = error.message;
  } finally { button.disabled = false; }
});

route();
