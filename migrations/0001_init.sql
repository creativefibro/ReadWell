-- ReadWell schema. Migrations are immutable once installed on the Mac Studio.
CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,                     -- link as saved
  url_key TEXT NOT NULL,                 -- normalised saved link
  canonical_key TEXT NOT NULL,           -- normalised canonical link (page's own, or url_key)
  title TEXT NOT NULL,
  author TEXT,
  site TEXT,
  published TEXT,                        -- ISO date when known
  excerpt TEXT,
  image TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('reader', 'medium', 'original')),
  status TEXT NOT NULL DEFAULT 'queue' CHECK (status IN ('queue', 'finishing')),
  raw_html TEXT,                         -- page as fetched or sent; cleared once cleaned
  content_html TEXT,                     -- cleaned article for the Reader
  search_text TEXT NOT NULL DEFAULT '',
  words INTEGER,
  minutes INTEGER,
  fetch_error TEXT,
  position REAL NOT NULL DEFAULT 0 CHECK (position >= 0 AND position <= 1),
  opened_at TEXT,
  saved_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  added_by TEXT NOT NULL DEFAULT 'susan', -- 'susan' or an agent's name (future)
  source TEXT                            -- 'extension', 'shortcut', 'inbox', 'agent'
);
CREATE UNIQUE INDEX articles_canonical ON articles (canonical_key);
CREATE INDEX articles_url_key ON articles (url_key);
CREATE INDEX articles_saved ON articles (saved_at);

-- Survives deletion of the article: powers History, ratings and Reading Insights.
CREATE TABLE history (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  site TEXT,
  kind TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  highlight_count INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL CHECK (outcome IN ('deleted', 'obsidian', 'capacities', 'anybox', 'expired')),
  added_by TEXT NOT NULL DEFAULT 'susan'
);
CREATE INDEX history_canonical ON history (canonical_key);
CREATE INDEX history_finished ON history (finished_at);

-- One row per day Susan opened something. Binary; no durations are recorded.
CREATE TABLE reading_days (day TEXT PRIMARY KEY);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
