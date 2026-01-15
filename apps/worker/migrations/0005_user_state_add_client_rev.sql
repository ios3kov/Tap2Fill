-- 0005_user_state_add_client_rev.sql
-- Add idempotency field client_rev to user_state (monotonic).
-- Deterministic rebuild to avoid ALTER TABLE pitfalls on D1/SQLite.
-- Preserves existing data; initializes client_rev to 0 for existing rows.

PRAGMA foreign_keys=OFF;

-- Create desired schema (v3)
CREATE TABLE IF NOT EXISTS user_state_v3 (
  user_id      TEXT PRIMARY KEY,
  last_page_id TEXT,
  client_rev   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- Copy from existing user_state if it exists.
-- Existing rows have no client_rev -> initialize to 0.
INSERT INTO user_state_v3 (user_id, last_page_id, client_rev, updated_at)
SELECT
  user_id,
  last_page_id,
  0 AS client_rev,
  updated_at
FROM user_state
WHERE EXISTS (
  SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_state'
);

-- Swap
DROP TABLE IF EXISTS user_state;
ALTER TABLE user_state_v3 RENAME TO user_state;

PRAGMA foreign_keys=ON;