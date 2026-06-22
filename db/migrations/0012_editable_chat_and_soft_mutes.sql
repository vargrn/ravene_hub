-- Editable community chat messages and softer moderation state.
-- Run once on production D1 before deploying this build.

ALTER TABLE community_chat_messages ADD COLUMN edited_at TEXT;
ALTER TABLE community_chat_messages ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE chat_moderation_queue ADD COLUMN queue_type TEXT NOT NULL DEFAULT 'new_message';
ALTER TABLE chat_moderation_queue ADD COLUMN source_message_id TEXT;
ALTER TABLE chat_moderation_queue ADD COLUMN previous_body TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_moderation_source ON chat_moderation_queue(source_message_id);
CREATE INDEX IF NOT EXISTS idx_chat_moderation_type_created ON chat_moderation_queue(queue_type, created_at);
