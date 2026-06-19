-- Home page pinned posts. Apply after 0008_community_platform.sql.

ALTER TABLE hub_posts ADD COLUMN pinned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_hub_posts_pinned ON hub_posts(pinned_at);

UPDATE hub_posts
SET pinned_at = COALESCE(published_at, created_at)
WHERE slug = 'alternative-system'
  AND pinned_at IS NULL;
