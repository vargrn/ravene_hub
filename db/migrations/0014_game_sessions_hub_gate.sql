-- Clean Ravene Hub Early Access game gate sessions.
-- These sessions are created by Hub and checked by the game middleware.

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  build_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'hub',
  tier_at_issue INTEGER NOT NULL DEFAULT 0,
  access_expires_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  last_checked_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_user ON game_sessions(user_id, build_key, expires_at);
CREATE INDEX IF NOT EXISTS idx_game_sessions_token ON game_sessions(token_hash, build_key);
CREATE INDEX IF NOT EXISTS idx_game_sessions_expires ON game_sessions(expires_at);
