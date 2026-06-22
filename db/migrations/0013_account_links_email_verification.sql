-- External account linking and email-code registration verification.
-- Apply after 0012 before deploying the account links build.

ALTER TABLE users ADD COLUMN email_verified_at TEXT;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  password_algorithm TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  last_sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_verification_email ON email_verification_codes(email_normalized, consumed_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_code ON email_verification_codes(code_hash);

CREATE TABLE IF NOT EXISTS oauth_link_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'x')),
  state_hash TEXT NOT NULL UNIQUE,
  code_verifier TEXT NOT NULL,
  redirect_after TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_oauth_link_states_user ON oauth_link_states(user_id, provider, expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_link_states_state ON oauth_link_states(state_hash, provider);
