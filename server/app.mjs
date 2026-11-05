// ReadWell's HTTP routes, written against the web Request/Response API so the
// same code runs locally and behind Cloudflare Access on the Mac Studio.
import {readFile} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
export const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; " +
    "connect-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; " +
    "form-action 'self'; frame-ancestors 'none'",
};

const corsFor = (origin) => ({
  'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'content-type, x-readwell-key, cf-access-client-id, cf-access-client-secret',
});

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {...SECURITY, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'},
});

function sameKey(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function body(request, limit) {
  const text = await request.text();
  if (text.length > limit) throw Object.assign(new Error('Request too large'), {status: 413});
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Request body must be JSON'), {status: 400}); }
}

async function staticFile(pathname) {
  const path = pathname === '/' ? '/index.html' : pathname;
  if (path.includes('\0') || path.includes('..')) return null;
  const file = normalize(join(WEB, path));
  if (!file.startsWith(WEB)) return null;
  try {
    const data = await readFile(file);
    const type = TYPES[extname(file)] || 'application/octet-stream';
    return new Response(data, {headers: {...SECURITY, 'Content-Type': type, 'Cache-Control': 'no-cache'}});
  } catch { return null; }
}

export function createApp({store, fetchPage, captureKey, origin}) {
  return async function handle(request) {
    const url = new URL(request.url);
    const {pathname} = url;
    const method = request.method;
    try {
      if (pathname === '/api/capture') {
        // Browser extensions send a CORS preflight before saving. Answer it for extension
        // origins only; the save itself still needs the service token and the capture key.
        const from = request.headers.get('origin') || '';
        const extension = /^(chrome|moz)-extension:\/\/[a-z0-9-]{1,64}$/.test(from);
        if (method === 'OPTIONS') {
          if (!extension) return new Response(null, {status: 403, headers: SECURITY});
          return new Response(null, {status: 204, headers: {...SECURITY, ...corsFor(from), 'Access-Control-Max-Age': '600'}});
        }
        if (method !== 'POST') return json({error: 'Method not allowed'}, 405);
        const withCors = (response) => { if (extension) for (const [k, v] of Object.entries(corsFor(from))) response.headers.set(k, v); return response; };
        if (!sameKey((request.headers.get('x-readwell-key') || '').trim(), captureKey)) return withCors(json({error: 'This device isn’t set up to save to ReadWell.', notice: 'Not saved: the capture key in the Shortcut doesn’t match. Paste it again from 1Password.'}, 401));
        const input = await body(request, 7_000_000);
        const outcome = await store.saveCapture(input, {fetchPage});
        const a = outcome.article;
        return withCors(json({
          result: outcome.result,
          message: outcome.result === 'duplicate' ? 'Already in your Queue' : 'Saved to ReadWell',
          notice: (outcome.result === 'duplicate' ? 'Already in your Queue: ' : 'Saved to ReadWell: ') + (a?.title || ''),
          id: a?.id, title: a?.title, kind: a?.kind, lastFinished: outcome.lastFinished || null,
        }, outcome.result === 'saved' ? 201 : 200));
      }

      if (pathname.startsWith('/api/')) {
        if (method === 'POST') {
          const from = request.headers.get('origin');
          if (from !== origin) return json({error: 'Cross-origin changes are blocked'}, 403);
        } else if (method !== 'GET') return json({error: 'Method not allowed'}, 405);

        if (method === 'GET' && pathname === '/api/queue') {
          return json(store.queue({order: url.searchParams.get('order') || undefined, search: url.searchParams.get('q') || ''}));
        }
        if (method === 'GET' && pathname === '/api/lucky-dip') return json({id: store.luckyDip()});
        if (method === 'POST' && pathname === '/api/settings/order') return json(store.setOrder((await body(request, 2000)).order));
        const m = pathname.match(/^\/api\/articles\/([0-9a-f-]{36})(?:\/(opened|position|cleaned|finish))?$/);
        if (m) {
          const [, id, action] = m;
          if (method === 'GET' && !action) return json(store.getArticle(id));
          if (method === 'POST' && action === 'opened') return json(store.recordOpen(id));
          if (method === 'POST' && action === 'position') return json(store.savePosition(id, (await body(request, 2000)).position));
          if (method === 'POST' && action === 'cleaned') return json(store.saveCleaned(id, await body(request, 4_000_000)));
          if (method === 'POST' && action === 'finish') {
            const b = await body(request, 2000);
            return json(store.finish(id, {rating: b.rating ?? null, outcome: b.outcome || 'deleted'}));
          }
        }
        return json({error: 'Not found'}, 404);
      }

      if (method !== 'GET' && method !== 'HEAD') return json({error: 'Method not allowed'}, 405);
      const file = await staticFile(pathname);
      if (file) return file;
      // Client-side routes all load the app shell.
      if (!extname(pathname)) return await staticFile('/');
      return new Response('Not found', {status: 404, headers: {...SECURITY, 'Content-Type': 'text/plain'}});
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      const message = status === 500 ? 'ReadWell couldn’t complete that. Please try again.' : error.message;
      return json({error: message, notice: 'Not saved: ' + message}, status);
    }
  };
}
