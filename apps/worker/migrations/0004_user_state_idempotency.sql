-- 0004_user_state_idempotency.sql
-- Idempotency support for user_state: add client_rev (monotonic).
-- Robust approach: rebuild table to avoid ALTER TABLE edge-cases on D1/SQLite.
-- Safe to run when user_state exists; safe-ish if it doesn't (will still create final table).

PRAGMA foreign_keys=OFF;

-- 1) Create v2 table with the desired schema
CREATE TABLE IF NOT EXISTS user_state_v2 (
  user_id      TEXT PRIMARY KEY,
  last_page_id TEXT,
  client_rev   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- 2) Copy data from existing user_state if it exists.
-- Old schema may not have client_rev; we initialize it to 0.
INSERT INTO user_state_v2 (user_id, last_page_id, client_rev, updated_at)
SELECT
  user_id,
  last_page_id,
  0 AS client_rev,
  updated_at
FROM user_state
WHERE EXISTS (
  SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_state'
);

-- 3) Swap tables
DROP TABLE IF EXISTS user_state;
ALTER TABLE user_state_v2 RENAME TO user_state;

PRAGMA foreign_keys=ON;