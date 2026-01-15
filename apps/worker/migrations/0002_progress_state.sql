-- Tap2Fill D1 schema v0 (progress/state) — secure & minimal

PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS pages (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  regions_count INTEGER NOT NULL,
  palette_json  TEXT NOT NULL,
  svg_url       TEXT NOT NULL,
  thumb_url     TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS user_progress (
  user_id       INTEGER NOT NULL,
  page_id       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  client_rev    INTEGER NOT NULL,
  data_b64      TEXT NOT NULL,
  time_spent_sec INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, page_id),
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_state (
  user_id       INTEGER PRIMARY KEY,
  last_page_id  TEXT,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_user_progress_updated ON user_progress(updated_at);
