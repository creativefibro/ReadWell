// Production gate in front of the ReadWell app (Flourish pattern). Every request must
// carry a Cloudflare Access token verified here; the tunnel alone is never trusted.
import {SECURITY} from './app.mjs';

// Home Screen installers fetch these without cookies; they contain no personal data.
export const PUBLIC_PATHS = new Set(['/manifest.webmanifest', '/icons/apple-touch-icon.png', '/icons/icon-192.png',
  '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/favicon-32.png']);

const plain = {...SECURITY, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8'};
function refuse(status, text, url) {
  return url.pathname.startsWith('/api/')
    ? new Response(JSON.stringify({error: text, signIn: status === 401}), {status, headers: {...plain, 'Content-Type': 'application/json'}})
    : new Response(text, {status, headers: plain});
}

export function createGate({config, verifier, app}) {
  return async function gate(request) {
    const url = new URL(request.url);
    if (url.origin !== config.origin) return refuse(421, 'Unrecognised hostname', url);
    // Cloudflare passes CORS preflights for the save route straight through; they carry no
    // credentials and the app answers them with headers only.
    if (request.method === 'OPTIONS' && url.pathname === '/api/capture') return app(request);
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return refuse(405, 'Method not allowed', url);
    if (['GET', 'HEAD'].includes(request.method) && PUBLIC_PATHS.has(url.pathname)) {
      const response = await app(request);
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=3600');
      return new Response(response.body, {status: response.status, headers});
    }
    if (!verifier) return refuse(503, 'ReadWell is waiting for its secure Access configuration.', url);
    let identity;
    try { identity = await verifier.verify(request.headers.get('cf-access-jwt-assertion')); }
    catch { return refuse(401, 'Please sign in to ReadWell again.', url); }
    // The service token may only save articles; it can never read the Queue.
    if (identity.kind === 'service' && !(request.method === 'POST' && url.pathname === '/api/capture')) return refuse(403, 'This key can only save articles.', url);
    const clean = new Headers(request.headers);
    for (const name of [...clean.keys()]) if (name.startsWith('cf-access-')) clean.delete(name);
    return app(new Request(request, {headers: clean}));
  };
}
