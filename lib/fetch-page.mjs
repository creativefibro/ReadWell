// Fetches a public web page for the Queue. Refuses local and private network
// addresses, because the server runs on Susan's Mac beside other local services.
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {parseHttpUrl} from './urls.mjs';

const MAX_BYTES = 6_000_000;
const MAX_REDIRECTS = 5;
const AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15 ReadWell/1.0';

export function isPrivateAddress(address) {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const s = address.toLowerCase();
    if (s.startsWith('::ffff:')) return isPrivateAddress(s.slice(7));
    return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') ||
      s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb') || s.startsWith('ff');
  }
  return true;
}

export async function assertPublicHost(url, resolve = lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new Error('Local addresses cannot be saved');
  const addresses = isIP(host) ? [{address: host}] : await resolve(host, {all: true});
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error('Local addresses cannot be saved');
}

export async function fetchPage(value, {fetcher = fetch, resolve = lookup, timeoutMs = 15000} = {}) {
  let url = parseHttpUrl(value);
  if (!url) throw new Error('Not a web link');
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url, resolve);
    const response = await fetcher(url.href, {
      redirect: 'manual', signal,
      headers: {'User-Agent': AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en-GB,en;q=0.8'},
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      const next = parseHttpUrl(new URL(response.headers.get('location'), url).href);
      if (!next) throw new Error('The page redirected somewhere ReadWell cannot follow');
      url = next;
      continue;
    }
    if (!response.ok) throw new Error(`The site answered ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (type && !/html|xml/i.test(type)) throw new Error('This link is not a web page');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const {done, value: chunk} = await reader.read();
      if (done) break;
      size += chunk.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('The page is too large'); }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const charset = (type.match(/charset=([^;\s]+)/i) || [])[1] ||
      (bytes.subarray(0, 4096).toString('latin1').match(/<meta[^>]+charset=["']?([-\w]+)/i) || [])[1] || 'utf-8';
    let html;
    try { html = new TextDecoder(charset.toLowerCase()).decode(bytes); } catch { html = new TextDecoder('utf-8').decode(bytes); }
    return {html, finalUrl: url.href};
  }
  throw new Error('Too many redirects');
}
