# Ravene Hub account/community production layer

## Apply database migrations

Apply all migrations in `db/migrations` in order, including:

- `0008_community_platform.sql`
- `0009_home_pinned_posts.sql`

This adds profiles, roles, dynamic posts, media attachments, likes, account-embedded chat messages, moderation logs, and pinned home posts.

## Owner/admin setup

Set a Worker secret or environment variable:

```bash
ADMIN_EMAILS=owner@example.com
```

Any logged-in account with an email in `ADMIN_EMAILS` is treated as admin even before a `user_roles` row exists. Multiple emails can be comma-separated.

Alternative manual SQL after the user exists:

```sql
INSERT INTO user_roles (user_id, role, assigned_by, created_at, updated_at)
VALUES ('USER_ID', 'admin', NULL, datetime('now'), datetime('now'))
ON CONFLICT(user_id) DO UPDATE SET role = 'admin', updated_at = datetime('now');
```

## Roles

- `member`: profile, likes, comments, registered-user account chat.
- `moderator`: member tools plus comment/chat deletion.
- `admin`: moderator tools plus posts CRUD, pinned posts, media records, access levels, and role management.

## Posts and pinned cards

There is no separate Posts page. The home page loads the latest post, the full post list, and pinned sidebar cards from the posts API.

Admins can pin or unpin posts in Account → Posts admin panel. Pinned posts appear in the right-hand cards on the home page.

## Community chat

There is no separate Community page. The shared registered-user chat lives inside the Account page.

## Post media

The current deployment has no R2 binding. The admin panel accepts:

- static asset paths such as `assets/media/posts/file.webp`
- HTTPS media URLs

For true file upload from the browser, add an R2 binding and replace the URL-only media form with signed upload endpoints.
