# ReadWell

A calm, personal read-it-later web app for Susan: save articles from anywhere, find
something to read quickly, read and highlight comfortably on Mac, iPhone and iPad,
then decide what each finished article becomes.

## Replaces
Saving articles into Web Highlights / Anybox and losing track of them. Not a
replacement for Anybox (bookmarks), Web Highlights (research and Medium highlights),
Obsidian or Capacities (knowledge).

## Main jobs
1. Save an article (Vivaldi extension on Mac; "Save to ReadWell" Shortcut on iPhone/iPad).
2. Choose something to read: oldest, newest, length, Lucky Dip, search, Continue Reading.
3. Read in a calm reader, online or offline, with colour highlights and notes.
4. Finish: optional 1 to 5 stars, then export (Obsidian, Capacities), archive (Anybox) or delete.

## Data
- Article: id, url, canonical url, title, author, site/publication, published date,
  saved date, reading length, kind (reader | link-only e.g. Medium), content HTML,
  status (queue | reading | finishing | done), position, offline flag, added_by (susan | agent name).
- Highlight: id, article, colour, quote, prefix, suffix, note, created, updated.
- Tag: name; ArticleTag link.
- ExportJob: article, target (obsidian | capacities | anybox | delete), state, attempts, last error.
- HistoryEntry (survives deletion): title, author, site, url, finished date, rating,
  highlight count, outcome, added_by.
- ReadingDay: date (binary heatmap; no durations recorded).
- Device and capture tokens.

## Shape
Responsive installable web app (PWA) at readwell.susanpearson.uk, following
Flourish's production pattern: Node 24 and SQLite on Susan's Mac Studio, published
through a Cloudflare Tunnel and protected by Cloudflare Access (Free plan).
One central database; each device keeps an offline copy of saved articles and a
queue of unsent changes. £0 additional cost. Separate app, database, tunnel,
Access application, LaunchAgents and backups from Flourish.

## System hooks
- Vivaldi (Chromium) extension, loaded unpacked.
- Apple Shortcut "Save to ReadWell" in the Share Sheet; iCloud Drive fallback when the Mac is unreachable.
- Server-side on the Mac: Obsidian vault writes, Anybox local API, Capacities API 2.0.
- Encrypted iCloud backups (Flourish pattern). Future: scoped agent API / MCP (not built now).

## Reference
Flourish (hosting, Access, installer, backups). Web Highlights for what to avoid: busy dashboard, repeated sign-in.

## Look
From Susan's ReadWell icon (`design/readwell-logo-source.png`): soft lavender `#DDC9FD`
and violet `#8951EE`. Writing is neutral (`#333333` on a faint lavender-white page;
`#E6E6E6` on deep aubergine in dark mode). Violet is kept for actions, links and
Continue Reading; small violet text uses `#6B3BCB` for contrast. Book typeface for
reading, system sans for controls. Calm, welcoming, modern but not clinical.

## Not in version one
- Medium content extraction or Medium highlights (Medium app and Web Highlights handle these).
- AI or agent integration, or an in-app chat.
- Native apps, Krystal hosting, reading-time tracking, streaks, badges or targets.
