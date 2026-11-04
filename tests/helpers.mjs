import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../server/sqlite.mjs';
import {createStore} from '../lib/store.mjs';
import {createApp} from '../server/app.mjs';

export const ORIGIN = 'http://127.0.0.1:4320';
export const KEY = 'test-capture-key-0123456789';

export function articlePage({title = 'How to Rest Well', author = 'Ada Writer', site = 'Calm Times', words = 900, canonical, medium = false, extra = ''} = {}) {
  const para = Array.from({length: Math.ceil(words / 10)}, (_, i) => `<p>Sentence ${i} has exactly ten little words in it here.</p>`).join('\n');
  return `<!doctype html><html><head><title>${title} | ${site}</title>
<meta property="og:title" content="${title}">
<meta name="author" content="${author}">
<meta property="og:site_name" content="${site}">
<meta property="article:published_time" content="2026-10-01T09:30:00Z">
<meta property="og:description" content="A gentle guide &amp; some advice.">
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
${medium ? '<meta property="al:android:package" content="com.medium.reader">' : ''}
<script>window.evil = 1</script><style>p{}</style></head>
<body><nav>Home About</nav><article><h1>${title}</h1>${para}${extra}</article><footer>Footer</footer></body></html>`;
}

export function setup({pages = {}, now} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'readwell-test-'));
  const db = openDatabase(join(dir, 'test.sqlite'), fileURLToPath(new URL('../migrations', import.meta.url)));
  let clock = now ? new Date(now) : new Date('2026-11-04T10:00:00Z');
  const store = createStore(db, {now: () => clock});
  const fetched = [];
  const fetchPage = async (url) => {
    fetched.push(url);
    const page = pages[url];
    if (!page) throw new Error('The site answered 404');
    return typeof page === 'string' ? {html: page, finalUrl: url} : page;
  };
  const app = createApp({store, fetchPage, captureKey: KEY, origin: ORIGIN});
  const call = async (path, {method = 'GET', body, headers = {}} = {}) => {
    const res = await app(new Request(ORIGIN + path, {
      method,
      headers: {...(method === 'POST' ? {origin: ORIGIN, 'content-type': 'application/json'} : {}), ...headers},
      ...(body !== undefined ? {body: typeof body === 'string' ? body : JSON.stringify(body)} : {}),
    }));
    const type = res.headers.get('content-type') || '';
    return {status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text()};
  };
  const capture = (body) => call('/api/capture', {method: 'POST', body, headers: {'x-readwell-key': KEY}});
  return {db, store, app, call, capture, fetched, tick: (ms) => { clock = new Date(clock.getTime() + ms); }};
}
