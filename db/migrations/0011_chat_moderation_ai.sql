-- AI-assisted community chat moderation and admin-only translation cache.
-- Adult fictional/game discussion is intentionally not filtered by topic; moderation is behavior-focused.

CREATE TABLE IF NOT EXISTS chat_moderation_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('quarantine', 'blocked')),
  reason TEXT,
  categories TEXT,
  provider TEXT,
  model TEXT,
  raw_payload TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_action TEXT CHECK (review_action IN ('approved', 'dismissed', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_chat_moderation_created ON chat_moderation_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_moderation_review ON chat_moderation_queue(review_action, created_at);

CREATE TABLE IF NOT EXISTS chat_user_moderation (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  strike_count INTEGER NOT NULL DEFAULT 0,
  muted_until TEXT,
  banned_at TEXT,
  ban_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_message_translations (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  source_table TEXT NOT NULL DEFAULT 'community_chat_messages' CHECK (source_table IN ('community_chat_messages', 'chat_moderation_queue')),
  target_language TEXT NOT NULL,
  translated_body TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(message_id, source_table, target_language)
);

CREATE INDEX IF NOT EXISTS idx_chat_translations_message ON chat_message_translations(message_id, source_table, target_language);
