// Link normalisation for duplicate detection and Medium recognition.
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|ref_url|_hsenc|_hsmi|mkt_tok)$/i;
// Medium adds these to shared and digest links; they never change the article.
const MEDIUM_TRACKING = /^(source|sk|gi|postPublishedType)$/i;

export function parseHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || url.username || url.password) return null;
  return url;
}

// Same article, same key: lower-case host, no www., no fragment, no tracking
// parameters, sorted remaining parameters, no trailing slash, http treated as https.
export function canonicalKey(value) {
  const url = parseHttpUrl(value);
  if (!url) return null;
  url.hash = '';
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if ((url.port === '443') || (url.port === '80')) url.port = '';
  const medium = isMediumUrl(url.href);
  const kept = [...url.searchParams.entries()].filter(([k]) => !TRACKING.test(k) && !(medium && MEDIUM_TRACKING.test(k)));
  kept.sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [k, v] of kept) url.searchParams.append(k, v);
  return url.origin + url.pathname.replace(/\/+$/, '') + url.search;
}

// The link as saved and opened: tracking parameters and fragment removed, nothing else changed.
export function withoutTracking(value) {
  const url = parseHttpUrl(value);
  if (!url) return null;
  const medium = isMediumUrl(url.href);
  for (const k of [...url.searchParams.keys()]) if (TRACKING.test(k) || (medium && MEDIUM_TRACKING.test(k))) url.searchParams.delete(k);
  url.hash = '';
  return url.href;
}

export function isMediumUrl(value) {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return host === 'medium.com' || host.endsWith('.medium.com') || host === 'link.medium.com';
}

// A readable title when a page cannot be fetched: "example.com: how to rest well".
export function titleFromUrl(value) {
  const url = parseHttpUrl(value);
  if (!url) return 'Untitled article';
  const host = url.hostname.replace(/^www\./, '');
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/-[0-9a-f]{8,}$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return last ? `${host}: ${last}` : host;
}
