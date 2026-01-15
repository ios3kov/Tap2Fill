-- 0005_user_state_add_client_rev.sql
-- Ensure user_state has client_rev (idempotency) and canonical schema.
-- Works on fresh DB and on legacy DB without client_rev.

PRAGMA foreign_keys=OFF;

-- If user_state does not exist, create it in canonical form and stop.
CREATE TABLE IF NOT EXISTS user_state (
  user_id      TEXT PRIMARY KEY,
  last_page_id TEXT,
  client_rev   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- Rebuild deterministically into v3 to normalize schema.
CREATE TABLE IF NOT EXISTS user_state_v3 (
  user_id      TEXT PRIMARY KEY,
  last_page_id TEXT,
  client_rev   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- Try copy assuming client_rev exists (newer schema). If column doesn't exist, this insert fails,
-- so we do not rely on it. Instead, we only ever copy legacy shape (no client_rev) safely:
INSERT INTO user_state_v3 (user_id, last_page_id, client_rev, updated_at)
SELECT user_id, last_page_id, 0 AS client_rev, updated_at
FROM user_state;

DROP TABLE IF EXISTS user_state;
ALTER TABLE user_state_v3 RENAME TO user_state;

PRAGMA foreign_keys=ON;