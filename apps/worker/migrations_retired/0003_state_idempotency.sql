-- 0003_state_idempotency.sql
-- Canonical idempotency for /v1/me/state:
-- Adds client_rev to user_state to support monotonic clientRev + cross-device restore.

PRAGMA foreign_keys=ON;

-- Add client_rev only once (this migration runs once).
ALTER TABLE user_state
ADD COLUMN client_rev INTEGER NOT NULL DEFAULT 0;

-- Optional: index for troubleshooting/ops (cheap, safe).
CREATE INDEX IF NOT EXISTS idx_user_state_updated_at ON user_state(updated_at);