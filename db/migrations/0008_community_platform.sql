-- Production community layer: roles, profiles, dynamic posts, reactions, media, chat, and moderation ledger.
-- Apply after 0001-0007. It is additive and does not rewrite existing account or billing tables.

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  website_url TEXT,
  public_note TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('member', 'moderator', 'admin')),
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'hidden', 'deleted')),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'registered', 'tier1', 'tier2', 'tier3', 'moderator', 'admin')),
  category TEXT,
  cover_url TEXT,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS post_media (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES hub_posts(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'link')),
  url TEXT NOT NULL,
  title TEXT,
  caption TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL REFERENCES hub_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS moderation_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  raw_payload TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
CREATE INDEX IF NOT EXISTS idx_hub_posts_status_published ON hub_posts(status, published_at);
CREATE INDEX IF NOT EXISTS idx_hub_posts_visibility ON hub_posts(visibility);
CREATE INDEX IF NOT EXISTS idx_hub_posts_author ON hub_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_created ON community_chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_status_created ON community_chat_messages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_target ON moderation_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_moderation_logs_actor ON moderation_logs(actor_id, created_at);

INSERT OR IGNORE INTO hub_posts (
  id, slug, title, excerpt, body, status, visibility, category, cover_url, author_id, author_name, published_at, created_at, updated_at, deleted_at
) VALUES (
  'seed-alternative-system',
  'alternative-system',
  'Alternative system for Early Access verification',
  'Project updates, build notes, and access features are moving into the browser hub and Mini App infrastructure.',
  'I’ve created an alternative system for Early Access verification, project updates, build notes, and other features based on the BioPunk hub and Mini App infrastructure.\n\nThe browser version gives the project a proper large-screen place: posts can breathe, images are not trapped inside a tiny app shell, and materials can be grouped into member access without being buried in chat.\n\nFor now, the priority is simple: make the site the main public surface for the project, keep the Mini App as a companion layer, and move everything important into an interface that feels like it belongs to BioPunk.\n\nAnd now I’m going back to writing the continuation of the story.',
  'published',
  'public',
  'Development',
  'assets/media/posts/biopunk-duo.webp',
  NULL,
  'BioPunk: Phantasmagoria',
  '2026-05-22T06:01:00.000Z',
  '2026-05-22T06:01:00.000Z',
  '2026-05-22T06:01:00.000Z',
  NULL
);

INSERT OR IGNORE INTO post_media (id, post_id, media_type, url, title, caption, sort_order, created_at)
SELECT 'seed-alternative-system-cover', id, 'image', 'assets/media/posts/biopunk-duo.webp', 'BioPunk post artwork', '', 0, '2026-05-22T06:01:00.000Z'
FROM hub_posts
WHERE slug = 'alternative-system';
