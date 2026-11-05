// Saves the active tab: sends the page as currently shown (so signed-in content is
// included) to ReadWell, which tidies it the same way as links saved from iPhone.
import {loadSettings, saveSettings} from './settings.js';

const status = document.querySelector('#status');
const titleEl = document.querySelector('#title');
const openLink = document.querySelector('#open');
// Settings live inside the popup (Vivaldi can block extension pages opened in a tab).
const resultEl = document.querySelector('#result');
const form = document.querySelector('#settings');
const savedEl = document.querySelector('#saved');
async function showSettings(message) {
  const s = await loadSettings();
  for (const k of ['server', 'key', 'clientId', 'clientSecret']) form[k].value = s[k];
  savedEl.textContent = message || '';
  savedEl.className = message ? 'error' : 'soft';
  resultEl.hidden = true;
  form.hidden = false;
  form[s.key ? 'clientId' : 'key'].focus();
}
document.querySelector('#setup').addEventListener('click', (e) => { e.preventDefault(); showSettings(); });
document.querySelector('#cancel').addEventListener('click', (e) => { e.preventDefault(); form.hidden = true; resultEl.hidden = false; });
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await saveSettings(Object.fromEntries(new FormData(form)));
    form.hidden = true;
    resultEl.hidden = false;
    show('Settings saved. Saving this page…');
    titleEl.hidden = true;
    await save();
  } catch (error) {
    savedEl.textContent = error.message;
    savedEl.className = 'error';
  }
});

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
    await chrome.action.setBadgeBackgroundColor({tabId, color: '#8951EE'});
    await chrome.action.setBadgeText({tabId, text});
    setTimeout(() => chrome.action.setBadgeText({tabId, text: ''}), 4000);
  } catch { /* badge is optional */ }
}

function askForSiteAccess(origin) {
  show('ReadWell needs permission to reach ' + new URL(origin.replace('/*', '')).host + '.', 'error');
  let button = document.querySelector('#allow');
  if (!button) {
    button = document.createElement('button');
    button.id = 'allow';
    button.type = 'button';
    button.textContent = 'Allow and Save';
    status.after(button);
  }
  button.onclick = async () => {
    let granted = false;
    try { granted = await chrome.permissions.request({origins: [origin]}); } catch { granted = false; }
    button.remove();
    if (granted) { show('Saving this page…'); await save(); }
    else show('Permission wasn’t given. In vivaldi://extensions, open Details and set Site access to “On all sites” or add readwell.susanpearson.uk.', 'error');
  };
}

async function save() {
  const settings = await loadSettings();
  if (!settings.key) { await showSettings('Add your ReadWell details to start saving.'); return; }
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

  // Vivaldi and Chrome let people withhold an extension's site access; without it the
  // browser blocks the request before it leaves. Ask for it with a button (needs a click).
  const origin = new URL(settings.server).origin + '/*';
  let allowed = true;
  try { allowed = await chrome.permissions.contains({origins: [origin]}); } catch { /* older browsers: assume granted */ }
  if (!allowed) { askForSiteAccess(origin); return; }

  const headers = {'Content-Type': 'application/json', 'X-ReadWell-Key': settings.key};
  if (settings.clientId && settings.clientSecret) {
    headers['CF-Access-Client-Id'] = settings.clientId;
    headers['CF-Access-Client-Secret'] = settings.clientSecret;
  }
  let response, data = null;
  try {
    response = await fetch(settings.server + '/api/capture', {
      method: 'POST', headers, credentials: 'omit', redirect: 'manual',
      body: JSON.stringify({url: page.url, title: page.title, html: page.html, source: 'extension'}),
    });
    data = await response.json().catch(() => null);
  } catch (error) {
    show(`Unable to reach ReadWell. Is your Mac Studio on? (${error?.message || 'network error'})`, 'error');
    return;
  }
  // Cloudflare answers a refused save token with a redirect to its sign-in page.
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    show(settings.clientId
      ? 'Cloudflare didn’t accept the save token. Check the Client ID and Client secret in Settings.'
      : 'Cloudflare needs the save token. Add the Client ID and Client secret in Settings.', 'error');
    return;
  }
  if (response.status === 403 && !data) {
    show('Cloudflare refused this save. Check the Client ID and Client secret in Settings.', 'error');
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
