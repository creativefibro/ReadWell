// Turns a saved page into calm, safe article HTML. Runs in the browser, using the
// browser's own inert HTML parser (DOMParser never runs scripts or loads images)
// and Mozilla Readability (web/vendor). Shared by the app and the Vivaldi extension.

const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'FORM', 'INPUT', 'BUTTON',
  'SELECT', 'TEXTAREA', 'OPTION', 'SVG', 'MATH', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'BASE', 'CANVAS', 'VIDEO', 'AUDIO',
  'SOURCE', 'TRACK', 'MAP', 'AREA', 'DIALOG', 'HEAD', 'TITLE', 'NAV', 'ASIDE', 'FOOTER']);
const KEEP = new Set(['P', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'BLOCKQUOTE', 'Q', 'CITE', 'UL', 'OL', 'LI',
  'DL', 'DT', 'DD', 'PRE', 'CODE', 'KBD', 'SAMP', 'SUB', 'SUP', 'BR', 'HR', 'FIGURE', 'FIGCAPTION', 'IMG', 'TABLE', 'THEAD',
  'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'ABBR', 'MARK', 'SMALL', 'TIME', 'DEL', 'INS']);
const ATTRS = {A: ['href', 'title'], IMG: ['src', 'alt', 'width', 'height'], TH: ['colspan', 'rowspan', 'scope'], TD: ['colspan', 'rowspan'],
  TIME: ['datetime'], ABBR: ['title'], OL: ['start'], Q: ['cite'], BLOCKQUOTE: ['cite']};

function safeUrl(value, base, schemes) {
  try {
    const url = new URL(value.trim(), base);
    return schemes.includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function copy(node, doc, base) {
  if (node.nodeType === 3) return doc.createTextNode(node.nodeValue);
  if (node.nodeType !== 1) return null;
  const tag = node.tagName.toUpperCase();
  if (DROP.has(tag)) return null;
  const children = () => {
    const frag = doc.createDocumentFragment();
    for (const child of node.childNodes) { const c = copy(child, doc, base); if (c) frag.append(c); }
    return frag;
  };
  // Unknown or layout elements: keep their text, lose the element. Article headings become h2.
  const name = tag === 'H1' ? 'H2' : tag;
  if (!KEEP.has(name)) {
    const frag = children();
    if (['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'MAIN'].includes(tag) && frag.childNodes.length) {
      const p = doc.createElement('div');
      p.append(frag);
      return p;
    }
    return frag;
  }
  const el = doc.createElement(name.toLowerCase());
  for (const attr of ATTRS[name] || []) {
    let v = node.getAttribute(attr);
    if (v == null) continue;
    if (attr === 'href') { v = safeUrl(v, base, ['http:', 'https:', 'mailto:']); if (!v) continue; }
    if (attr === 'src' || attr === 'cite') { v = safeUrl(v, base, ['https:', 'http:']); if (!v) continue; }
    if (['width', 'height', 'colspan', 'rowspan', 'start'].includes(attr) && !/^\d{1,4}$/.test(v)) continue;
    el.setAttribute(attr, v.slice(0, 2000));
  }
  if (name === 'IMG') {
    if (!el.getAttribute('src')) {
      const lazy = node.getAttribute('data-src') || node.getAttribute('data-original') || (node.getAttribute('srcset') || '').split(/\s+/)[0];
      const src = lazy && safeUrl(lazy, base, ['https:', 'http:']);
      if (!src) return null;
      el.setAttribute('src', src);
    }
    el.setAttribute('loading', 'lazy');
    el.setAttribute('decoding', 'async');
    el.setAttribute('referrerpolicy', 'no-referrer');
    return el;
  }
  if (name === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
  el.append(children());
  return el;
}

// Allowlist sanitiser. Returns safe HTML; used before every display, not just on save.
export function sanitize(html, baseUrl) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const out = document.implementation.createHTMLDocument('');
  const box = out.createElement('div');
  for (const child of doc.body.childNodes) { const c = copy(child, out, baseUrl); if (c) box.append(c); }
  // Remove empty wrappers left behind by dropped elements.
  for (const el of [...box.querySelectorAll('div, p, span, li')].reverse()) {
    if (!el.textContent.trim() && !el.querySelector('img, br, hr')) el.remove();
  }
  return box.innerHTML;
}

export function textOf(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

// Raw page -> {contentHtml, text, byline, excerpt} or null when no article is found.
export function cleanArticle(rawHtml, pageUrl) {
  const Readability = globalThis.Readability;
  if (!Readability) throw new Error('Reader engine not loaded');
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const base = doc.createElement('base');
  base.href = pageUrl;
  doc.head?.prepend(base);
  let parsed = null;
  try { parsed = new Readability(doc, {charThreshold: 300, keepClasses: false}).parse(); } catch { parsed = null; }
  if (!parsed?.content) return null;
  const contentHtml = sanitize(parsed.content, pageUrl);
  const text = textOf(contentHtml);
  if (text.split(' ').length < 40) return null;
  return {contentHtml, text, byline: parsed.byline || null, excerpt: parsed.excerpt || null};
}
