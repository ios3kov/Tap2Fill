CREATE TABLE IF NOT EXISTS user_state (
  user_id TEXT PRIMARY KEY,
  last_page_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_progress (
  user_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  client_rev INTEGER NOT NULL,
  data_b64 TEXT NOT NULL,
  time_spent_sec INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, page_id)
);

CREATE TABLE IF NOT EXISTS rate_limit_window (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
