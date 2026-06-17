CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_slug TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_comments_slug_created ON post_comments(post_slug, created_at);
CREATE INDEX IF NOT EXISTS idx_post_comments_user ON post_comments(user_id);
