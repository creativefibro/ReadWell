// Reads article details from raw HTML without a DOM. Never used to render anything:
// article text is cleaned later in the browser (web/clean.js).
import {canonicalKey, isMediumUrl, parseHttpUrl, titleFromUrl} from './urls.mjs';

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“'};
export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const clean = (s, max = 500) => {
  if (s == null) return null;
  const t = decodeEntities(String(s)).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

function attributes(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return attrs;
}

function jsonLd(html) {
  const found = [];
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const queue = Array.isArray(data) ? [...data] : [data];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
        const type = [].concat(item['@type'] || []).join(' ');
        if (/Article|BlogPosting|NewsArticle|Report|WebPage/i.test(type)) found.push(item);
      }
    } catch { /* ignore malformed structured data */ }
  }
  return found;
}

function personName(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(personName).filter(Boolean).join(', ') || null;
  if (typeof value === 'object') return value.name || null;
  return null;
}

// "Title | Site", "Title - BBC News", "Title | Author": drop a trailing site or author name.
export function tidyTitle(title, names) {
  let t = String(title || '').trim();
  for (const name of names.filter(Boolean)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = t.replace(new RegExp(`\\s+[|\\-–—:·]\\s+${escaped}\\s*$`, 'i'), '').trim();
    if (next.length >= 8) t = next;
  }
  return t;
}

export const tidyByline = (s) => (s ? String(s).replace(/^\s*by[:\s]+/i, '').trim() || null : null);

export function readingMinutes(words) {
  return words > 0 ? Math.max(1, Math.round(words / 230)) : null;
}

// Rough word count from raw HTML, refined once the article is cleaned.
export function roughText(html) {
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  return clean(body
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' '), 2_000_000) || '';
}

export function extractMetadata(html, pageUrl) {
  const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, html.slice(0, 200_000)])[1];
  const meta = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (key && a.content != null && !(key in meta)) meta[key] = a.content;
  }
  let canonical = null;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    if ((a.rel || '').toLowerCase().split(/\s+/).includes('canonical') && a.href) {
      try { canonical = new URL(decodeEntities(a.href), pageUrl).href; } catch {}
      break;
    }
  }
  const ld = jsonLd(html);
  const ldFirst = (key) => ld.map((i) => i[key]).find(Boolean);
  const titleTag = clean((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const text = roughText(html);
  const words = text ? text.split(/\s+/).length : 0;
  const host = parseHttpUrl(pageUrl)?.hostname.replace(/^www\./, '') || null;
  const medium = isMediumUrl(pageUrl) || (canonical && isMediumUrl(canonical)) ||
    meta['al:android:package'] === 'com.medium.reader' || /^medium$/i.test(meta['al:ios:app_name'] || '');
  let image = null;
  if (meta['og:image']) { try { image = parseHttpUrl(new URL(decodeEntities(meta['og:image']), pageUrl).href)?.href || null; } catch {} }
  const author = tidyByline(clean(meta['author'] || meta['article:author'] || meta['parsely-author'] || meta['sailthru.author'] || personName(ldFirst('author')), 200));
  const site = clean(meta['og:site_name'] || meta['application-name'] || personName(ldFirst('publisher')), 120) || (medium && /medium\.com$/.test(host || '') ? 'Medium' : host);
  const rawTitle = clean(meta['og:title'] || meta['twitter:title'] || ldFirst('headline') || titleTag, 300);
  return {
    title: rawTitle ? tidyTitle(rawTitle, [site, author, host]) : titleFromUrl(pageUrl),
    author: author && /^https?:/i.test(author) ? null : author,
    site,
    published: clean(meta['article:published_time'] || meta['datepublished'] || meta['date'] || meta['dc.date'] || ldFirst('datePublished'), 40),
    excerpt: clean(meta['og:description'] || meta['description'] || meta['twitter:description'], 400),
    image,
    canonical: canonical && canonicalKey(canonical) ? canonical : null,
    medium: !!medium,
    text,
    words,
  };
}
