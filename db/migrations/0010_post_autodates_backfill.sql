-- Post date backfill. New post dates are written automatically by the Worker.
-- Apply after 0008/0009 on environments that already have post tables.

UPDATE hub_posts
SET created_at = COALESCE(created_at, published_at, updated_at, datetime('now'))
WHERE created_at IS NULL OR created_at = '';

UPDATE hub_posts
SET updated_at = COALESCE(updated_at, created_at, published_at, datetime('now'))
WHERE updated_at IS NULL OR updated_at = '';

UPDATE hub_posts
SET published_at = COALESCE(published_at, created_at, datetime('now'))
WHERE status = 'published'
  AND (published_at IS NULL OR published_at = '');
