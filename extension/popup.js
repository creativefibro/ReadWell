// Saves the active tab: sends the page as currently shown (so signed-in content is
// included) to ReadWell, which tidies it the same way as links saved from iPhone.
import {loadSettings} from './settings.js';

const status = document.querySelector('#status');
const titleEl = document.querySelector('#title');
const openLink = document.querySelector('#open');
document.querySelector('#setup').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

const MAX_HTML = 6_000_000;

// Runs inside the page. Returns the rendered page without scripts, styles or media.
function capturePage() {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, template, iframe, svg, video, audio, canvas, link[rel="stylesheet"]').forEach((n) => n.remove());
  return {url: location.href, title: document.title, html: '<!doctype html>\n' + clone.outerHTML};
}

function show(message, kind = 'soft') {
  status.textContent = message;
  status.className = kind;
}

async function badge(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({tabId, color: '#2F6B5E'});
    await chrome.action.setBadgeText({tabId, text});
    setTimeout(() => chrome.action.setBadgeText({tabId, text: ''}), 4000);
  } catch { /* badge is optional */ }
}

async function save() {
  const settings = await loadSettings();
  if (!settings.key) { show('Add your ReadWell capture key in Settings first.', 'error'); return; }
  // ?tab=<id> lets the automated check aim the popup at a specific tab.
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({active: true, currentWindow: true});
  let page = {url: tab?.url, title: tab?.title, html: null};
  try {
    const [result] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: capturePage});
    if (result?.result) page = result.result;
  } catch { /* some pages (e.g. the Web Store) block scripts: send the link instead */ }
  if (!/^https?:/i.test(page.url || '')) { show('This page can’t be saved. Open an article first.', 'error'); return; }
  if (page.html && page.html.length > MAX_HTML) page.html = null;

  const headers = {'Content-Type': 'application/json', 'X-ReadWell-Key': settings.key};
  if (settings.clientId && settings.clientSecret) {
    headers['CF-Access-Client-Id'] = settings.clientId;
    headers['CF-Access-Client-Secret'] = settings.clientSecret;
  }
  let response, data = null;
  try {
    response = await fetch(settings.server + '/api/capture', {
      method: 'POST', headers, credentials: 'omit',
      body: JSON.stringify({url: page.url, title: page.title, html: page.html, source: 'extension'}),
    });
    data = await response.json().catch(() => null);
  } catch {
    show('Unable to reach ReadWell. Is your Mac Studio on?', 'error');
    return;
  }
  if (!response.ok) {
    show(response.status === 401 || response.status === 403
      ? 'ReadWell didn’t accept this browser. Check the capture key in Settings.'
      : (data?.error || 'ReadWell couldn’t save this page.'), 'error');
    return;
  }
  if (data.result === 'duplicate') {
    show('Already in your Queue', 'done');
    await badge(tab.id, '•');
  } else {
    show(data.lastFinished
      ? `Saved to ReadWell. You finished this on ${new Date(data.lastFinished).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'})}.`
      : 'Saved to ReadWell', 'done');
    await badge(tab.id, '✓');
  }
  titleEl.textContent = data.title || page.title || '';
  titleEl.hidden = !titleEl.textContent;
  openLink.href = settings.server + '/';
  openLink.target = '_blank';
  openLink.hidden = false;
}

save().catch(() => show('ReadWell couldn’t save this page.', 'error'));
