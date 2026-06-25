var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _worker.js
var SESSION_COOKIE = "rh_session";
var SESSION_DAYS = 30;
var SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;
var BUILD_SESSION_MINUTES = 10;
var GAME_COOKIE_HOURS = 12;
var PASSWORD_ITERATIONS = 6e4;
var PASSWORD_ALGORITHM = "pbkdf2-sha256";
var EMAIL_VERIFICATION_MINUTES = 15;
var EMAIL_VERIFICATION_RESEND_SECONDS = 60;
var EMAIL_VERIFICATION_MAX_ATTEMPTS = 6;
var OAUTH_STATE_MINUTES = 15;
var TELEGRAM_AUTH_MAX_AGE_SECONDS = 86400;
var MOONPAY_SUBSCRIPTION_DAYS_FALLBACK = 32;
var MOONPAY_ALLOWED_MODES = /* @__PURE__ */ new Set(["test", "live"]);
var MOONPAY_WIDGET_SCRIPT_URL = "https://embed.hel.io/assets/index-v1.js";
var DEFAULT_PUBLIC_POST_SLUG = "alternative-system-for-early-access-verification";
var LEGACY_PUBLIC_POST_SLUG = "alternative-system";
var SHARE_PREVIEW_IMAGE = "/assets/media/posts/share-preview.jpg";
var SHARE_PREVIEW_TITLE = "Alternative system for Early Access verification";
var SHARE_PREVIEW_DESCRIPTION = "I\u2019ve created an alternative system for Early Access verification, support tiers with crypto payments, a news feed, and other features based on a Telegram Mini App.";
var jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};
var worker_default = {
  async fetch(request, env, ctx) {
    void ctx;
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    if (request.method === "GET" && isShareablePostPage(url)) {
      const postPageResponse = await serveShareablePostPage(request, env, url);
      if (postPageResponse) return postPageResponse;
    }
    if (env.ASSETS?.fetch) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return withSecurityHeaders(assetResponse);
      }
    }
    return new Response("Not found", { status: 404 });
  }
};
function isShareablePostPage(url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return path === "/post-alternative-system.html" || /^\/post\/[^/]+$/i.test(path);
}
__name(isShareablePostPage, "isShareablePostPage");
function postSlugFromPageURL(url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const pathMatch = path.match(/^\/post\/([^/?#]+)$/i);
  if (pathMatch) return cleanPostSlug(decodeURIComponent(pathMatch[1] || "")) || DEFAULT_PUBLIC_POST_SLUG;
  return cleanPostSlug(url.searchParams.get("post")) || DEFAULT_PUBLIC_POST_SLUG;
}
__name(postSlugFromPageURL, "postSlugFromPageURL");
function canonicalPostSlug(value) {
  const slug = cleanPostSlug(value) || DEFAULT_PUBLIC_POST_SLUG;
  return slug === LEGACY_PUBLIC_POST_SLUG ? DEFAULT_PUBLIC_POST_SLUG : slug;
}
__name(canonicalPostSlug, "canonicalPostSlug");
function postLookupSlugs(value) {
  const clean = cleanPostSlug(value) || DEFAULT_PUBLIC_POST_SLUG;
  const canonical = canonicalPostSlug(clean);
  const slugs = /* @__PURE__ */ new Set([canonical, clean]);
  if (canonical === DEFAULT_PUBLIC_POST_SLUG || clean === LEGACY_PUBLIC_POST_SLUG) {
    slugs.add(LEGACY_PUBLIC_POST_SLUG);
    slugs.add(DEFAULT_PUBLIC_POST_SLUG);
  }
  return [...slugs].filter(Boolean);
}
__name(postLookupSlugs, "postLookupSlugs");
async function serveShareablePostPage(request, env, url) {
  if (!env.ASSETS?.fetch) return null;
  const requestedSlug = postSlugFromPageURL(url);
  const shellUrl = new URL("/post-alternative-system.html", url.origin);
  const shellResponse = await env.ASSETS.fetch(new Request(shellUrl.toString(), request));
  if (shellResponse.status === 404) return null;
  const preview = await loadSharePostPreview(env, requestedSlug, url.origin);
  const shell = await shellResponse.text();
  const html = injectSharePreviewMeta(shell, preview, requestedSlug);
  const headers = new Headers(shellResponse.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "public, max-age=60, s-maxage=60");
  return withSecurityHeaders(new Response(html, { status: 200, headers }));
}
__name(serveShareablePostPage, "serveShareablePostPage");
async function loadSharePostPreview(env, slug, origin) {
  const fallback = fallbackSharePostPreview(slug, origin);
  if (!env.DB) return fallback;
  try {
    await ensurePostSchema(env);
    let row = null;
    for (const candidate of postLookupSlugs(slug)) {
      row = await env.DB.prepare(
        `SELECT * FROM hub_posts WHERE slug = ? AND deleted_at IS NULL LIMIT 1`
      ).bind(candidate).first();
      if (row) break;
    }
    if (!row || row.status !== "published") return fallback;
    const canonicalUrl = absoluteShareUrl(`/post/${encodeURIComponent(canonicalPostSlug(row.slug || slug))}`, origin);
    if (row.visibility !== "public") {
      return {
        ...fallback,
        title: `${row.title || "Member post"} \xB7 Ravene Hub`,
        description: "This Ravene Hub post requires an account or active membership to read.",
        image: sharePreviewImage(row.cover_url, origin),
        canonicalUrl,
        visibility: row.visibility || "registered"
      };
    }
    const mediaRows = await env.DB.prepare(
      "SELECT media_type, url FROM post_media WHERE post_id = ? ORDER BY sort_order ASC, created_at ASC"
    ).bind(row.id).all();
    const imageSource = row.cover_url || firstMediaUrl(mediaRows.results, "image") || SHARE_PREVIEW_IMAGE;
    return {
      title: row.title || fallback.title,
      description: shareDescription(row.excerpt || row.body || fallback.description),
      image: sharePreviewImage(imageSource, origin),
      canonicalUrl,
      authorName: row.author_name || "Ravene",
      category: row.category || "Development",
      publishedAt: row.published_at || row.created_at || "",
      updatedAt: row.updated_at || "",
      visibility: "public"
    };
  } catch {
    return fallback;
  }
}
__name(loadSharePostPreview, "loadSharePostPreview");
function fallbackSharePostPreview(slug, origin) {
  const canonicalSlug = canonicalPostSlug(slug);
  const isDefault = canonicalSlug === DEFAULT_PUBLIC_POST_SLUG;
  const title = isDefault ? SHARE_PREVIEW_TITLE : "Ravene Hub post";
  const description = isDefault ? SHARE_PREVIEW_DESCRIPTION : "A Ravene Hub post from BioPunk: Phantasmagoria.";
  return {
    title,
    description,
    image: absoluteShareUrl(SHARE_PREVIEW_IMAGE, origin),
    canonicalUrl: absoluteShareUrl(`/post/${encodeURIComponent(canonicalSlug)}`, origin),
    authorName: "Ravene",
    category: "Development",
    publishedAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "",
    visibility: "public"
  };
}
__name(fallbackSharePostPreview, "fallbackSharePostPreview");
function sharePreviewImage(value, origin) {
  const text = String(value || "").trim();
  if (!text || /(^|\/)biopunk-duo\.webp(\?|#|$)/i.test(text)) {
    return absoluteShareUrl(SHARE_PREVIEW_IMAGE, origin);
  }
  return absoluteShareUrl(text, origin) || absoluteShareUrl(SHARE_PREVIEW_IMAGE, origin);
}
__name(sharePreviewImage, "sharePreviewImage");
function injectSharePreviewMeta(shell, preview, slug) {
  const title = preview.title || "Ravene Hub post";
  const description = shareDescription(preview.description || "Ravene Hub post from BioPunk: Phantasmagoria.");
  const canonicalUrl = preview.canonicalUrl || "";
  const image = preview.image || "";
  const meta = `<!-- share-preview-meta:start -->
  <meta name="description" content="${escapeHtmlAttribute(description)}" />
  <link rel="canonical" href="${escapeHtmlAttribute(canonicalUrl)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta property="og:site_name" content="Ravene Hub" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeHtmlAttribute(title)}" />
  <meta property="og:description" content="${escapeHtmlAttribute(description)}" />
  <meta property="og:url" content="${escapeHtmlAttribute(canonicalUrl)}" />
  <meta property="og:image" content="${escapeHtmlAttribute(image)}" />
  <meta property="og:image:secure_url" content="${escapeHtmlAttribute(image)}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${escapeHtmlAttribute(title)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtmlAttribute(title)}" />
  <meta name="twitter:description" content="${escapeHtmlAttribute(description)}" />
  <meta name="twitter:image" content="${escapeHtmlAttribute(image)}" />
  ${preview.publishedAt ? `<meta property="article:published_time" content="${escapeHtmlAttribute(preview.publishedAt)}" />` : ""}
  ${preview.updatedAt ? `<meta property="article:modified_time" content="${escapeHtmlAttribute(preview.updatedAt)}" />` : ""}
  ${preview.authorName ? `<meta property="article:author" content="${escapeHtmlAttribute(preview.authorName)}" />` : ""}
  ${preview.category ? `<meta property="article:section" content="${escapeHtmlAttribute(preview.category)}" />` : ""}
  <!-- share-preview-meta:end -->`;
  let next = shell.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtmlText(title)} \xB7 Ravene Hub</title>`);
  if (!/<base\s+href=/i.test(next)) {
    next = next.replace(/<meta name="viewport"[^>]*>\s*/i, (match) => `${match}
  <base href="/" />
  `);
  }
  if (/<!-- share-preview-meta:start -->[\s\S]*?<!-- share-preview-meta:end -->/i.test(next)) {
    next = next.replace(/<!-- share-preview-meta:start -->[\s\S]*?<!-- share-preview-meta:end -->/i, meta);
  } else {
    next = next.replace(/<title>[\s\S]*?<\/title>/i, (match) => `${match}
  ${meta}`);
  }
  next = next.replace(/data-post-slug="[^"]*"/i, `data-post-slug="${escapeHtmlAttribute(slug || DEFAULT_PUBLIC_POST_SLUG)}"`);
  return next;
}
__name(injectSharePreviewMeta, "injectSharePreviewMeta");
function absoluteShareUrl(value, origin) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return new URL(text, origin.endsWith("/") ? origin : `${origin}/`).toString();
  } catch {
    return "";
  }
}
__name(absoluteShareUrl, "absoluteShareUrl");
function shareDescription(value) {
  const text = String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "Ravene Hub post from BioPunk: Phantasmagoria.";
  return text.length > 240 ? `${text.slice(0, 237).trim()}...` : text;
}
__name(shareDescription, "shareDescription");
function escapeHtmlText(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
__name(escapeHtmlText, "escapeHtmlText");
function escapeHtmlAttribute(value) {
  return escapeHtmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
__name(escapeHtmlAttribute, "escapeHtmlAttribute");
async function handleApi(request, env, url) {
  try {
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, db: Boolean(env.DB) });
    }
    if (url.pathname === "/api/me" && request.method === "GET") {
      const account = await currentAccount(request, env);
      return json(account);
    }
    if (url.pathname === "/api/account/profile" && request.method === "GET") {
      return getAccountProfile(request, env);
    }
    if (url.pathname === "/api/account/profile" && request.method === "PUT") {
      return updateAccountProfile(request, env);
    }
    if (url.pathname === "/api/account/links/config" && request.method === "GET") {
      return accountLinksConfig(request, env);
    }
    if (url.pathname.startsWith("/api/account/link/")) {
      return handleAccountLinkApi(request, env, url);
    }
    if (url.pathname === "/api/posts" || url.pathname.startsWith("/api/posts/")) {
      return handlePostsApi(request, env, url);
    }
    if (url.pathname === "/api/community/chat" || url.pathname.startsWith("/api/community/chat/")) {
      return handleCommunityChatApi(request, env, url);
    }
    if (url.pathname === "/api/admin/chat" || url.pathname.startsWith("/api/admin/chat/")) {
      return handleAdminChatApi(request, env, url);
    }
    if (url.pathname === "/api/admin/users" || url.pathname.startsWith("/api/admin/users/")) {
      return handleAdminUsersApi(request, env, url);
    }
    if (url.pathname === "/api/post-comments" && request.method === "GET") {
      return listPostComments(request, env, url);
    }
    if (url.pathname === "/api/post-comments" && request.method === "POST") {
      return createPostComment(request, env);
    }
    if (url.pathname.startsWith("/api/post-comments/") && request.method === "DELETE") {
      return deletePostComment(request, env, url);
    }
    if (url.pathname === "/api/auth/login-code" && request.method === "POST") {
      return consumeLoginCode(request, env);
    }
    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      return registerWithPassword(request, env);
    }
    if (url.pathname === "/api/auth/register/verify" && request.method === "POST") {
      return verifyRegistrationCode(request, env);
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return loginWithPassword(request, env);
    }
    if (url.pathname === "/api/auth/dev-session" && request.method === "POST") {
      return createDevSession(request, env);
    }
    if (url.pathname === "/api/logout" && request.method === "POST") {
      return logout(request, env);
    }
    if (url.pathname === "/api/moonpay/config" && request.method === "GET") {
      return moonPayPublicConfig(request, env);
    }
    if (url.pathname === "/api/moonpay/checkout/session" && request.method === "POST") {
      return createMoonPayCheckoutSession(request, env);
    }
    if (url.pathname === "/api/moonpay/downgrade/cancel" && request.method === "POST") {
      return cancelScheduledMoonPayDowngrade(request, env);
    }
    if (url.pathname === "/api/subscription/cancel-renewal" && request.method === "POST") {
      return cancelSubscriptionRenewal(request, env);
    }
    if (url.pathname === "/api/subscription/resume-renewal" && request.method === "POST") {
      return resumeSubscriptionRenewal(request, env);
    }
    if ((url.pathname === "/api/moonpay/webhook" || url.pathname === "/api/helio/webhook") && request.method === "POST") {
      return handleMoonPayWebhook(request, env);
    }
    if (url.pathname === "/api/builds/current/launch" && request.method === "POST") {
      return createBuildLaunch(request, env);
    }
    if (url.pathname === "/api/game-session/check" && request.method === "POST") {
      return checkGameSession(request, env);
    }
    if (url.pathname === "/api/game-session/access-check" && request.method === "POST") {
      return checkGameAccess(request, env);
    }
    return json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return json(
        { error: "Database migration is missing. Apply the SQL migrations from db/migrations before using accounts and billing." },
        { status: 503 }
      );
    }
    return json(
      { error: "Server error", detail: env.DEBUG_ERRORS === "1" ? String(error?.message || error) : void 0 },
      { status: 500 }
    );
  }
}
__name(handleApi, "handleApi");
async function currentAccount(request, env) {
  if (!env.DB) {
    return {
      authenticated: false,
      setupRequired: true,
      user: null,
      subscription: emptySubscription(),
      identities: [],
      role: "guest",
      permissions: permissionsForRole("guest", false),
      profile: emptyProfile(),
      stats: emptyAccountStats()
    };
  }
  const workspaceUser = env.ENABLE_WORKSPACE_AUTH === "1" ? await workspaceIdentity(request, env) : null;
  const sessionUser = workspaceUser || await sessionIdentity(request, env);
  if (!sessionUser) {
    return {
      authenticated: false,
      setupRequired: false,
      user: null,
      subscription: emptySubscription(),
      identities: [],
      role: "guest",
      permissions: permissionsForRole("guest", false),
      profile: emptyProfile(),
      stats: emptyAccountStats()
    };
  }
  const [subscription, identities, role, profile, stats] = await Promise.all([
    activeSubscription(env, sessionUser.id),
    env.DB.prepare(
      "SELECT provider, provider_user_id, provider_username FROM user_identities WHERE user_id = ? ORDER BY created_at DESC"
    ).bind(sessionUser.id).all(),
    accountRole(env, sessionUser),
    accountProfile(env, sessionUser.id),
    accountStats(env, sessionUser.id)
  ]);
  const permissions = permissionsForRole(role, true);
  return {
    authenticated: true,
    setupRequired: false,
    user: {
      id: sessionUser.id,
      email: sessionUser.email,
      displayName: sessionUser.display_name || sessionUser.email || "Ravene Hub user",
      avatarUrl: sessionUser.avatar_url,
      emailVerifiedAt: sessionUser.email_verified_at || null,
      createdAt: sessionUser.created_at || null,
      role
    },
    role,
    permissions,
    profile,
    stats,
    subscription,
    identities: identities.results || []
  };
}
__name(currentAccount, "currentAccount");
async function sessionIdentity(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const row = await env.DB.prepare(
    `SELECT users.*
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?
     LIMIT 1`
  ).bind(tokenHash, now).first();
  if (row) {
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
  }
  return row;
}
__name(sessionIdentity, "sessionIdentity");
async function workspaceIdentity(request, env) {
  const email = request.headers.get("oai-authenticated-user-email");
  if (!email) return null;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  const displayName = encoding === "percent-encoded-utf-8" && encodedName ? decodeURIComponent(encodedName) : email;
  const user = await upsertUser(env, { email, displayName });
  await upsertIdentity(env, user.id, {
    provider: "workspace",
    providerUserId: email,
    providerUsername: email
  });
  return user;
}
__name(workspaceIdentity, "workspaceIdentity");
async function consumeLoginCode(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const body = await readJson(request);
  const code = normalizeCode(body.code);
  if (!code) return json({ error: "Enter the code from the bot" }, { status: 400 });
  const codeHash = await sha256(code);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const loginCode = await env.DB.prepare(
    "SELECT * FROM login_codes WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1"
  ).bind(codeHash, now).first();
  if (!loginCode) return json({ error: "Code is wrong or expired" }, { status: 401 });
  let user = loginCode.user_id ? await env.DB.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(loginCode.user_id).first() : null;
  if (!user) {
    user = await upsertUser(env, {
      displayName: loginCode.telegram_username ? `@${loginCode.telegram_username}` : "Telegram user"
    });
  }
  if (loginCode.telegram_id) {
    await upsertIdentity(env, user.id, {
      provider: "telegram",
      providerUserId: loginCode.telegram_id,
      providerUsername: loginCode.telegram_username
    });
  }
  await env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE id = ?").bind(now, loginCode.id).run();
  return createSessionResponse(request, env, user);
}
__name(consumeLoginCode, "consumeLoginCode");
async function registerWithPassword(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const requestedDisplayName = cleanDisplayName(body.displayName);
  const fallbackDisplayName = safeFallbackDisplayName(email);
  const displayName = requestedDisplayName || fallbackDisplayName;
  const displayNameError = reservedDisplayNameReason(displayName);
  if (displayNameError) return json({ error: displayNameError }, { status: 400 });
  const validationError = validateEmailPassword(email, password);
  if (validationError) return json({ error: validationError }, { status: 400 });
  const existingCredential = await env.DB.prepare(
    "SELECT id FROM user_credentials WHERE email_normalized = ? LIMIT 1"
  ).bind(email).first();
  if (existingCredential) return json({ error: "Email is already registered" }, { status: 409 });
  const existingUser = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").bind(email).first();
  if (existingUser) return json({ error: "Email is already attached to another account" }, { status: 409 });
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const verificationRequired = env.EMAIL_VERIFICATION_REQUIRED === "1";
  if (!verificationRequired) {
    const passwordRecord2 = await hashPassword(password);
    const user = {
      id: randomId(),
      email,
      display_name: displayName,
      avatar_url: null,
      created_at: nowIso,
      updated_at: nowIso,
      email_verified_at: null
    };
    const identityId = randomId();
    const credentialId = randomId();
    const insertIdentity = env.DB.prepare(
      "INSERT INTO user_identities (id, user_id, provider, provider_user_id, provider_username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(identityId, user.id, "email", email, email, nowIso, nowIso);
    const insertCredential = env.DB.prepare(
      `INSERT INTO user_credentials
        (id, user_id, email, email_normalized, password_hash, password_salt, password_iterations, password_algorithm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      credentialId,
      user.id,
      email,
      email,
      passwordRecord2.hash,
      passwordRecord2.salt,
      passwordRecord2.iterations,
      passwordRecord2.algorithm,
      nowIso,
      nowIso
    );
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(user.id, user.email, user.display_name, user.avatar_url, user.created_at, user.updated_at, user.email_verified_at),
        insertIdentity,
        insertCredential
      ]);
    } catch (error) {
      if (!isMissingSchemaError(error, ["users"])) throw error;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(user.id, user.email, user.display_name, user.avatar_url, user.created_at, user.updated_at),
        env.DB.prepare(
          "INSERT INTO user_identities (id, user_id, provider, provider_user_id, provider_username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(identityId, user.id, "email", email, email, nowIso, nowIso),
        env.DB.prepare(
          `INSERT INTO user_credentials
            (id, user_id, email, email_normalized, password_hash, password_salt, password_iterations, password_algorithm, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          credentialId,
          user.id,
          email,
          email,
          passwordRecord2.hash,
          passwordRecord2.salt,
          passwordRecord2.iterations,
          passwordRecord2.algorithm,
          nowIso,
          nowIso
        )
      ]);
    }
    return createSessionResponse(request, env, user);
  }
  const existingPending = await env.DB.prepare(
    "SELECT last_sent_at FROM email_verification_codes WHERE email_normalized = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
  ).bind(email, nowIso).first().catch((error) => {
    if (isMissingSchemaError(error, ["email_verification_codes"])) return null;
    throw error;
  });
  if (existingPending?.last_sent_at) {
    const lastSent = new Date(existingPending.last_sent_at).getTime();
    if (Number.isFinite(lastSent) && Date.now() - lastSent < EMAIL_VERIFICATION_RESEND_SECONDS * 1e3) {
      return json({ error: "Verification code was sent recently. Wait a minute before requesting another one." }, { status: 429 });
    }
  }
  const passwordRecord = await hashPassword(password);
  const code = randomNumericCode(6);
  const codeHash = await sha256(`${email}:${code}`);
  const expiresAt = addMinutes(now, EMAIL_VERIFICATION_MINUTES).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM email_verification_codes WHERE email_normalized = ? AND consumed_at IS NULL").bind(email),
    env.DB.prepare(
      `INSERT INTO email_verification_codes
        (id, email, email_normalized, display_name, password_hash, password_salt, password_iterations, password_algorithm, code_hash, attempts, created_at, expires_at, consumed_at, last_sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)`
    ).bind(
      randomId(),
      email,
      email,
      displayName,
      passwordRecord.hash,
      passwordRecord.salt,
      passwordRecord.iterations,
      passwordRecord.algorithm,
      codeHash,
      nowIso,
      expiresAt,
      nowIso
    )
  ]);
  const delivery = await sendVerificationEmail(env, { email, displayName, code, expiresAt });
  if (!delivery.ok) {
    return json({ error: delivery.error || "Email delivery is not configured yet." }, { status: 503 });
  }
  return json({
    ok: true,
    pendingVerification: true,
    email,
    expiresAt,
    devCode: delivery.devCode || void 0,
    message: "Verification code sent. Check your email."
  });
}
__name(registerWithPassword, "registerWithPassword");
async function verifyRegistrationCode(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const code = normalizeCode(body.code);
  if (!email || !code) return json({ error: "Enter email and verification code" }, { status: 400 });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const pending = await env.DB.prepare(
    "SELECT * FROM email_verification_codes WHERE email_normalized = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
  ).bind(email, now).first();
  if (!pending) return json({ error: "Verification code is wrong or expired" }, { status: 401 });
  if (Number(pending.attempts || 0) >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
    return json({ error: "Too many verification attempts. Request a new code." }, { status: 429 });
  }
  const codeHash = await sha256(`${email}:${code}`);
  if (codeHash !== pending.code_hash) {
    await env.DB.prepare("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?").bind(pending.id).run();
    return json({ error: "Verification code is wrong or expired" }, { status: 401 });
  }
  const existingCredential = await env.DB.prepare(
    "SELECT id FROM user_credentials WHERE email_normalized = ? LIMIT 1"
  ).bind(email).first();
  if (existingCredential) return json({ error: "Email is already registered" }, { status: 409 });
  const existingUser = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").bind(email).first();
  if (existingUser) return json({ error: "Email is already attached to another account" }, { status: 409 });
  const user = {
    id: randomId(),
    email,
    display_name: cleanDisplayName(pending.display_name) || email.split("@")[0],
    avatar_url: null,
    created_at: now,
    updated_at: now,
    email_verified_at: now
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(user.id, user.email, user.display_name, user.avatar_url, user.created_at, user.updated_at, user.email_verified_at),
    env.DB.prepare(
      "INSERT INTO user_identities (id, user_id, provider, provider_user_id, provider_username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(randomId(), user.id, "email", email, email, now, now),
    env.DB.prepare(
      `INSERT INTO user_credentials
        (id, user_id, email, email_normalized, password_hash, password_salt, password_iterations, password_algorithm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      randomId(),
      user.id,
      email,
      email,
      pending.password_hash,
      pending.password_salt,
      Number(pending.password_iterations || PASSWORD_ITERATIONS),
      pending.password_algorithm || PASSWORD_ALGORITHM,
      now,
      now
    ),
    env.DB.prepare("UPDATE email_verification_codes SET consumed_at = ? WHERE id = ?").bind(now, pending.id)
  ]);
  return createSessionResponse(request, env, user);
}
__name(verifyRegistrationCode, "verifyRegistrationCode");
async function loginWithPassword(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!email || !password) return json({ error: "Enter email and password" }, { status: 400 });
  const credential = await env.DB.prepare(
    `SELECT user_credentials.*, users.email AS user_email, users.display_name, users.avatar_url, users.created_at, users.updated_at
     FROM user_credentials
     JOIN users ON users.id = user_credentials.user_id
     WHERE user_credentials.email_normalized = ?
     LIMIT 1`
  ).bind(email).first();
  if (!credential) return json({ error: "Email or password is wrong" }, { status: 401 });
  const ok = await verifyPassword(password, credential);
  if (!ok) return json({ error: "Email or password is wrong" }, { status: 401 });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare("UPDATE user_credentials SET last_login_at = ?, updated_at = ? WHERE id = ?").bind(now, now, credential.id).run();
  return createSessionResponse(request, env, {
    id: credential.user_id,
    email: credential.user_email,
    display_name: credential.display_name,
    avatar_url: credential.avatar_url,
    created_at: credential.created_at,
    updated_at: credential.updated_at
  });
}
__name(loginWithPassword, "loginWithPassword");
async function createDevSession(request, env) {
  if (env.DEV_LOGIN_ENABLED !== "1") {
    return json({ error: "Developer login is disabled" }, { status: 404 });
  }
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const body = await readJson(request);
  const user = await upsertUser(env, {
    email: body.email || "dev@ravene.local",
    displayName: body.displayName || "Ravene"
  });
  return createSessionResponse(request, env, user);
}
__name(createDevSession, "createDevSession");
async function createBuildLaunch(request, env) {
  const baseUrl = cleanExternalUrl(env.EA_HUB_GAME_URL || env.CURRENT_BUILD_URL || "");
  if (!baseUrl) return json({ error: "EA game URL is not connected yet" }, { status: 503 });
  if (!env.DB) {
    return json({ buildKey: "current-ea", launchUrl: baseUrl, fallback: true });
  }
  const account = await currentAccount(request, env);
  if (!account.authenticated) {
    return json({ buildKey: "current-ea", launchUrl: baseUrl, fallback: true, reason: "not_authenticated" });
  }
  const buildKey = cleanGameBuildKey("current-ea");
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = /* @__PURE__ */ new Date();
  const expiresAt = addMinutes(now, BUILD_SESSION_MINUTES).toISOString();
  let access = emptySubscription();
  try {
    access = await gameAccessForUser(env, account.user.id);
    await env.DB.prepare(
      `INSERT INTO game_sessions
        (id, user_id, build_key, token_hash, source, tier_at_issue, access_expires_at, created_at, expires_at, consumed_at, last_checked_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
    ).bind(
      randomId(),
      account.user.id,
      buildKey,
      tokenHash,
      access.source || "hub",
      Number(access.tier || 0),
      access.expiresAt || null,
      now.toISOString(),
      expiresAt
    ).run();
  } catch (error) {
    console.error("Could not create game session", error);
    return json({ buildKey, launchUrl: baseUrl, fallback: true, reason: "session_create_failed" });
  }
  return json({
    buildKey,
    hubSession: token,
    expiresAt,
    launchUrl: `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}hub_session=${encodeURIComponent(token)}`
  });
}
__name(createBuildLaunch, "createBuildLaunch");
async function checkGameSession(request, env) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured yet" }, { status: 503 });
  const secretError = requireGameGateSecret(request, env);
  if (secretError) return secretError;
  const body = await readJson(request);
  const token = String(body.hubSession || body.sessionToken || body.token || "").trim();
  const buildKey = cleanGameBuildKey(body.buildKey || "current-ea");
  if (!token) return json({ ok: false, error: "Missing hub_session" }, { status: 400 });
  const tokenHash = await sha256(token);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const row = await env.DB.prepare(
    `SELECT id, user_id, build_key, source, tier_at_issue, access_expires_at, expires_at, consumed_at, revoked_at
     FROM game_sessions
     WHERE token_hash = ? AND build_key = ? LIMIT 1`
  ).bind(tokenHash, buildKey).first();
  if (!row || row.revoked_at) return json({ ok: false, error: "Game session was not found" }, { status: 404 });
  if (row.expires_at <= now) return json({ ok: false, error: "Game session expired" }, { status: 401 });
  if (row.consumed_at) return json({ ok: false, error: "Game session was already used" }, { status: 409 });
  const access = await gameAccessForUser(env, row.user_id);
  if (!access.active) return json({ ok: false, error: "Early Access is not active", access }, { status: 403 });
  await env.DB.prepare("UPDATE game_sessions SET consumed_at = ?, last_checked_at = ? WHERE id = ?").bind(now, now, row.id).run();
  return json({
    ok: true,
    buildKey,
    session: {
      id: row.id,
      userId: row.user_id,
      source: row.source || access.source || "hub",
      issuedTier: Number(row.tier_at_issue || access.tier || 0),
      expiresAt: row.expires_at,
      gameCookieMaxAge: GAME_COOKIE_HOURS * 60 * 60
    },
    access
  });
}
__name(checkGameSession, "checkGameSession");
async function checkGameAccess(request, env) {
  if (!env.DB) return json({ ok: false, error: "Database is not configured yet" }, { status: 503 });
  const secretError = requireGameGateSecret(request, env);
  if (secretError) return secretError;
  const body = await readJson(request);
  const userId = String(body.userId || "").trim();
  const buildKey = cleanGameBuildKey(body.buildKey || "current-ea");
  const sessionId = String(body.sessionId || "").trim();
  if (!userId) return json({ ok: false, error: "Missing userId" }, { status: 400 });
  const access = await gameAccessForUser(env, userId);
  if (sessionId) {
    await env.DB.prepare("UPDATE game_sessions SET last_checked_at = ? WHERE id = ? AND user_id = ? AND build_key = ?").bind((/* @__PURE__ */ new Date()).toISOString(), sessionId, userId, buildKey).run();
  }
  if (!access.active) return json({ ok: false, error: "Early Access is not active", access }, { status: 403 });
  return json({ ok: true, buildKey, access });
}
__name(checkGameAccess, "checkGameAccess");
async function gameAccessForUser(env, userId) {
  const subscription = await activeSubscription(env, userId);
  const tier = Number(subscription?.tier || 0);
  const active = Boolean(subscription?.canLaunchBuilds && tier >= 2);
  return {
    active,
    tier,
    source: subscription?.source || subscription?.paymentSource || "none",
    status: subscription?.renewalStatus || subscription?.status || "none",
    startsAt: subscription?.startsAt || null,
    expiresAt: subscription?.expiresAt || null
  };
}
__name(gameAccessForUser, "gameAccessForUser");
function requireGameGateSecret(request, env) {
  const configured = String(env.GAME_GATE_SECRET || "").trim();
  if (!configured) return json({ ok: false, error: "GAME_GATE_SECRET is not configured" }, { status: 500 });
  const received = String(
    request.headers.get("x-ravene-game-gate-secret") || request.headers.get("x-bp-game-gate-secret") || ""
  ).trim();
  if (!safeEqual(received, configured)) {
    return json({ ok: false, error: "Forbidden game gate request" }, { status: 403 });
  }
  return null;
}
__name(requireGameGateSecret, "requireGameGateSecret");
function cleanGameBuildKey(value) {
  const clean = String(value || "current-ea").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 80);
  return clean || "current-ea";
}
__name(cleanGameBuildKey, "cleanGameBuildKey");
function cleanExternalUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}
__name(cleanExternalUrl, "cleanExternalUrl");
async function listPostComments(request, env, url) {
  if (!env.DB) return json({ comments: [], setupRequired: true });
  const postSlug = cleanPostSlug(url.searchParams.get("post"));
  if (!postSlug) return json({ error: "Post slug is required" }, { status: 400 });
  const account = await currentAccount(request, env);
  const rows = await env.DB.prepare(
    `SELECT post_comments.id, post_comments.user_id, post_comments.body, post_comments.created_at, users.display_name, users.email, users.avatar_url
     FROM post_comments
     JOIN users ON users.id = post_comments.user_id
     WHERE post_comments.post_slug = ?
     ORDER BY post_comments.created_at ASC
     LIMIT 100`
  ).bind(postSlug).all();
  const canModerate = Boolean(account.permissions?.canModerate);
  return json({
    comments: (rows.results || []).map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      authorName: row.display_name || row.email || "Ravene Hub user",
      authorAvatar: row.avatar_url || null,
      canDelete: Boolean(canModerate || account.authenticated && account.user?.id === row.user_id)
    })),
    canModerate
  });
}
__name(listPostComments, "listPostComments");
async function createPostComment(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const body = await readJson(request);
  const postSlug = cleanPostSlug(body.postSlug);
  const comment = cleanLongText(body.body, 2e3);
  if (!postSlug) return json({ error: "Post slug is required" }, { status: 400 });
  if (comment.length < 1) return json({ error: "Write a comment first" }, { status: 400 });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    "INSERT INTO post_comments (id, post_slug, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(randomId(), postSlug, account.user.id, comment, now, now).run();
  return listPostComments(request, env, new URL(`https://local/api/post-comments?post=${encodeURIComponent(postSlug)}`));
}
__name(createPostComment, "createPostComment");
async function deletePostComment(request, env, url) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const commentId = cleanRecordId(decodeURIComponent(url.pathname.split("/").pop() || ""));
  if (!commentId) return json({ error: "Comment id is required" }, { status: 400 });
  const row = await env.DB.prepare("SELECT id, user_id, post_slug FROM post_comments WHERE id = ? LIMIT 1").bind(commentId).first();
  if (!row) return json({ error: "Comment was not found" }, { status: 404 });
  const canDelete = account.permissions?.canModerate || row.user_id === account.user.id;
  if (!canDelete) return json({ error: "Moderator access is required" }, { status: 403 });
  await env.DB.prepare("DELETE FROM post_comments WHERE id = ?").bind(commentId).run();
  await writeModerationLog(env, {
    actorId: account.user.id,
    targetUserId: row.user_id,
    targetType: "post_comment",
    targetId: row.id,
    action: row.user_id === account.user.id ? "delete_own_comment" : "delete_comment"
  });
  return listPostComments(request, env, new URL(`https://local/api/post-comments?post=${encodeURIComponent(row.post_slug)}`));
}
__name(deletePostComment, "deletePostComment");
async function getAccountProfile(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  return json({ user: account.user, profile: account.profile, stats: account.stats, role: account.role, permissions: account.permissions });
}
__name(getAccountProfile, "getAccountProfile");
async function updateAccountProfile(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const body = await readJson(request);
  const requestedDisplayName = cleanDisplayName(body.displayName);
  const displayName = requestedDisplayName || account.user.displayName;
  const displayNameError = requestedDisplayName ? reservedDisplayNameReason(displayName) : "";
  if (displayNameError && !account.permissions?.canManageUsers) return json({ error: displayNameError }, { status: 400 });
  const avatarUrl = cleanUrl(body.avatarUrl, 500) || null;
  const bio = cleanLongText(body.bio, 600);
  const websiteUrl = cleanUrl(body.websiteUrl, 500) || null;
  const publicNote = cleanLongText(body.publicNote, 600);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?").bind(displayName, avatarUrl, now, account.user.id),
    env.DB.prepare(
      `INSERT INTO user_profiles (user_id, bio, website_url, public_note, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET bio = excluded.bio, website_url = excluded.website_url, public_note = excluded.public_note, updated_at = excluded.updated_at`
    ).bind(account.user.id, bio || null, websiteUrl, publicNote || null, now)
  ]);
  return getAccountProfile(request, env);
}
__name(updateAccountProfile, "updateAccountProfile");
async function accountLinksConfig(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  return json({
    providers: {
      google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      x: Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET),
      telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME),
      telegramCode: true
    },
    telegramBotUsername: env.TELEGRAM_BOT_USERNAME || ""
  });
}
__name(accountLinksConfig, "accountLinksConfig");
async function handleAccountLinkApi(request, env, url) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const path = url.pathname;
  if (path === "/api/account/link/google/start" && request.method === "GET") return startOAuthLink(request, env, "google");
  if (path === "/api/account/link/google/callback" && request.method === "GET") return finishGoogleLink(request, env, url);
  if (path === "/api/account/link/x/start" && request.method === "GET") return startOAuthLink(request, env, "x");
  if (path === "/api/account/link/x/callback" && request.method === "GET") return finishXLink(request, env, url);
  if (path === "/api/account/link/telegram/callback" && request.method === "GET") return finishTelegramWidgetLink(request, env, url);
  if (path === "/api/account/link/telegram-code" && request.method === "POST") return linkTelegramCode(request, env);
  return json({ error: "Not found" }, { status: 404 });
}
__name(handleAccountLinkApi, "handleAccountLinkApi");
function oauthProviderConfig(env, provider, origin) {
  if (provider === "google") {
    return {
      provider,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
      redirectUri: `${origin}/api/account/link/google/callback`
    };
  }
  if (provider === "x") {
    return {
      provider,
      clientId: env.X_CLIENT_ID,
      clientSecret: env.X_CLIENT_SECRET,
      authUrl: "https://twitter.com/i/oauth2/authorize",
      tokenUrl: "https://api.x.com/2/oauth2/token",
      scope: "users.read tweet.read",
      redirectUri: `${origin}/api/account/link/x/callback`
    };
  }
  return null;
}
__name(oauthProviderConfig, "oauthProviderConfig");
async function startOAuthLink(request, env, provider) {
  const account = await currentAccount(request, env);
  if (!account.authenticated) return redirectResponse("/account.html?link=signin#connect-account");
  const origin = new URL(request.url).origin;
  const config = oauthProviderConfig(env, provider, origin);
  if (!config?.clientId || !config?.clientSecret) {
    return redirectResponse(`/account.html?link_error=${encodeURIComponent(`${provider} linking is not configured yet`)}#connected-accounts`);
  }
  const state = randomToken();
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const now = /* @__PURE__ */ new Date();
  const expiresAt = addMinutes(now, OAUTH_STATE_MINUTES).toISOString();
  await env.DB.prepare(
    `INSERT INTO oauth_link_states
      (id, user_id, provider, state_hash, code_verifier, redirect_after, created_at, expires_at, consumed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).bind(
    randomId(),
    account.user.id,
    provider,
    await sha256(state),
    codeVerifier,
    "/account.html#connected-accounts",
    now.toISOString(),
    expiresAt
  ).run();
  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  if (provider === "google") {
    authUrl.searchParams.set("access_type", "online");
    authUrl.searchParams.set("prompt", "select_account");
  }
  return redirectResponse(authUrl.toString());
}
__name(startOAuthLink, "startOAuthLink");
async function readOAuthState(request, env, url, provider) {
  const account = await currentAccount(request, env);
  if (!account.authenticated) throw new Error("Sign in first");
  const state = String(url.searchParams.get("state") || "");
  const code = String(url.searchParams.get("code") || "");
  if (!state || !code) throw new Error("OAuth callback is missing state or code");
  const stateHash = await sha256(state);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const row = await env.DB.prepare(
    `SELECT * FROM oauth_link_states
     WHERE provider = ? AND state_hash = ? AND consumed_at IS NULL AND expires_at > ?
     LIMIT 1`
  ).bind(provider, stateHash, now).first();
  if (!row || row.user_id !== account.user.id) throw new Error("OAuth state is wrong or expired");
  await env.DB.prepare("UPDATE oauth_link_states SET consumed_at = ? WHERE id = ?").bind(now, row.id).run();
  return { account, row, code };
}
__name(readOAuthState, "readOAuthState");
async function finishGoogleLink(request, env, url) {
  try {
    const origin = new URL(request.url).origin;
    const config = oauthProviderConfig(env, "google", origin);
    const { account, row, code } = await readOAuthState(request, env, url, "google");
    const token = await exchangeOAuthToken(config, code, row.code_verifier, false);
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` }
    });
    if (!profileResponse.ok) throw new Error("Could not read Google profile");
    const profile = await profileResponse.json();
    const providerUserId = String(profile.sub || "");
    if (!providerUserId) throw new Error("Google profile did not return an account id");
    await linkExternalIdentity(env, account.user.id, {
      provider: "google",
      providerUserId,
      providerUsername: profile.email || profile.name || providerUserId
    });
    if (!account.user.avatarUrl && profile.picture) {
      await env.DB.prepare("UPDATE users SET avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?").bind(cleanUrl(profile.picture, 500) || null, (/* @__PURE__ */ new Date()).toISOString(), account.user.id).run();
    }
    return redirectResponse("/account.html?linked=google#connected-accounts");
  } catch (error) {
    return redirectResponse(`/account.html?link_error=${encodeURIComponent(error.message || "Could not link Google")}#connected-accounts`);
  }
}
__name(finishGoogleLink, "finishGoogleLink");
async function finishXLink(request, env, url) {
  try {
    const origin = new URL(request.url).origin;
    const config = oauthProviderConfig(env, "x", origin);
    const { account, row, code } = await readOAuthState(request, env, url, "x");
    const token = await exchangeOAuthToken(config, code, row.code_verifier, true);
    const profileResponse = await fetch("https://api.x.com/2/users/me?user.fields=username,name,profile_image_url", {
      headers: { authorization: `Bearer ${token.access_token}` }
    });
    if (!profileResponse.ok) throw new Error("Could not read X profile");
    const profile = await profileResponse.json();
    const data = profile.data || {};
    const providerUserId = String(data.id || "");
    if (!providerUserId) throw new Error("X profile did not return an account id");
    await linkExternalIdentity(env, account.user.id, {
      provider: "x",
      providerUserId,
      providerUsername: data.username ? `@${data.username}` : providerUserId
    });
    return redirectResponse("/account.html?linked=x#connected-accounts");
  } catch (error) {
    return redirectResponse(`/account.html?link_error=${encodeURIComponent(error.message || "Could not link X")}#connected-accounts`);
  }
}
__name(finishXLink, "finishXLink");
async function exchangeOAuthToken(config, code, codeVerifier, useBasicAuth) {
  if (!config?.clientId || !config?.clientSecret) throw new Error(`${config?.provider || "OAuth"} linking is not configured yet`);
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", config.redirectUri);
  body.set("code_verifier", codeVerifier);
  if (!useBasicAuth) {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
  }
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (useBasicAuth) headers.authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
  const response = await fetch(config.tokenUrl, { method: "POST", headers, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || `Could not exchange ${config.provider} code`);
  return data;
}
__name(exchangeOAuthToken, "exchangeOAuthToken");
async function finishTelegramWidgetLink(request, env, url) {
  try {
    const account = await currentAccount(request, env);
    if (!account.authenticated) throw new Error("Sign in first");
    const data = Object.fromEntries(url.searchParams.entries());
    const profile = await verifyTelegramAuth(env, data);
    await linkExternalIdentity(env, account.user.id, {
      provider: "telegram",
      providerUserId: profile.id,
      providerUsername: profile.username ? `@${profile.username}` : [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.id
    });
    return redirectResponse("/account.html?linked=telegram#connected-accounts");
  } catch (error) {
    return redirectResponse(`/account.html?link_error=${encodeURIComponent(error.message || "Could not link Telegram")}#connected-accounts`);
  }
}
__name(finishTelegramWidgetLink, "finishTelegramWidgetLink");
async function linkTelegramCode(request, env) {
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const body = await readJson(request);
  const code = normalizeCode(body.code);
  if (!code) return json({ error: "Enter the code from the Telegram bot" }, { status: 400 });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const row = await env.DB.prepare(
    "SELECT * FROM login_codes WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1"
  ).bind(await sha256(code), now).first();
  if (!row || !row.telegram_id) return json({ error: "Telegram code is wrong or expired" }, { status: 401 });
  await linkExternalIdentity(env, account.user.id, {
    provider: "telegram",
    providerUserId: row.telegram_id,
    providerUsername: row.telegram_username ? `@${row.telegram_username}` : row.telegram_id
  });
  await env.DB.prepare("UPDATE login_codes SET consumed_at = ?, user_id = ? WHERE id = ?").bind(now, account.user.id, row.id).run();
  return json({ ok: true, message: "Telegram account linked." });
}
__name(linkTelegramCode, "linkTelegramCode");
async function linkExternalIdentity(env, userId, identity) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = await env.DB.prepare(
    "SELECT id, user_id FROM user_identities WHERE provider = ? AND provider_user_id = ? LIMIT 1"
  ).bind(identity.provider, identity.providerUserId).first();
  if (existing && existing.user_id !== userId) {
    throw new Error("This external account is already linked to another Ravene Hub account");
  }
  if (existing) {
    await env.DB.prepare("UPDATE user_identities SET provider_username = ?, updated_at = ? WHERE id = ?").bind(identity.providerUsername || null, now, existing.id).run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO user_identities (id, user_id, provider, provider_user_id, provider_username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(randomId(), userId, identity.provider, identity.providerUserId, identity.providerUsername || null, now, now).run();
}
__name(linkExternalIdentity, "linkExternalIdentity");
async function verifyTelegramAuth(env, data) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram linking is not configured yet");
  const receivedHash = String(data.hash || "");
  if (!receivedHash) throw new Error("Telegram login hash is missing");
  const authDate = Number(data.auth_date || 0);
  if (!authDate || Date.now() / 1e3 - authDate > TELEGRAM_AUTH_MAX_AGE_SECONDS) {
    throw new Error("Telegram login is expired");
  }
  const checkString = Object.keys(data).filter((key) => key !== "hash" && data[key] !== void 0 && data[key] !== null && data[key] !== "").sort().map((key) => `${key}=${data[key]}`).join("\n");
  const secretKey = await sha256Bytes(env.TELEGRAM_BOT_TOKEN);
  const expected = await hmacSha256HexWithKey(secretKey, checkString);
  if (!safeHexEqual(expected, receivedHash)) throw new Error("Telegram login signature is wrong");
  return {
    id: String(data.id || ""),
    username: String(data.username || ""),
    first_name: String(data.first_name || ""),
    last_name: String(data.last_name || ""),
    photo_url: String(data.photo_url || "")
  };
}
__name(verifyTelegramAuth, "verifyTelegramAuth");
async function handlePostsApi(request, env, url) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  await ensurePostSchema(env);
  const parts = url.pathname.split("/").filter(Boolean);
  const slug = cleanPostSlug(decodeURIComponent(parts[2] || ""));
  const action = parts[3] || "";
  if (url.pathname === "/api/posts" && request.method === "GET") return listHubPosts(request, env, url);
  if (url.pathname === "/api/posts" && request.method === "POST") return createHubPost(request, env);
  if (!slug) return json({ error: "Post slug is required" }, { status: 400 });
  if (action === "like" && request.method === "POST") return likeHubPost(request, env, slug);
  if (action === "like" && request.method === "DELETE") return unlikeHubPost(request, env, slug);
  if (!action && request.method === "GET") return getHubPost(request, env, slug);
  if (!action && request.method === "PUT") return updateHubPost(request, env, slug);
  if (!action && request.method === "DELETE") return deleteHubPost(request, env, slug);
  return json({ error: "Not found" }, { status: 404 });
}
__name(handlePostsApi, "handlePostsApi");
async function listHubPosts(request, env, url) {
  const account = await currentAccount(request, env);
  const canManage = Boolean(account.permissions?.canManagePosts);
  const scope = url.searchParams.get("scope") || "published";
  const includeAll = canManage && scope === "all";
  const pinnedOnly = url.searchParams.get("pinned") === "1";
  const orderBy = pinnedOnly ? "pinned_at DESC, COALESCE(created_at, published_at, updated_at) DESC" : "COALESCE(created_at, published_at, updated_at) DESC";
  const rows = await env.DB.prepare(
    `SELECT hub_posts.*,
       (SELECT COUNT(*) FROM post_likes WHERE post_likes.post_id = hub_posts.id) AS like_count,
       (SELECT COUNT(*) FROM post_comments WHERE post_comments.post_slug = hub_posts.slug) AS comment_count
     FROM hub_posts
     WHERE deleted_at IS NULL
       AND (? = 1 OR status = 'published')
       AND (? = 0 OR pinned_at IS NOT NULL)
     ORDER BY ${orderBy}
     LIMIT 80`
  ).bind(includeAll ? 1 : 0, pinnedOnly ? 1 : 0).all();
  const posts = [];
  for (const row of rows.results || []) {
    if (!includeAll && !canReadVisibility(row.visibility, account)) continue;
    posts.push(await publicPost(env, row, account, { includeBody: false }));
  }
  return json({ posts, canManagePosts: canManage });
}
__name(listHubPosts, "listHubPosts");
async function hubPostRowWithCounts(env, slug) {
  for (const candidate of postLookupSlugs(slug)) {
    const row = await env.DB.prepare(
      `SELECT hub_posts.*,
         (SELECT COUNT(*) FROM post_likes WHERE post_likes.post_id = hub_posts.id) AS like_count,
         (SELECT COUNT(*) FROM post_comments WHERE post_comments.post_slug IN (?, ?)) AS comment_count
       FROM hub_posts
       WHERE slug = ? AND deleted_at IS NULL
       LIMIT 1`
    ).bind(candidate, canonicalPostSlug(candidate), candidate).first();
    if (row) return row;
  }
  return null;
}
__name(hubPostRowWithCounts, "hubPostRowWithCounts");
async function hubPostBaseRow(env, slug) {
  for (const candidate of postLookupSlugs(slug)) {
    const row = await env.DB.prepare("SELECT * FROM hub_posts WHERE slug = ? AND deleted_at IS NULL LIMIT 1").bind(candidate).first();
    if (row) return row;
  }
  return null;
}
__name(hubPostBaseRow, "hubPostBaseRow");
async function getHubPost(request, env, slug) {
  const account = await currentAccount(request, env);
  const row = await hubPostRowWithCounts(env, slug);
  if (!row) return json({ error: "Post was not found" }, { status: 404 });
  if (row.status !== "published" && !account.permissions?.canManagePosts) return json({ error: "Post is not published" }, { status: 403 });
  if (!canReadVisibility(row.visibility, account)) return json({ error: "This post requires higher access" }, { status: 403 });
  return json({ post: await publicPost(env, row, account, { includeBody: true }), canManagePosts: Boolean(account.permissions?.canManagePosts) });
}
__name(getHubPost, "getHubPost");
async function createHubPost(request, env) {
  const account = await requirePermission(request, env, "canManagePosts", "Admin access is required");
  if (account instanceof Response) return account;
  const body = await readJson(request);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const title = cleanLongText(body.title, 180);
  if (!title) return json({ error: "Post title is required" }, { status: 400 });
  const slug = cleanPostSlug(body.slug) || cleanPostSlug(title);
  if (!slug) return json({ error: "Post slug is required" }, { status: 400 });
  const existing = await env.DB.prepare("SELECT id FROM hub_posts WHERE slug = ? LIMIT 1").bind(slug).first();
  if (existing) return json({ error: "Post slug is already used" }, { status: 409 });
  const status = cleanPostStatus(body.status);
  const visibility = cleanPostVisibility(body.visibility);
  const postId = randomId();
  const pinnedAt = body.pinned ? now : null;
  await env.DB.prepare(
    `INSERT INTO hub_posts
      (id, slug, title, excerpt, body, status, visibility, category, cover_url, author_id, author_name, published_at, pinned_at, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).bind(
    postId,
    slug,
    title,
    cleanLongText(body.excerpt, 500) || null,
    cleanLongText(body.body, 4e4),
    status,
    visibility,
    cleanLongText(body.category, 80) || null,
    cleanUrl(body.coverUrl, 500) || null,
    account.user.id,
    account.user.displayName,
    status === "published" ? now : null,
    pinnedAt,
    now,
    now
  ).run();
  await replacePostMedia(env, postId, body.media || [], now);
  await writeModerationLog(env, { actorId: account.user.id, targetType: "hub_post", targetId: postId, action: "create_post" });
  return getHubPost(request, env, slug);
}
__name(createHubPost, "createHubPost");
async function updateHubPost(request, env, slug) {
  const account = await requirePermission(request, env, "canManagePosts", "Admin access is required");
  if (account instanceof Response) return account;
  const existing = await hubPostBaseRow(env, slug);
  if (!existing) return json({ error: "Post was not found" }, { status: 404 });
  const body = await readJson(request);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const nextTitle = cleanLongText(body.title, 180) || existing.title;
  const nextSlug = cleanPostSlug(body.slug) || existing.slug;
  const nextStatus = cleanPostStatus(body.status || existing.status);
  const nextVisibility = cleanPostVisibility(body.visibility || existing.visibility);
  if (nextSlug !== existing.slug) {
    const conflict = await env.DB.prepare("SELECT id FROM hub_posts WHERE slug = ? AND id <> ? LIMIT 1").bind(nextSlug, existing.id).first();
    if (conflict) return json({ error: "Post slug is already used" }, { status: 409 });
  }
  const isPublishingNow = existing.status !== "published" && nextStatus === "published";
  const stablePublishedAt = existing.published_at || (!isPublishingNow ? existing.created_at || existing.updated_at : null) || now;
  const publishedAt = nextStatus === "published" ? stablePublishedAt : null;
  const pinnedAt = body.pinned ? existing.pinned_at || now : null;
  await env.DB.prepare(
    `UPDATE hub_posts
     SET slug = ?, title = ?, excerpt = ?, body = ?, status = ?, visibility = ?, category = ?, cover_url = ?, published_at = ?, pinned_at = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    nextSlug,
    nextTitle,
    cleanLongText(body.excerpt, 500) || null,
    cleanLongText(body.body, 4e4),
    nextStatus,
    nextVisibility,
    cleanLongText(body.category, 80) || null,
    cleanUrl(body.coverUrl, 500) || null,
    publishedAt,
    pinnedAt,
    now,
    existing.id
  ).run();
  if (Array.isArray(body.media)) await replacePostMedia(env, existing.id, body.media, now);
  await writeModerationLog(env, { actorId: account.user.id, targetType: "hub_post", targetId: existing.id, action: "update_post" });
  return getHubPost(request, env, nextSlug);
}
__name(updateHubPost, "updateHubPost");
async function deleteHubPost(request, env, slug) {
  const account = await requirePermission(request, env, "canManagePosts", "Admin access is required");
  if (account instanceof Response) return account;
  const row = await hubPostBaseRow(env, slug);
  if (!row) return json({ error: "Post was not found" }, { status: 404 });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare("UPDATE hub_posts SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, row.id).run();
  await writeModerationLog(env, { actorId: account.user.id, targetType: "hub_post", targetId: row.id, action: "delete_post" });
  return json({ ok: true });
}
__name(deleteHubPost, "deleteHubPost");
async function likeHubPost(request, env, slug) {
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const row = await hubPostBaseRow(env, slug);
  if (!row) return json({ error: "Post was not found" }, { status: 404 });
  if (row.status !== "published" || !canReadVisibility(row.visibility, account)) return json({ error: "This post is not available" }, { status: 403 });
  await env.DB.prepare("INSERT OR IGNORE INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)").bind(row.id, account.user.id, (/* @__PURE__ */ new Date()).toISOString()).run();
  return getHubPost(request, env, row.slug);
}
__name(likeHubPost, "likeHubPost");
async function unlikeHubPost(request, env, slug) {
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const row = await hubPostBaseRow(env, slug);
  if (!row) return json({ error: "Post was not found" }, { status: 404 });
  await env.DB.prepare("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?").bind(row.id, account.user.id).run();
  return getHubPost(request, env, row.slug);
}
__name(unlikeHubPost, "unlikeHubPost");
async function handleCommunityChatApi(request, env, url) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  await ensureCommunityChatSchema(env);
  if (url.pathname === "/api/community/chat" && request.method === "GET") return listChatMessages(request, env);
  if (url.pathname === "/api/community/chat" && request.method === "POST") return createChatMessage(request, env);
  if (url.pathname.startsWith("/api/community/chat/") && (request.method === "PUT" || request.method === "PATCH")) return editChatMessage(request, env, url);
  if (url.pathname.startsWith("/api/community/chat/") && request.method === "DELETE") return deleteChatMessage(request, env, url);
  return json({ error: "Not found" }, { status: 404 });
}
__name(handleCommunityChatApi, "handleCommunityChatApi");
async function ensurePostSchema(env) {
  if (!env.DB) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hub_posts (
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
      pinned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS post_media (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES hub_posts(id) ON DELETE CASCADE,
      media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'link')),
      url TEXT NOT NULL,
      title TEXT,
      caption TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS post_likes (
      post_id TEXT NOT NULL REFERENCES hub_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_slug TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS moderation_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      raw_payload TEXT
    )`)
  ]);
  const hubColumns = await tableColumns(env, "hub_posts");
  if (!hubColumns.has("pinned_at")) {
    await env.DB.prepare("ALTER TABLE hub_posts ADD COLUMN pinned_at TEXT").run();
  }
  if (!hubColumns.has("published_at")) {
    await env.DB.prepare("ALTER TABLE hub_posts ADD COLUMN published_at TEXT").run();
  }
  if (!hubColumns.has("created_at")) {
    await env.DB.prepare("ALTER TABLE hub_posts ADD COLUMN created_at TEXT").run();
  }
  if (!hubColumns.has("updated_at")) {
    await env.DB.prepare("ALTER TABLE hub_posts ADD COLUMN updated_at TEXT").run();
  }
  await env.DB.batch([
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_hub_posts_status_published ON hub_posts(status, published_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_hub_posts_visibility ON hub_posts(visibility)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_hub_posts_author ON hub_posts(author_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_hub_posts_pinned ON hub_posts(pinned_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id, sort_order)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_post_comments_slug_created ON post_comments(post_slug, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_post_comments_user ON post_comments(user_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_moderation_logs_target ON moderation_logs(target_type, target_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_moderation_logs_actor ON moderation_logs(actor_id, created_at)")
  ]);
}
__name(ensurePostSchema, "ensurePostSchema");
async function tableColumns(env, tableName) {
  const safeTable = String(tableName || "").replace(/[^a-zA-Z0-9_]/g, "");
  if (!safeTable) return /* @__PURE__ */ new Set();
  const rows = await env.DB.prepare(`PRAGMA table_info(${safeTable})`).all();
  return new Set((rows.results || []).map((row) => String(row.name || "")));
}
__name(tableColumns, "tableColumns");
async function ensureCommunityChatSchema(env) {
  if (!env.DB) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS community_chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      edited_at TEXT,
      edit_count INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_chat_created ON community_chat_messages(created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_chat_status_created ON community_chat_messages(status, created_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_moderation_queue (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('quarantine', 'blocked')),
      reason TEXT,
      categories TEXT,
      provider TEXT,
      model TEXT,
      raw_payload TEXT,
      queue_type TEXT NOT NULL DEFAULT 'new_message',
      source_message_id TEXT,
      previous_body TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      review_action TEXT CHECK (review_action IN ('approved', 'dismissed', 'deleted'))
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_chat_moderation_created ON chat_moderation_queue(created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_chat_moderation_review ON chat_moderation_queue(review_action, created_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_user_moderation (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      strike_count INTEGER NOT NULL DEFAULT 0,
      muted_until TEXT,
      banned_at TEXT,
      ban_reason TEXT,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS chat_message_translations (
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
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_chat_translations_message ON chat_message_translations(message_id, source_table, target_language)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS moderation_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      raw_payload TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_moderation_logs_target ON moderation_logs(target_type, target_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_moderation_logs_actor ON moderation_logs(actor_id, created_at)")
  ]);
  const chatColumns = await tableColumns(env, "community_chat_messages");
  if (!chatColumns.has("edited_at")) {
    await env.DB.prepare("ALTER TABLE community_chat_messages ADD COLUMN edited_at TEXT").run();
  }
  if (!chatColumns.has("edit_count")) {
    await env.DB.prepare("ALTER TABLE community_chat_messages ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0").run();
  }
  const queueColumns = await tableColumns(env, "chat_moderation_queue");
  if (!queueColumns.has("queue_type")) {
    await env.DB.prepare("ALTER TABLE chat_moderation_queue ADD COLUMN queue_type TEXT NOT NULL DEFAULT 'new_message'").run();
  }
  if (!queueColumns.has("source_message_id")) {
    await env.DB.prepare("ALTER TABLE chat_moderation_queue ADD COLUMN source_message_id TEXT").run();
  }
  if (!queueColumns.has("previous_body")) {
    await env.DB.prepare("ALTER TABLE chat_moderation_queue ADD COLUMN previous_body TEXT").run();
  }
  await env.DB.batch([
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_chat_moderation_source ON chat_moderation_queue(source_message_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_chat_moderation_type_created ON chat_moderation_queue(queue_type, created_at)")
  ]);
}
__name(ensureCommunityChatSchema, "ensureCommunityChatSchema");
async function listChatMessages(request, env) {
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const chatState = publicChatUserState(await chatUserState(env, account.user.id));
  const rows = await env.DB.prepare(
    `SELECT community_chat_messages.id, community_chat_messages.user_id, community_chat_messages.body, community_chat_messages.created_at,
            community_chat_messages.updated_at, community_chat_messages.edited_at, community_chat_messages.edit_count,
            users.display_name, users.email, users.avatar_url
     FROM community_chat_messages
     JOIN users ON users.id = community_chat_messages.user_id
     WHERE community_chat_messages.status = 'active'
     ORDER BY community_chat_messages.created_at DESC
     LIMIT 80`
  ).all();
  const canTranslate = Boolean(account.permissions?.canManagePosts);
  const messages = (rows.results || []).reverse().map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    editedAt: row.edited_at || null,
    edited: Boolean(row.edited_at || Number(row.edit_count || 0) > 0),
    authorName: row.display_name || row.email || "Ravene Hub user",
    authorAvatar: row.avatar_url || null,
    own: row.user_id === account.user.id,
    canDelete: Boolean(account.permissions?.canModerate || row.user_id === account.user.id),
    canEdit: row.user_id === account.user.id,
    canTranslate
  }));
  return json({ messages, canModerate: Boolean(account.permissions?.canModerate), canTranslate, chatState });
}
__name(listChatMessages, "listChatMessages");
async function createChatMessage(request, env) {
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const body = await readJson(request);
  const message = cleanLongText(body.body, 1800);
  if (!message) return json({ error: "Write a message first" }, { status: 400 });
  const userState = await chatUserState(env, account.user.id);
  if (userState.bannedAt) return json({ error: "Chat access is restricted." }, { status: 403 });
  if (userState.mutedUntil && new Date(userState.mutedUntil).getTime() > Date.now()) {
    return json({ error: "Chat is temporarily muted for this account.", chatState: publicChatUserState(userState) }, { status: 429 });
  }
  const moderation = await moderateChatMessage(env, request, account, message);
  if (moderation.decision === "blocked" || moderation.decision === "quarantine") {
    await saveChatModerationQueue(env, account.user.id, message, moderation);
    await incrementChatStrike(env, account.user.id, moderation);
    if (moderation.decision === "blocked") {
      return json({ error: "Your message could not be posted." }, { status: 400 });
    }
    const response = await listChatMessages(request, env);
    const payload = await response.json();
    return json({ ...payload, notice: "Your message is waiting for moderation." });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    "INSERT INTO community_chat_messages (id, user_id, body, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)"
  ).bind(randomId(), account.user.id, message, now, now).run();
  return listChatMessages(request, env);
}
__name(createChatMessage, "createChatMessage");
async function editChatMessage(request, env, url) {
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const messageId = cleanRecordId(decodeURIComponent(url.pathname.split("/").pop() || ""));
  const row = await env.DB.prepare("SELECT id, user_id, body FROM community_chat_messages WHERE id = ? AND status = 'active' LIMIT 1").bind(messageId).first();
  if (!row) return json({ error: "Message was not found" }, { status: 404 });
  if (row.user_id !== account.user.id) return json({ error: "You can edit only your own messages" }, { status: 403 });
  const userState = await chatUserState(env, account.user.id);
  if (userState.bannedAt) return json({ error: "Chat access is restricted." }, { status: 403 });
  if (userState.mutedUntil && new Date(userState.mutedUntil).getTime() > Date.now()) {
    return json({ error: "Chat is temporarily muted for this account.", chatState: publicChatUserState(userState) }, { status: 429 });
  }
  const payload = await readJson(request);
  const nextBody = cleanLongText(payload.body, 1800);
  if (!nextBody) return json({ error: "Write a message first" }, { status: 400 });
  if (nextBody === row.body) return listChatMessages(request, env);
  const moderation = await moderateChatMessage(env, request, account, nextBody, { sourceMessageId: row.id, isEdit: true });
  if (moderation.decision === "blocked" || moderation.decision === "quarantine") {
    await saveChatModerationQueue(env, account.user.id, nextBody, moderation, {
      queueType: "edit_message",
      sourceMessageId: row.id,
      previousBody: row.body
    });
    await incrementChatStrike(env, account.user.id, moderation);
    const response = await listChatMessages(request, env);
    const data = await response.json();
    return json({ ...data, notice: moderation.decision === "blocked" ? "Your edit could not be posted." : "Your edit is waiting for moderation." }, { status: moderation.decision === "blocked" ? 400 : 200 });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare("UPDATE community_chat_messages SET body = ?, edited_at = ?, edit_count = COALESCE(edit_count, 0) + 1, updated_at = ? WHERE id = ?").bind(nextBody, now, now, row.id).run();
  await writeModerationLog(env, {
    actorId: account.user.id,
    targetUserId: row.user_id,
    targetType: "chat_message",
    targetId: row.id,
    action: "edit_own_chat_message"
  });
  return listChatMessages(request, env);
}
__name(editChatMessage, "editChatMessage");
async function deleteChatMessage(request, env, url) {
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const messageId = cleanRecordId(decodeURIComponent(url.pathname.split("/").pop() || ""));
  const row = await env.DB.prepare("SELECT id, user_id FROM community_chat_messages WHERE id = ? AND status = 'active' LIMIT 1").bind(messageId).first();
  if (!row) return json({ error: "Message was not found" }, { status: 404 });
  const canDelete = account.permissions?.canModerate || row.user_id === account.user.id;
  if (!canDelete) return json({ error: "Moderator access is required" }, { status: 403 });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare("UPDATE community_chat_messages SET status = 'deleted', deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?").bind(now, account.user.id, now, row.id).run();
  await writeModerationLog(env, {
    actorId: account.user.id,
    targetUserId: row.user_id,
    targetType: "chat_message",
    targetId: row.id,
    action: row.user_id === account.user.id ? "delete_own_chat_message" : "delete_chat_message"
  });
  return listChatMessages(request, env);
}
__name(deleteChatMessage, "deleteChatMessage");
async function handleAdminChatApi(request, env, url) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  await ensureCommunityChatSchema(env);
  if (url.pathname === "/api/admin/chat/moderation-queue" && request.method === "GET") return listChatModerationQueue(request, env);
  if (url.pathname.startsWith("/api/admin/chat/moderation-queue/") && url.pathname.endsWith("/approve") && request.method === "POST") return approveQueuedChatMessage(request, env, url);
  if (url.pathname.startsWith("/api/admin/chat/moderation-queue/") && url.pathname.endsWith("/dismiss") && request.method === "POST") return dismissQueuedChatMessage(request, env, url);
  if (url.pathname.startsWith("/api/admin/chat/moderation-queue/") && url.pathname.endsWith("/translate") && request.method === "POST") return translateQueuedChatMessage(request, env, url);
  if (url.pathname.startsWith("/api/admin/chat/messages/") && url.pathname.endsWith("/translate") && request.method === "POST") return translatePublishedChatMessage(request, env, url);
  return json({ error: "Not found" }, { status: 404 });
}
__name(handleAdminChatApi, "handleAdminChatApi");
async function listChatModerationQueue(request, env) {
  const account = await requirePermission(request, env, "canManagePosts", "Admin access is required");
  if (account instanceof Response) return account;
  const rows = await env.DB.prepare(
    `SELECT chat_moderation_queue.id, chat_moderation_queue.user_id, chat_moderation_queue.body, chat_moderation_queue.decision,
            chat_moderation_queue.reason, chat_moderation_queue.categories, chat_moderation_queue.provider, chat_moderation_queue.model,
            chat_moderation_queue.queue_type, chat_moderation_queue.source_message_id, chat_moderation_queue.previous_body,
            chat_moderation_queue.created_at, users.display_name, users.email
     FROM chat_moderation_queue
     LEFT JOIN users ON users.id = chat_moderation_queue.user_id
     WHERE chat_moderation_queue.review_action IS NULL
     ORDER BY chat_moderation_queue.created_at DESC
     LIMIT 80`
  ).all();
  return json({ items: (rows.results || []).map(publicQueuedChatMessage) });
}
__name(listChatModerationQueue, "listChatModerationQueue");
async function approveQueuedChatMessage(request, env, url) {
  const account = await requirePermission(request, env, "canManagePosts", "Admin access is required");
  if (account instanceof Response) return account;
  const queueId = cleanRoutePart(url, -2);
  const row = await env.DB.prepare("SELECT * FROM chat_moderation_queue WHERE id = ? AND review_action IS NULL LIMIT 1").bind(queueId).first();
  if (!row) return json({ error: "Queued message was not found" }, { status: 404 });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const isEdit = row.queue_type === "edit_message" && row.source_message_id;
  if (isEdit) {
    const source = await env.DB.prepare("SELECT id FROM community_chat_messages WHERE id = ? AND status = 'active' LIMIT 1").bind(row.source_message_id).first();
    if (!source) return json({ error: "Original message is no longer available" }, { status: 404 });
    await env.DB.batch([
      env.DB.prepare("UPDATE community_chat_messages SET body = ?, edited_at = ?, edit_count = COALESCE(edit_count, 0) + 1, updated_at = ? WHERE id = ?").bind(row.body, now, now, row.source_message_id),
      env.DB.prepare("UPDATE chat_moderation_queue SET reviewed_at = ?, reviewed_by = ?, review_action = 'approved' WHERE id = ?").bind(now, account.user.id, row.id)
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO community_chat_messages (id, user_id, body, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").bind(randomId(), row.user_id, row.body, now, now),
      env.DB.prepare("UPDATE chat_moderation_queue SET reviewed_at = ?, reviewed_by = ?, review_action = 'approved' WHERE id = ?").bind(now, account.user.id, row.id)
    ]);
  }
  await writeModerationLog(env, {
    actorId: account.user.id,
    targetUserId: row.user_id,
    targetType: "chat_moderation_queue",
    targetId: row.id,
    action: isEdit ? "approve_chat_edit" : "approve_chat_message",
    reason: row.reason || null,
    rawPayload: isEdit ? { sourceMessageId: row.source_message_id } : null
  });
  return listChatModerationQueue(request, env);
}
__name(approveQueuedChatMessage, "approveQueuedChatMessage");
async function dismissQueuedChatMessage(request, env, url) {
  const account = await requirePermission(request, env, "canManagePosts", "Admin access is required");
  if (account instanceof Response) return account;
  const queueId = cleanRoutePart(url, -2);
  const row = await env.DB.prepare("SELECT id, user_id, reason FROM chat_moderation_queue WHERE id = ? AND review_action IS NULL LIMIT 1").bind(queueId).first();
  if (!row) return json({ error: "Queued message was not found" }, { status: 404 });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare("UPDATE chat_moderation_queue SET reviewed_at = ?, reviewed_by = ?, review_action = 'dismissed' WHERE id = ?").bind(now, account.user.id, row.id).run();
  await writeModerationLog(env, {
    actorId: account.user.id,
    targetUserId: row.user_id,
    targetType: "chat_moderation_queue",
    targetId: row.id,
    action: "dismiss_chat_message",
    reason: row.reason || null
  });
  return listChatModerationQueue(request, env);
}
__name(dismissQueuedChatMessage, "dismissQueuedChatMessage");
async function translatePublishedChatMessage(request, env, url) {
  const account = await requirePermission(request, env, "canManagePosts", "Admin access is required");
  if (account instanceof Response) return account;
  const messageId = cleanRoutePart(url, -2);
  const row = await env.DB.prepare("SELECT id, body FROM community_chat_messages WHERE id = ? AND status = 'active' LIMIT 1").bind(messageId).first();
  if (!row) return json({ error: "Message was not found" }, { status: 404 });
  return translateChatBody(request, env, account, row.id, "community_chat_messages", row.body);
}
__name(translatePublishedChatMessage, "translatePublishedChatMessage");
async function translateQueuedChatMessage(request, env, url) {
  const account = await requirePermission(request, env, "canManagePosts", "Admin access is required");
  if (account instanceof Response) return account;
  const queueId = cleanRoutePart(url, -2);
  const row = await env.DB.prepare("SELECT id, body FROM chat_moderation_queue WHERE id = ? AND review_action IS NULL LIMIT 1").bind(queueId).first();
  if (!row) return json({ error: "Queued message was not found" }, { status: 404 });
  return translateChatBody(request, env, account, row.id, "chat_moderation_queue", row.body);
}
__name(translateQueuedChatMessage, "translateQueuedChatMessage");
async function translateChatBody(request, env, account, messageId, sourceTable, body) {
  const payload = await readJson(request);
  const targetLanguage = cleanTargetLanguage(payload.targetLanguage || payload.language || "English");
  if (!targetLanguage) return json({ error: "Choose a target language" }, { status: 400 });
  const cached = await env.DB.prepare(
    "SELECT translated_body, provider, model, created_at FROM chat_message_translations WHERE message_id = ? AND source_table = ? AND target_language = ? LIMIT 1"
  ).bind(messageId, sourceTable, targetLanguage).first();
  if (cached) {
    return json({ messageId, sourceTable, targetLanguage, translation: cached.translated_body, provider: cached.provider, model: cached.model, cached: true });
  }
  const translated = await translateWithAi(env, body, targetLanguage);
  if (!translated.text) return json({ error: "AI translation is not configured yet." }, { status: 503 });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `INSERT INTO chat_message_translations (id, message_id, source_table, target_language, translated_body, provider, model, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(randomId(), messageId, sourceTable, targetLanguage, translated.text, translated.provider, translated.model, now, account.user.id).run();
  return json({ messageId, sourceTable, targetLanguage, translation: translated.text, provider: translated.provider, model: translated.model, cached: false });
}
__name(translateChatBody, "translateChatBody");
async function chatUserState(env, userId) {
  const row = await env.DB.prepare("SELECT strike_count, muted_until, banned_at, ban_reason FROM chat_user_moderation WHERE user_id = ? LIMIT 1").bind(userId).first();
  return {
    strikeCount: Number(row?.strike_count || 0),
    mutedUntil: row?.muted_until || null,
    bannedAt: row?.banned_at || null,
    banReason: row?.ban_reason || null
  };
}
__name(chatUserState, "chatUserState");
function publicChatUserState(state) {
  const mutedUntilTime = state?.mutedUntil ? new Date(state.mutedUntil).getTime() : 0;
  const mutedUntil = Number.isFinite(mutedUntilTime) && mutedUntilTime > Date.now() ? state.mutedUntil : null;
  return {
    strikeCount: Number(state?.strikeCount || 0),
    mutedUntil,
    muteRemainingSeconds: mutedUntil ? Math.max(0, Math.ceil((mutedUntilTime - Date.now()) / 1e3)) : 0,
    banned: Boolean(state?.bannedAt),
    bannedAt: state?.bannedAt || null,
    banReason: state?.banReason || null
  };
}
__name(publicChatUserState, "publicChatUserState");
async function incrementChatStrike(env, userId, moderation) {
  if (!userId || moderation.decision !== "blocked") return;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const current = await chatUserState(env, userId);
  const nextStrikeCount = current.strikeCount + 1;
  const categories = Array.isArray(moderation.categories) ? moderation.categories : [];
  const muteEligible = categories.some((category) => ["spam", "scam", "flood", "threat", "doxxing", "illegal_minor_sexual_content"].includes(category));
  const muteAfter = Number(env.CHAT_AUTO_MUTE_AFTER_STRIKES || 3);
  const shouldMute = muteEligible && nextStrikeCount >= muteAfter;
  const muteMinutes = Math.min(60, 10 * Math.max(1, nextStrikeCount - muteAfter + 1));
  const mutedUntil = shouldMute ? addMinutes(/* @__PURE__ */ new Date(), muteMinutes).toISOString() : null;
  await env.DB.prepare(
    `INSERT INTO chat_user_moderation (user_id, strike_count, muted_until, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       strike_count = strike_count + 1,
       muted_until = CASE
         WHEN excluded.muted_until IS NOT NULL
          AND (chat_user_moderation.muted_until IS NULL OR chat_user_moderation.muted_until < excluded.muted_until)
         THEN excluded.muted_until
         ELSE chat_user_moderation.muted_until
       END,
       updated_at = excluded.updated_at`
  ).bind(userId, mutedUntil, now).run();
}
__name(incrementChatStrike, "incrementChatStrike");
async function saveChatModerationQueue(env, userId, body, moderation, options = {}) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const queueId = randomId();
  await env.DB.prepare(
    `INSERT INTO chat_moderation_queue (id, user_id, body, decision, reason, categories, provider, model, raw_payload, queue_type, source_message_id, previous_body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    queueId,
    userId,
    body,
    moderation.decision === "blocked" ? "blocked" : "quarantine",
    moderation.reason || null,
    JSON.stringify(moderation.categories || []),
    moderation.provider || "local",
    moderation.model || null,
    moderation.raw ? JSON.stringify(moderation.raw).slice(0, 4e3) : null,
    options.queueType || "new_message",
    options.sourceMessageId || null,
    options.previousBody || null,
    now
  ).run();
  await writeModerationLog(env, {
    actorId: null,
    targetUserId: userId,
    targetType: "chat_moderation_queue",
    targetId: queueId,
    action: moderation.decision === "blocked" ? "auto_block_chat_message" : "auto_quarantine_chat_message",
    reason: moderation.reason || null,
    rawPayload: { categories: moderation.categories || [], provider: moderation.provider || "local" }
  });
}
__name(saveChatModerationQueue, "saveChatModerationQueue");
async function moderateChatMessage(env, request, account, message, options = {}) {
  const local = await localChatModeration(env, request, account, message);
  if (local.decision === "blocked") return local;
  const ai = await aiChatModeration(env, message);
  if (ai.decision === "blocked" || ai.decision === "quarantine") return ai;
  if (local.decision === "quarantine") return local;
  return { decision: "allow", reason: "allowed", categories: [], provider: ai.provider || "local" };
}
__name(moderateChatMessage, "moderateChatMessage");
async function localChatModeration(env, request, account, message) {
  const normalized = normalizeModerationText(message);
  const categories = [];
  if (containsIllegalMinorSexualContent(normalized)) {
    return { decision: "blocked", reason: "Illegal sexual content involving minors is not allowed.", categories: ["illegal_minor_sexual_content"], provider: "local" };
  }
  const urls = message.match(/https?:\/\/\S+|www\.\S+|\b[a-z0-9.-]+\.(?:com|net|org|io|ru|xyz|top|click|shop|info|online|site|link)\b/gi) || [];
  if (urls.length > 2) {
    return { decision: "blocked", reason: "Too many links.", categories: ["spam"], provider: "local" };
  }
  const recentCutoff = new Date(Date.now() - 60 * 1e3).toISOString();
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM community_chat_messages WHERE user_id = ? AND created_at > ?
     UNION ALL
     SELECT COUNT(*) AS count FROM chat_moderation_queue WHERE user_id = ? AND created_at > ?`
  ).bind(account.user.id, recentCutoff, account.user.id, recentCutoff).all();
  const recentCount = (recent.results || []).reduce((sum, row) => sum + Number(row.count || 0), 0);
  const perMinuteLimit = Number(env.CHAT_MESSAGES_PER_MINUTE || 6);
  if (!account.permissions?.canModerate && recentCount >= perMinuteLimit) {
    return { decision: "blocked", reason: "Rate limit exceeded.", categories: ["flood"], provider: "local" };
  }
  const duplicateCutoff = new Date(Date.now() - 10 * 60 * 1e3).toISOString();
  const duplicate = await env.DB.prepare(
    `SELECT id FROM community_chat_messages WHERE user_id = ? AND body = ? AND created_at > ? LIMIT 1`
  ).bind(account.user.id, message, duplicateCutoff).first();
  if (duplicate && !account.permissions?.canModerate) {
    return { decision: "blocked", reason: "Repeated duplicate message.", categories: ["spam"], provider: "local" };
  }
  const hasNewAccount = account.user?.createdAt && Date.now() - new Date(account.user.createdAt).getTime() < 24 * 60 * 60 * 1e3;
  if (urls.length > 0 && hasNewAccount && !account.permissions?.canModerate) {
    return { decision: "quarantine", reason: "New account posted a link.", categories: ["link_review"], provider: "local" };
  }
  if (looksLikeSpamText(message)) {
    return { decision: "quarantine", reason: "Possible spam or bot-like text.", categories: ["spam"], provider: "local" };
  }
  return { decision: "allow", reason: "local allow", categories, provider: "local" };
}
__name(localChatModeration, "localChatModeration");
async function aiChatModeration(env, message) {
  if (env.CHAT_AI_MODERATION === "0" || env.CHAT_AI_MODERATION === "off") return { decision: "allow", reason: "AI moderation disabled", categories: [], provider: "disabled" };
  const system = `You moderate a small adult indie game community chat for Ravene Hub / BioPunk.
Return JSON only with this shape: {"decision":"allow|quarantine|blocked","reason":"short reason","categories":["short_category"],"confidence":0.0}.
Moderate behavior, not genre themes.
Allowed: adult fictional discussion, sex themes in the context of the game or writing, body horror, transformation, dark fiction, swearing, and criticism of the game or site.
Quarantine: targeted insults, personal attacks, bait meant to start a fight, harassment, hate toward real protected groups, suspicious links, spam-like promotion, sexual harassment, doxxing attempts, or threats that need review.
Block: obvious spam/scam, explicit threats, doxxing with private data, or sexual content involving minors.
Do not quarantine only because a message mentions sex, adult themes, horror, transformation, gore, or BioPunk content.`;
  const user = `Classify this chat message:
${message}`;
  const maxTokens = 180;
  try {
    if (env.AI?.run) {
      const model = String(env.CF_AI_MODERATION_MODEL || env.AI_MODERATION_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast");
      const result = await env.AI.run(model, {
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens,
        temperature: 0
      });
      return normalizeAiModeration(parseAiText(result), "cloudflare-workers-ai", model, result);
    }
    if (env.OPENAI_API_KEY) {
      const model = String(env.OPENAI_MODERATION_MODEL || env.AI_MODERATION_MODEL || "gpt-4o-mini");
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          temperature: 0,
          max_tokens: maxTokens,
          response_format: { type: "json_object" }
        })
      });
      if (!response.ok) throw new Error(`OpenAI moderation failed: ${response.status}`);
      const result = await response.json();
      return normalizeAiModeration(parseAiText(result), "openai", model, result);
    }
  } catch (error) {
    return { decision: "allow", reason: "AI moderation unavailable", categories: [], provider: "ai_unavailable", raw: { error: String(error?.message || error) } };
  }
  return { decision: "allow", reason: "AI moderation not configured", categories: [], provider: "not_configured" };
}
__name(aiChatModeration, "aiChatModeration");
async function translateWithAi(env, text, targetLanguage) {
  const system = `Translate the user message into ${targetLanguage}. Preserve meaning, tone, usernames, links, and line breaks. Return only the translation text. The source may include adult game discussion, horror, slang, or swearing; translate it neutrally without censoring it.`;
  const user = String(text || "").slice(0, 4e3);
  try {
    if (env.AI?.run) {
      const model = String(env.CF_AI_TRANSLATION_MODEL || env.AI_TRANSLATION_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast");
      const result = await env.AI.run(model, {
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: 900,
        temperature: 0
      });
      return { text: cleanAiText(parseAiText(result)), provider: "cloudflare-workers-ai", model };
    }
    if (env.OPENAI_API_KEY) {
      const model = String(env.OPENAI_TRANSLATION_MODEL || env.AI_TRANSLATION_MODEL || "gpt-4o-mini");
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          temperature: 0,
          max_tokens: 900
        })
      });
      if (!response.ok) throw new Error(`OpenAI translation failed: ${response.status}`);
      const result = await response.json();
      return { text: cleanAiText(parseAiText(result)), provider: "openai", model };
    }
  } catch (error) {
    return { text: "", provider: "ai_unavailable", model: "", error: String(error?.message || error) };
  }
  return { text: "", provider: "not_configured", model: "" };
}
__name(translateWithAi, "translateWithAi");
function publicQueuedChatMessage(row) {
  let categories = [];
  try {
    categories = JSON.parse(row.categories || "[]");
  } catch {
    categories = [];
  }
  return {
    id: row.id,
    body: row.body,
    decision: row.decision,
    reason: row.reason || "Needs review",
    categories,
    provider: row.provider || "local",
    model: row.model || null,
    queueType: row.queue_type || "new_message",
    sourceMessageId: row.source_message_id || null,
    previousBody: row.previous_body || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    editedAt: row.edited_at || null,
    edited: Boolean(row.edited_at || Number(row.edit_count || 0) > 0),
    authorName: row.display_name || row.email || "Ravene Hub user",
    authorEmail: row.email || ""
  };
}
__name(publicQueuedChatMessage, "publicQueuedChatMessage");
function normalizeAiModeration(text, provider, model, raw) {
  let parsed = null;
  const cleaned = cleanAiText(text).replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }
  const decision = cleanModerationDecision(parsed?.decision);
  return {
    decision: decision || "allow",
    reason: cleanLongText(parsed?.reason || "AI moderation result", 240),
    categories: Array.isArray(parsed?.categories) ? parsed.categories.map(cleanModerationCategory).filter(Boolean).slice(0, 8) : [],
    confidence: Number(parsed?.confidence || 0),
    provider,
    model,
    raw
  };
}
__name(normalizeAiModeration, "normalizeAiModeration");
function parseAiText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (typeof result.result === "string") return result.result;
  if (typeof result.output_text === "string") return result.output_text;
  const choice = result.choices?.[0]?.message?.content || result.choices?.[0]?.text;
  if (typeof choice === "string") return choice;
  if (Array.isArray(result.output)) {
    return result.output.flatMap((item) => item.content || []).map((part) => part.text || part).filter(Boolean).join("\n");
  }
  return "";
}
__name(parseAiText, "parseAiText");
function cleanAiText(value) {
  return String(value || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}
__name(cleanAiText, "cleanAiText");
function cleanModerationDecision(value) {
  const decision = String(value || "").trim().toLowerCase();
  if (["allow", "allowed", "visible"].includes(decision)) return "allow";
  if (["quarantine", "review", "pending"].includes(decision)) return "quarantine";
  if (["blocked", "block", "reject"].includes(decision)) return "blocked";
  return "";
}
__name(cleanModerationDecision, "cleanModerationDecision");
function cleanModerationCategory(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 40);
}
__name(cleanModerationCategory, "cleanModerationCategory");
function normalizeModerationText(value) {
  return String(value || "").toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}
__name(normalizeModerationText, "normalizeModerationText");
function containsIllegalMinorSexualContent(normalized) {
  const compact = normalized.replace(/[^a-zа-яё0-9]+/gi, " ");
  const minorTerms = /(minor|underage|child|kid|teen|schoolgirl|schoolboy|loli|shota|несовершеннолет|реб[её]нок|детск|школьниц|школьник|малолет)/i;
  const sexualTerms = /(sex|sexual|porn|nude|naked|cp\b|эрот|секс|порно|обнаж|изнасил|нудс|нюдс)/i;
  return minorTerms.test(compact) && sexualTerms.test(compact);
}
__name(containsIllegalMinorSexualContent, "containsIllegalMinorSexualContent");
function looksLikeSpamText(message) {
  const text = String(message || "");
  const noSpace = text.replace(/\s+/g, "");
  if (noSpace.length > 40 && /(.)\1{12,}/.test(noSpace)) return true;
  if ((text.match(/[💰🤑🔥✅👉👇🚀]/g) || []).length > 10) return true;
  if (/\b(?:free\s+money|airdrop|casino|crypto\s+profit|double\s+your|telegram\s+promo|onlyfans\s+leak)\b/i.test(text)) return true;
  if (/\b(?:заработок\s+без|казино|ставки|крипто\s*доход|раздача\s+денег|быстрый\s+заработок)\b/i.test(text)) return true;
  return false;
}
__name(looksLikeSpamText, "looksLikeSpamText");
function cleanTargetLanguage(value) {
  return String(value || "").trim().replace(/[^A-Za-zА-Яа-яЁё\-\s]/g, "").replace(/\s+/g, " ").slice(0, 40);
}
__name(cleanTargetLanguage, "cleanTargetLanguage");
function cleanRoutePart(url, offsetFromEnd) {
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.length + offsetFromEnd;
  return cleanRecordId(decodeURIComponent(parts[index] || ""));
}
__name(cleanRoutePart, "cleanRoutePart");
async function handleAdminUsersApi(request, env, url) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  if (url.pathname === "/api/admin/users" && request.method === "GET") return listAdminUsers(request, env);
  if (url.pathname.startsWith("/api/admin/users/") && request.method === "PUT") return updateUserRole(request, env, url);
  return json({ error: "Not found" }, { status: 404 });
}
__name(handleAdminUsersApi, "handleAdminUsersApi");
async function listAdminUsers(request, env) {
  const account = await requirePermission(request, env, "canManageUsers", "Admin access is required");
  if (account instanceof Response) return account;
  const rows = await env.DB.prepare(
    `SELECT users.id, users.email, users.display_name, users.avatar_url, users.created_at,
            COALESCE(user_roles.role, 'member') AS stored_role,
            (SELECT MAX(tier) FROM subscriptions WHERE subscriptions.user_id = users.id AND subscriptions.status = 'active' AND subscriptions.expires_at > datetime('now')) AS tier
     FROM users
     LEFT JOIN user_roles ON user_roles.user_id = users.id
     ORDER BY users.created_at DESC
     LIMIT 200`
  ).all();
  const users = [];
  for (const row of rows.results || []) {
    const role = await accountRole(env, row);
    users.push({
      id: row.id,
      email: row.email,
      displayName: row.display_name || row.email || "Ravene Hub user",
      avatarUrl: row.avatar_url || null,
      role,
      tier: Number(row.tier || 0),
      createdAt: row.created_at,
      isOwner: isEnvAdminEmail(env, row.email)
    });
  }
  return json({ users });
}
__name(listAdminUsers, "listAdminUsers");
async function updateUserRole(request, env, url) {
  const account = await requirePermission(request, env, "canManageUsers", "Admin access is required");
  if (account instanceof Response) return account;
  const userId = cleanRecordId(decodeURIComponent(url.pathname.split("/").pop() || ""));
  const body = await readJson(request);
  const role = cleanRole(body.role);
  if (!role || role === "guest") return json({ error: "Role must be member, moderator, or admin" }, { status: 400 });
  const target = await env.DB.prepare("SELECT id, email FROM users WHERE id = ? LIMIT 1").bind(userId).first();
  if (!target) return json({ error: "User was not found" }, { status: 404 });
  if (isEnvAdminEmail(env, target.email) && role !== "admin") {
    return json({ error: "Owner email from ADMIN_EMAILS cannot be demoted from the panel" }, { status: 400 });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(
    `INSERT INTO user_roles (user_id, role, assigned_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, assigned_by = excluded.assigned_by, updated_at = excluded.updated_at`
  ).bind(target.id, role, account.user.id, now, now).run();
  await writeModerationLog(env, {
    actorId: account.user.id,
    targetUserId: target.id,
    targetType: "user",
    targetId: target.id,
    action: "set_role",
    rawPayload: { role }
  });
  return listAdminUsers(request, env);
}
__name(updateUserRole, "updateUserRole");
async function createSessionResponse(request, env, user) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = /* @__PURE__ */ new Date();
  const expiresAt = addDays(now, SESSION_DAYS);
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, user_agent, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    randomId(),
    user.id,
    tokenHash,
    request.headers.get("user-agent") || "",
    now.toISOString(),
    expiresAt.toISOString(),
    now.toISOString()
  ).run();
  return json(
    { ok: true, userId: user.id },
    {
      headers: {
        "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}; Expires=${expiresAt.toUTCString()}`
      }
    }
  );
}
__name(createSessionResponse, "createSessionResponse");
async function logout(request, env) {
  if (env.DB) {
    const token = getCookie(request, SESSION_COOKIE);
    if (token) {
      const tokenHash = await sha256(token);
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run().catch(() => null);
    }
  }
  return json(
    { ok: true },
    {
      headers: {
        "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
      }
    }
  );
}
__name(logout, "logout");
async function moonPayPublicConfig(request, env) {
  const account = await currentAccount(request, env);
  const config = moonPayConfig(env);
  return json({
    configured: Boolean(config.paylinks[1] && config.paylinks[2]),
    authenticated: Boolean(account.authenticated),
    mode: config.mode,
    network: config.network,
    paymentType: config.paymentType,
    primaryPaymentMethod: config.primaryPaymentMethod,
    widgetScriptUrl: MOONPAY_WIDGET_SCRIPT_URL,
    plans: {
      1: moonPayPublicPlan(config, 1),
      2: moonPayPublicPlan(config, 2)
    }
  });
}
__name(moonPayPublicConfig, "moonPayPublicConfig");
async function createMoonPayCheckoutSession(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const body = await readJson(request);
  const tier = Number(body.tier || 0);
  const config = moonPayConfig(env);
  const paylinkId = config.paylinks[tier];
  if (!tier || tier < 1 || tier > 3) return json({ error: "Membership tier is invalid" }, { status: 400 });
  if (!paylinkId) return json({ error: "This MoonPay Commerce tier is not configured yet" }, { status: 503 });
  let checkoutPlan = { mode: "new", effectiveTier: 0, currentTier: 0, scheduledStartsAt: null };
  try {
    checkoutPlan = await moonPayCheckoutPlan(env, account.user.id, tier);
  } catch (error) {
    if (isMissingSchemaError(error)) return moonPayMigrationMissingResponse();
    throw error;
  }
  if (checkoutPlan.mode === "same_tier_active") {
    return json({
      error: "This membership tier is already active.",
      code: "tier_already_active",
      tier,
      currentTier: checkoutPlan.currentTier,
      expiresAt: checkoutPlan.expiresAt || null
    }, { status: 409 });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const sessionId = randomId();
  const checkoutToken = randomToken();
  try {
    await env.DB.prepare(
      `INSERT INTO moonpay_checkout_sessions
        (id, user_id, tier, paylink_id, status, checkout_token, created_at, updated_at, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sessionId,
      account.user.id,
      tier,
      paylinkId,
      "pending",
      checkoutToken,
      now,
      now,
      JSON.stringify({
        userAgent: request.headers.get("user-agent") || "",
        referer: request.headers.get("referer") || "",
        accessMode: checkoutPlan.mode,
        currentTier: checkoutPlan.currentTier || 0,
        scheduledStartsAt: checkoutPlan.scheduledStartsAt || null
      })
    ).run();
  } catch (error) {
    if (isMissingSchemaError(error)) return moonPayMigrationMissingResponse();
    throw error;
  }
  return json({
    ok: true,
    sessionId,
    checkoutToken,
    tier,
    paylinkId,
    network: config.network,
    paymentType: config.paymentType,
    primaryPaymentMethod: config.primaryPaymentMethod,
    accessMode: checkoutPlan.mode,
    currentTier: checkoutPlan.currentTier || 0,
    effectiveTier: checkoutPlan.effectiveTier || 0,
    scheduledStartsAt: checkoutPlan.scheduledStartsAt || null,
    replacesTier: checkoutPlan.replacesTier || 0,
    replacesStartsAt: checkoutPlan.replacesStartsAt || null,
    replacesExpiresAt: checkoutPlan.replacesExpiresAt || null
  });
}
__name(createMoonPayCheckoutSession, "createMoonPayCheckoutSession");
async function cancelScheduledMoonPayDowngrade(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const body = await readJson(request).catch(() => ({}));
  const keepTier = Number(body.keepTier || body.tier || 0);
  if (!keepTier || keepTier < 2) {
    return json({ error: "A higher active tier is required to cancel a scheduled downgrade." }, { status: 400 });
  }
  const effectiveAccess = await currentEffectiveSubscriptionRow(env, account.user.id);
  const effectiveTier = Number(effectiveAccess?.tier || 0);
  if (effectiveTier < keepTier) {
    return json({ error: "This higher tier is no longer active." }, { status: 409 });
  }
  const cancelled = await revokeScheduledLowerTierAccess(env, account.user.id, keepTier, (/* @__PURE__ */ new Date()).toISOString());
  if (!cancelled) {
    return json({ error: "No scheduled downgrade was found." }, { status: 404 });
  }
  return json({
    ok: true,
    cancelled,
    currentTier: effectiveTier,
    keepTier,
    message: `Scheduled downgrade cancelled. Tier ${effectiveTier} remains active until ${formatApiDate(effectiveAccess?.expires_at)}.`
  });
}
__name(cancelScheduledMoonPayDowngrade, "cancelScheduledMoonPayDowngrade");
async function cancelSubscriptionRenewal(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const access = await currentEffectiveSubscriptionRow(env, account.user.id);
  if (!access) return json({ error: "No active membership was found." }, { status: 404 });
  if (access.source !== "moonpay") {
    return json({ error: "This membership source cannot be cancelled from Ravene Hub yet." }, { status: 409 });
  }
  const existing = await activeRenewalCancellation(env, account.user.id, access);
  if (existing) {
    return json({
      ok: true,
      alreadyCancelled: true,
      expiresAt: access.expires_at,
      message: `Renewal is already cancelled. Paid access remains active until ${formatApiDate(access.expires_at)}.`
    });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const latestMoonPay = await latestMoonPaySubscription(env, account.user.id, Number(access.tier || 0));
  try {
    await insertSubscriptionControl(env, {
      userId: account.user.id,
      subscriptionId: access.id,
      moonpaySubscriptionId: latestMoonPay?.moonpay_subscription_id || null,
      tier: Number(access.tier || 0),
      action: "cancel_renewal",
      status: "active",
      effectiveAt: access.expires_at || null,
      rawPayload: {
        reason: "user_requested_cancel_at_period_end",
        note: "MoonPay public docs expose expiry-by-non-renewal, not a per-user merchant cancel endpoint."
      },
      now
    });
    if (latestMoonPay?.moonpay_subscription_id) {
      await env.DB.prepare(
        `UPDATE moonpay_subscriptions
         SET status = 'cancelled', updated_at = ?
         WHERE user_id = ? AND moonpay_subscription_id = ? AND status IN ('pending', 'active', 'renewed')`
      ).bind(now, account.user.id, latestMoonPay.moonpay_subscription_id).run();
    }
  } catch (error) {
    if (isMissingSchemaError(error, ["subscription_controls"])) return subscriptionControlsMigrationMissingResponse();
    throw error;
  }
  return json({
    ok: true,
    cancelAtPeriodEnd: true,
    tier: Number(access.tier || 0),
    expiresAt: access.expires_at,
    message: `Renewal cancelled. Paid access remains active until ${formatApiDate(access.expires_at)}.`
  });
}
__name(cancelSubscriptionRenewal, "cancelSubscriptionRenewal");
async function resumeSubscriptionRenewal(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  const access = await currentEffectiveSubscriptionRow(env, account.user.id);
  if (!access) return json({ error: "No active membership was found." }, { status: 404 });
  if (access.source !== "moonpay") {
    return json({ error: "This membership source cannot be resumed from Ravene Hub yet." }, { status: 409 });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const result = await env.DB.prepare(
      `UPDATE subscription_controls
       SET status = 'revoked', updated_at = ?
       WHERE user_id = ? AND action = 'cancel_renewal' AND status = 'active'
         AND (subscription_id = ? OR (subscription_id IS NULL AND tier = ?))`
    ).bind(now, account.user.id, access.id, Number(access.tier || 0)).run();
    const latestMoonPay = await latestMoonPaySubscription(env, account.user.id, Number(access.tier || 0));
    if (latestMoonPay?.moonpay_subscription_id) {
      await env.DB.prepare(
        `UPDATE moonpay_subscriptions
         SET status = 'active', updated_at = ?
         WHERE user_id = ? AND moonpay_subscription_id = ? AND status = 'cancelled'`
      ).bind(now, account.user.id, latestMoonPay.moonpay_subscription_id).run();
    }
    return json({
      ok: true,
      resumed: Number(result?.meta?.changes || result?.changes || 0),
      tier: Number(access.tier || 0),
      message: "Renewal resumed in Ravene Hub."
    });
  } catch (error) {
    if (isMissingSchemaError(error, ["subscription_controls"])) return subscriptionControlsMigrationMissingResponse();
    throw error;
  }
}
__name(resumeSubscriptionRenewal, "resumeSubscriptionRenewal");
async function handleMoonPayWebhook(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });
  const rawBody = await request.text();
  const payload = JSON.parse(rawBody || "{}");
  const eventType = moonPayEventType(payload);
  if (!eventType) return json({ error: "MoonPay webhook event is malformed" }, { status: 400 });
  await verifyMoonPayWebhook(request, env, rawBody);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const eventId = await moonPayWebhookEventId(request, payload, eventType, rawBody);
  try {
    await env.DB.prepare(
      "INSERT INTO webhook_events (id, provider, provider_event_id, event_type, received_at, raw_payload) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(randomId(), "moonpay", eventId, eventType, now, rawBody).run();
  } catch (error) {
    if (String(error?.message || error).includes("UNIQUE")) {
      return json({ ok: true, duplicate: true });
    }
    if (isMissingSchemaError(error)) return moonPayMigrationMissingResponse();
    throw error;
  }
  try {
    await applyMoonPayWebhookEvent(env, payload, eventType);
  } catch (error) {
    if (isMissingSchemaError(error)) return moonPayMigrationMissingResponse();
    throw error;
  }
  return json({ ok: true });
}
__name(handleMoonPayWebhook, "handleMoonPayWebhook");
async function applyMoonPayWebhookEvent(env, payload, eventType) {
  const details = await resolveMoonPayDetails(env, moonPayPayloadDetails(env, payload));
  if (eventType === "STARTED" || eventType === "RENEWED") {
    const providerStatus = eventType === "RENEWED" ? "renewed" : "active";
    await upsertMoonPaySubscription(env, details, providerStatus, payload);
    await recordMoonPayPayment(env, details, payload, eventType);
    if (details.userId && details.tier) {
      await grantMoonPayAccess(env, details.userId, details.tier, details, payload);
    }
    return;
  }
  if (eventType === "ENDED" || eventType === "EXPIRED" || eventType === "CANCELLED") {
    await endMoonPayAccess(env, details, eventType, payload);
  }
}
__name(applyMoonPayWebhookEvent, "applyMoonPayWebhookEvent");
async function resolveMoonPayDetails(env, details) {
  let userId = details.userId;
  let tier = details.tier;
  let paylinkId = details.paylinkId;
  let checkoutSessionId = details.checkoutSessionId;
  const session = await moonPayCheckoutSession(env, checkoutSessionId, details.checkoutToken);
  if (session) {
    userId = userId || session.user_id;
    tier = Number(session.tier || 0) || tier;
    paylinkId = paylinkId || session.paylink_id;
    checkoutSessionId = checkoutSessionId || session.id;
    const sessionMeta = parseObject(session.raw_payload) || {};
    details.accessMode = details.accessMode || sessionMeta.accessMode || null;
    details.sessionCurrentTier = Number(details.sessionCurrentTier || sessionMeta.currentTier || 0);
  }
  if (paylinkId) tier = tierForMoonPayPaylink(env, paylinkId) || tier;
  if (!userId && details.subscriptionId) {
    const existing = await env.DB.prepare(
      "SELECT user_id, tier, paylink_id, checkout_session_id FROM moonpay_subscriptions WHERE moonpay_subscription_id = ? LIMIT 1"
    ).bind(details.subscriptionId).first();
    if (existing) {
      userId = userId || existing.user_id;
      tier = tier || Number(existing.tier || 0);
      paylinkId = paylinkId || existing.paylink_id;
      checkoutSessionId = checkoutSessionId || existing.checkout_session_id;
    }
  }
  if (!userId && details.email) {
    const user = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ? LIMIT 1").bind(details.email).first();
    userId = user?.id || null;
  }
  return {
    ...details,
    userId: cleanRecordId(userId),
    tier: Number(tier || 0),
    paylinkId: cleanMoonPayId(paylinkId),
    checkoutSessionId: cleanRecordId(checkoutSessionId)
  };
}
__name(resolveMoonPayDetails, "resolveMoonPayDetails");
async function moonPayCheckoutSession(env, sessionId, checkoutToken) {
  const token = cleanMoonPayToken(checkoutToken);
  if (token) {
    const row = await env.DB.prepare(
      "SELECT id, user_id, tier, paylink_id, status, raw_payload FROM moonpay_checkout_sessions WHERE checkout_token = ? LIMIT 1"
    ).bind(token).first();
    if (row) return row;
  }
  const id = cleanRecordId(sessionId);
  if (!id) return null;
  return env.DB.prepare(
    "SELECT id, user_id, tier, paylink_id, status, raw_payload FROM moonpay_checkout_sessions WHERE id = ? LIMIT 1"
  ).bind(id).first();
}
__name(moonPayCheckoutSession, "moonPayCheckoutSession");
async function grantMoonPayAccess(env, userId, tier, details, payload) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const blockingAccess = await activeBlockingSubscriptionForTier(env, userId, tier);
  const startsAt = blockingAccess?.expires_at || details.createdAt || now;
  let expiresAt = details.renewalDate || addDays(new Date(startsAt), MOONPAY_SUBSCRIPTION_DAYS_FALLBACK).toISOString();
  if (new Date(expiresAt).getTime() <= new Date(startsAt).getTime()) {
    expiresAt = addDays(new Date(startsAt), MOONPAY_SUBSCRIPTION_DAYS_FALLBACK).toISOString();
  }
  const existingMoonPayAccess = await env.DB.prepare(
    `SELECT id, starts_at, expires_at
     FROM subscriptions
     WHERE user_id = ? AND tier = ? AND source = 'moonpay' AND status = 'active' AND expires_at > ?
     ORDER BY expires_at DESC
     LIMIT 1`
  ).bind(userId, tier, now).first();
  if (existingMoonPayAccess) {
    const nextStartsAt = earlierIso(existingMoonPayAccess.starts_at, startsAt);
    const nextExpiresAt = laterIso(existingMoonPayAccess.expires_at, expiresAt);
    await env.DB.prepare(
      "UPDATE subscriptions SET starts_at = ?, expires_at = ?, updated_at = ? WHERE id = ?"
    ).bind(nextStartsAt, nextExpiresAt, now, existingMoonPayAccess.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO subscriptions (id, user_id, tier, status, source, starts_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(randomId(), userId, tier, "active", "moonpay", startsAt, expiresAt, now, now).run();
  }
  if (Number(tier || 0) > 1) {
    await revokeScheduledLowerTierAccess(env, userId, Number(tier), now);
    if (details.accessMode === "upgrade_immediate") {
      await supersedeActiveLowerTierAccess(env, userId, Number(tier), now, details, payload);
    }
  }
  if (details.checkoutSessionId || details.checkoutToken) {
    await markMoonPayCheckoutSession(env, details, "active", now, payload);
  }
  return { startsAt, expiresAt };
}
__name(grantMoonPayAccess, "grantMoonPayAccess");
async function endMoonPayAccess(env, details, eventType, payload) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const subscriptionId = moonPaySubscriptionRecordId(details);
  let existing = null;
  if (subscriptionId) {
    existing = await env.DB.prepare(
      "SELECT user_id, tier FROM moonpay_subscriptions WHERE moonpay_subscription_id = ? LIMIT 1"
    ).bind(subscriptionId).first();
  }
  const userId = details.userId || existing?.user_id || null;
  const tier = details.tier || Number(existing?.tier || 0);
  if (subscriptionId && tier) {
    await upsertMoonPaySubscription(env, { ...details, userId, tier, subscriptionId }, moonPayEndedStatus(eventType), payload);
  }
  if (!userId) return;
  await env.DB.prepare(
    "UPDATE subscriptions SET status = ?, updated_at = ? WHERE user_id = ? AND source = 'moonpay' AND tier = ? AND status = 'active'"
  ).bind(eventType === "ENDED" || eventType === "EXPIRED" ? "expired" : "revoked", now, userId, tier).run();
  if (details.checkoutSessionId || details.checkoutToken) {
    await markMoonPayCheckoutSession(env, details, "ended", now, payload);
  }
}
__name(endMoonPayAccess, "endMoonPayAccess");
async function upsertMoonPaySubscription(env, details, status, payload) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const subscriptionId = moonPaySubscriptionRecordId(details);
  const tier = Number(details.tier || 0);
  if (!subscriptionId || !tier) return;
  const existing = await env.DB.prepare(
    "SELECT id, user_id FROM moonpay_subscriptions WHERE moonpay_subscription_id = ? LIMIT 1"
  ).bind(subscriptionId).first();
  const rawPayload = JSON.stringify(payload || {});
  const userId = details.userId || null;
  if (existing) {
    await env.DB.prepare(
      `UPDATE moonpay_subscriptions
       SET user_id = COALESCE(?, user_id), tier = ?, paylink_id = ?, status = ?, customer_email = COALESCE(?, customer_email),
           payer_wallet = COALESCE(?, payer_wallet), checkout_session_id = COALESCE(?, checkout_session_id), renewal_date = COALESCE(?, renewal_date),
           raw_payload = ?, updated_at = ?
       WHERE id = ?`
    ).bind(
      userId,
      tier,
      details.paylinkId || "",
      status,
      details.email || null,
      details.payerWallet || null,
      details.checkoutSessionId || null,
      details.renewalDate || null,
      rawPayload,
      now,
      existing.id
    ).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO moonpay_subscriptions
      (id, user_id, tier, moonpay_subscription_id, paylink_id, status, customer_email, payer_wallet, checkout_session_id, renewal_date, raw_payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    randomId(),
    userId,
    tier,
    subscriptionId,
    details.paylinkId || "",
    status,
    details.email || null,
    details.payerWallet || null,
    details.checkoutSessionId || null,
    details.renewalDate || null,
    rawPayload,
    now,
    now
  ).run();
}
__name(upsertMoonPaySubscription, "upsertMoonPaySubscription");
async function recordMoonPayPayment(env, details, payload, eventType) {
  const paymentId = cleanMoonPayId(details.transactionSignature) || cleanMoonPayId(details.transactionId) || cleanMoonPayId(`${details.subscriptionId || "subscription"}-${eventType}-${details.renewalDate || Date.now()}`);
  if (!paymentId || eventType === "ENDED" || eventType === "EXPIRED" || eventType === "CANCELLED") return;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO payments
        (id, user_id, provider, provider_payment_id, tier, amount_cents, currency, status, paid_at, raw_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      randomId(),
      details.userId || null,
      "moonpay",
      paymentId,
      Number(details.tier || 1),
      details.amountCents,
      details.currency || null,
      details.transactionStatus || "completed",
      details.transactionCreatedAt || details.createdAt || now,
      JSON.stringify(payload || {}),
      now
    ).run();
  } catch (error) {
    if (!String(error?.message || error).includes("UNIQUE")) throw error;
  }
}
__name(recordMoonPayPayment, "recordMoonPayPayment");
async function markMoonPayCheckoutSession(env, details, status, now, payload) {
  const token = cleanMoonPayToken(details.checkoutToken);
  const id = cleanRecordId(details.checkoutSessionId);
  if (!token && !id) return;
  const where = token ? "checkout_token = ?" : "id = ?";
  await env.DB.prepare(
    `UPDATE moonpay_checkout_sessions
     SET status = ?, completed_at = COALESCE(completed_at, ?), raw_payload = ?, updated_at = ?
     WHERE ${where}`
  ).bind(status, now, JSON.stringify(payload || {}), now, token || id).run();
}
__name(markMoonPayCheckoutSession, "markMoonPayCheckoutSession");
async function verifyMoonPayWebhook(request, env, rawBody) {
  if (env.MOONPAY_SKIP_WEBHOOK_VERIFICATION === "1" || env.HELIO_SKIP_WEBHOOK_VERIFICATION === "1") return;
  const tokens = moonPayWebhookTokens(env);
  if (!tokens.length) throw new Error("MOONPAY_WEBHOOK_SHARED_TOKEN is not configured");
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const token = await matchingMoonPayWebhookToken(tokens, bearer);
  if (!token) throw new Error("MoonPay webhook bearer token is invalid");
  const signature = String(request.headers.get("x-signature") || "").trim();
  if (!signature) return;
  const expected = await hmacSha256Hex(token, rawBody);
  if (!safeHexEqual(signature, expected)) {
    throw new Error("MoonPay webhook signature is invalid");
  }
}
__name(verifyMoonPayWebhook, "verifyMoonPayWebhook");
async function matchingMoonPayWebhookToken(tokens, received) {
  if (!received) return null;
  const receivedHash = await sha256(received);
  for (const token of tokens) {
    if (receivedHash === await sha256(token)) return token;
  }
  return null;
}
__name(matchingMoonPayWebhookToken, "matchingMoonPayWebhookToken");
async function moonPayWebhookEventId(request, payload, eventType, rawBody) {
  const transaction = moonPayTransactionObject(payload);
  const meta = transaction?.meta || payload.meta || {};
  return cleanMoonPayId(
    request.headers.get("x-webhook-delivery-id") || request.headers.get("x-transaction-id") || payload.webhookDeliveryIdempotencyKey || payload.txIdempotencyKey || payload.eventId || transaction?.id || meta.transactionSignature || payload.id || `${eventType}-${await sha256(rawBody)}`
  );
}
__name(moonPayWebhookEventId, "moonPayWebhookEventId");
function moonPayPayloadDetails(env, payload) {
  const transaction = moonPayTransactionObject(payload);
  const meta = transaction?.meta || payload.meta || payload.data?.meta || {};
  const customer = meta.customerDetails || transaction?.customerDetails || payload.customerDetails || payload.data?.customerDetails || {};
  const subscription = payload.subscription || payload.subscriptionObject || payload.data?.subscription || payload.data?.subscriptionObject || {};
  const additional = parseMoonPayAdditionalJSON(
    customer.additionalJSON ?? meta.additionalJSON ?? transaction?.additionalJSON ?? payload.additionalJSON ?? payload.data?.additionalJSON
  );
  const paylinkId = cleanMoonPayId(
    payload.paylinkId || payload.paylink || payload.data?.paylinkId || subscription.paylinkId || subscription.paylink || transaction?.paylinkId || transaction?.paylink
  );
  const tier = Number(
    tierForMoonPayPaylink(env, paylinkId) || payload.tier || payload.data?.tier || additional.tier || additional.planTier || 0
  );
  const email = normalizeEmail(
    customer.email || subscription.email || payload.email || payload.data?.email || additional.accountEmail || additional.email
  );
  const transactionSignature = cleanMoonPayId(
    meta.transactionSignature || payload.transactionSignature || payload.data?.transactionSignature
  );
  return {
    event: moonPayEventType(payload),
    subscriptionId: cleanMoonPayId(
      payload.subscriptionId || payload.paystreamId || payload.data?.subscriptionId || subscription.id || subscription.subscriptionId || (payload.status || payload.renewalDate ? payload.id : "")
    ),
    transactionId: cleanMoonPayId(transaction?.id || meta.id || payload.transactionId || payload.data?.transactionId),
    transactionSignature,
    transactionStatus: String(meta.transactionStatus || payload.transactionStatus || payload.status || "completed").toLowerCase(),
    transactionCreatedAt: cleanIsoDate(transaction?.createdAt || meta.createdAt || payload.transactionCreatedAt),
    paylinkId,
    tier,
    userId: cleanRecordId(additional.userId || additional.customerId || payload.userId || payload.data?.userId),
    checkoutSessionId: cleanRecordId(additional.checkoutSessionId || additional.sessionId || payload.checkoutSessionId || payload.data?.checkoutSessionId),
    checkoutToken: cleanMoonPayToken(additional.checkoutToken || payload.checkoutToken || payload.data?.checkoutToken),
    accessMode: String(additional.accessMode || payload.accessMode || payload.data?.accessMode || "").trim() || null,
    email,
    payerWallet: cleanWallet(meta.senderPK || payload.senderPK || payload.payerWallet || payload.walletAddress || customer.walletAddress),
    renewalDate: cleanIsoDate(payload.renewalDate || payload.data?.renewalDate || subscription.renewalDate || payload.currentPeriodEnd || payload.expiresAt),
    createdAt: cleanIsoDate(payload.createdAt || payload.data?.createdAt || subscription.createdAt || transaction?.createdAt),
    amountCents: moonPayAmountCents(meta),
    currency: cleanCurrency(meta.tokenQuote?.from || meta.currency?.symbol || payload.currency?.symbol || payload.currency),
    additional
  };
}
__name(moonPayPayloadDetails, "moonPayPayloadDetails");
function moonPayTransactionObject(payload) {
  return parseObject(payload.transactionObject) || parseObject(payload.transaction) || parseObject(payload.data?.transactionObject) || parseObject(payload.data?.transaction) || parseObject(payload.resource?.transactionObject) || parseObject(payload.resource?.transaction) || null;
}
__name(moonPayTransactionObject, "moonPayTransactionObject");
function moonPayEventType(payload) {
  const value = String(payload.event || payload.eventType || payload.event_type || payload.type || payload.data?.event || "").trim().toUpperCase();
  if (value) return value;
  const status = String(payload.status || payload.data?.status || "").trim().toUpperCase();
  if (status === "ACTIVE") return "STARTED";
  if (status === "EXPIRED") return "ENDED";
  return "";
}
__name(moonPayEventType, "moonPayEventType");
function moonPaySubscriptionRecordId(details) {
  return cleanMoonPayId(details.subscriptionId) || (cleanMoonPayId(details.transactionId) ? `tx_${cleanMoonPayId(details.transactionId)}` : "");
}
__name(moonPaySubscriptionRecordId, "moonPaySubscriptionRecordId");
function moonPayEndedStatus(eventType) {
  if (eventType === "EXPIRED" || eventType === "ENDED") return "expired";
  if (eventType === "CANCELLED") return "cancelled";
  return "ended";
}
__name(moonPayEndedStatus, "moonPayEndedStatus");
function moonPayPublicPlan(config, tier) {
  const paylinkId = config.paylinks[tier] || "";
  if (!paylinkId) return null;
  return {
    paylinkId,
    checkoutUrl: config.checkoutUrls[tier] || moonPayHostedUrl(config, paylinkId)
  };
}
__name(moonPayPublicPlan, "moonPayPublicPlan");
function moonPayHostedUrl(config, paylinkId) {
  const base = config.checkoutBaseUrl || (config.network === "test" ? "https://app.dev.hel.io/pay/" : "https://app.hel.io/pay/");
  return `${base.replace(/\/+$/, "")}/${encodeURIComponent(paylinkId)}`;
}
__name(moonPayHostedUrl, "moonPayHostedUrl");
function moonPayConfig(env) {
  const rawMode = String(env.MOONPAY_MODE || env.HELIO_MODE || "test").trim().toLowerCase();
  const mode = MOONPAY_ALLOWED_MODES.has(rawMode) ? rawMode : "test";
  const network = cleanMoonPayNetwork(env.MOONPAY_NETWORK || env.HELIO_NETWORK) || (mode === "live" ? "main" : "test");
  const paymentType = String(env.MOONPAY_PAYMENT_TYPE || env.HELIO_PAYMENT_TYPE || "paylink").trim() === "paystream" ? "paystream" : "paylink";
  const primaryPaymentMethod = String(env.MOONPAY_PRIMARY_PAYMENT_METHOD || env.HELIO_PRIMARY_PAYMENT_METHOD || "crypto").trim() === "fiat" ? "fiat" : "crypto";
  return {
    mode,
    network,
    paymentType,
    primaryPaymentMethod,
    checkoutBaseUrl: cleanUrl(env.MOONPAY_CHECKOUT_BASE_URL || env.HELIO_CHECKOUT_BASE_URL),
    paylinks: {
      1: cleanMoonPayId(env.MOONPAY_TIER_1_PAYLINK_ID || env.HELIO_TIER_1_PAYLINK_ID),
      2: cleanMoonPayId(env.MOONPAY_TIER_2_PAYLINK_ID || env.HELIO_TIER_2_PAYLINK_ID),
      3: cleanMoonPayId(env.MOONPAY_TIER_3_PAYLINK_ID || env.HELIO_TIER_3_PAYLINK_ID)
    },
    checkoutUrls: {
      1: cleanUrl(env.MOONPAY_TIER_1_CHECKOUT_URL || env.HELIO_TIER_1_CHECKOUT_URL),
      2: cleanUrl(env.MOONPAY_TIER_2_CHECKOUT_URL || env.HELIO_TIER_2_CHECKOUT_URL),
      3: cleanUrl(env.MOONPAY_TIER_3_CHECKOUT_URL || env.HELIO_TIER_3_CHECKOUT_URL)
    }
  };
}
__name(moonPayConfig, "moonPayConfig");
function moonPayWebhookTokens(env) {
  return [
    env.MOONPAY_WEBHOOK_SHARED_TOKEN,
    env.HELIO_WEBHOOK_SHARED_TOKEN,
    env.MOONPAY_TIER_1_WEBHOOK_TOKEN,
    env.MOONPAY_TIER_2_WEBHOOK_TOKEN,
    env.MOONPAY_TIER_3_WEBHOOK_TOKEN,
    env.HELIO_TIER_1_WEBHOOK_TOKEN,
    env.HELIO_TIER_2_WEBHOOK_TOKEN,
    env.HELIO_TIER_3_WEBHOOK_TOKEN
  ].map((value) => String(value || "").trim()).filter(Boolean);
}
__name(moonPayWebhookTokens, "moonPayWebhookTokens");
function tierForMoonPayPaylink(env, paylinkId) {
  const cleanPaylinkId = cleanMoonPayId(paylinkId);
  const config = moonPayConfig(env);
  return [1, 2, 3].find((tier) => config.paylinks[tier] && config.paylinks[tier] === cleanPaylinkId) || 0;
}
__name(tierForMoonPayPaylink, "tierForMoonPayPaylink");
function parseMoonPayAdditionalJSON(value) {
  let current = value;
  for (let index = 0; index < 4; index += 1) {
    if (!current) return {};
    if (typeof current === "object") return current;
    if (typeof current !== "string") return {};
    const trimmed = current.trim();
    if (!trimmed) return {};
    try {
      current = JSON.parse(trimmed);
    } catch {
      return {};
    }
  }
  return typeof current === "object" && current ? current : {};
}
__name(parseMoonPayAdditionalJSON, "parseMoonPayAdditionalJSON");
function parseObject(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
__name(parseObject, "parseObject");
function moonPayAmountCents(meta) {
  const decimal = Number(meta?.tokenQuote?.fromAmountDecimal || meta?.tokenQuote?.toAmountDecimal || NaN);
  return Number.isFinite(decimal) ? Math.round(decimal * 100) : null;
}
__name(moonPayAmountCents, "moonPayAmountCents");
function cleanMoonPayId(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 160);
}
__name(cleanMoonPayId, "cleanMoonPayId");
function cleanMoonPayToken(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 160);
}
__name(cleanMoonPayToken, "cleanMoonPayToken");
function cleanRecordId(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80);
}
__name(cleanRecordId, "cleanRecordId");
function cleanWallet(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 160) || null;
}
__name(cleanWallet, "cleanWallet");
function cleanCurrency(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 24).toUpperCase() || null;
}
__name(cleanCurrency, "cleanCurrency");
function cleanUrl(value, maxLength = 500) {
  const text = String(value || "").trim().slice(0, maxLength);
  if (!text) return "";
  if (/^https:\/\//i.test(text)) {
    try {
      return new URL(text).toString();
    } catch {
      return "";
    }
  }
  if (/^assets\//i.test(text) || /^builds\//i.test(text)) return text;
  return "";
}
__name(cleanUrl, "cleanUrl");
function cleanMoonPayNetwork(value) {
  const network = String(value || "").trim().toLowerCase();
  return network === "main" || network === "test" ? network : "";
}
__name(cleanMoonPayNetwork, "cleanMoonPayNetwork");
function cleanIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
__name(cleanIsoDate, "cleanIsoDate");
async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(hmacSha256Hex, "hmacSha256Hex");
function safeHexEqual(a, b) {
  const left = hexToBytes(a);
  const right = hexToBytes(b);
  if (!left || !right) return false;
  return timingSafeEqual(left, right);
}
__name(safeHexEqual, "safeHexEqual");
function hexToBytes(value) {
  const clean = String(value || "").trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < clean.length; index += 2) {
    bytes[index / 2] = Number.parseInt(clean.slice(index, index + 2), 16);
  }
  return bytes;
}
__name(hexToBytes, "hexToBytes");
async function upsertUser(env, input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const email = input.email || null;
  const displayName = input.displayName || email || null;
  if (email) {
    const existing = await env.DB.prepare("SELECT * FROM users WHERE email = ? LIMIT 1").bind(email).first();
    if (existing) {
      await env.DB.prepare("UPDATE users SET display_name = COALESCE(?, display_name), updated_at = ? WHERE id = ?").bind(displayName, now, existing.id).run();
      return { ...existing, display_name: displayName || existing.display_name };
    }
  }
  const user = {
    id: randomId(),
    email,
    display_name: displayName,
    avatar_url: null,
    created_at: now,
    updated_at: now
  };
  await env.DB.prepare(
    "INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(user.id, user.email, user.display_name, user.avatar_url, user.created_at, user.updated_at).run();
  return user;
}
__name(upsertUser, "upsertUser");
async function upsertIdentity(env, userId, identity) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = await env.DB.prepare(
    "SELECT id FROM user_identities WHERE provider = ? AND provider_user_id = ? LIMIT 1"
  ).bind(identity.provider, identity.providerUserId).first();
  if (existing) {
    await env.DB.prepare(
      "UPDATE user_identities SET user_id = ?, provider_username = ?, updated_at = ? WHERE id = ?"
    ).bind(userId, identity.providerUsername || null, now, existing.id).run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO user_identities (id, user_id, provider, provider_user_id, provider_username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    randomId(),
    userId,
    identity.provider,
    identity.providerUserId,
    identity.providerUsername || null,
    now,
    now
  ).run();
}
__name(upsertIdentity, "upsertIdentity");
async function activeSubscription(env, userId) {
  let row = null;
  try {
    row = await currentEffectiveSubscriptionRow(env, userId);
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return emptySubscription();
    }
    throw error;
  }
  const latestMoonPay = await latestMoonPaySubscription(env, userId);
  const scheduledDowngrade = row ? await scheduledLowerTierAccess(env, userId, Number(row.tier || 0)) : null;
  if (!row) {
    return emptySubscription(latestMoonPay);
  }
  const cancellation = await activeRenewalCancellation(env, userId, row);
  const renewalStatus = cancellation ? "cancelled" : latestMoonPay?.status || (row.source === "moonpay" ? "active" : row.status);
  return {
    tier: Number(row.tier),
    status: row.status,
    source: row.source,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    canReadLocked: Number(row.tier) >= 1,
    canLaunchBuilds: Number(row.tier) >= 2,
    paymentSource: row.source,
    renewalStatus,
    cancelAtPeriodEnd: Boolean(cancellation),
    cancellationRequestedAt: cancellation?.created_at || null,
    cancellationEffectiveAt: cancellation?.effective_at || row.expires_at || null,
    moonpayTier: latestMoonPay ? Number(latestMoonPay.tier || 0) : 0,
    moonpaySubscriptionId: latestMoonPay?.moonpay_subscription_id || null,
    moonpayCustomerEmail: latestMoonPay?.customer_email || null,
    moonpayPayerWallet: latestMoonPay?.payer_wallet || null,
    moonpayRenewalDate: latestMoonPay?.renewal_date || null,
    scheduledDowngrade: scheduledDowngrade ? publicScheduledSubscription(scheduledDowngrade) : null,
    canCancelRenewal: row.source === "moonpay" && !cancellation,
    canResumeRenewal: row.source === "moonpay" && Boolean(cancellation)
  };
}
__name(activeSubscription, "activeSubscription");
async function moonPayCheckoutPlan(env, userId, requestedTier) {
  const effectiveAccess = await currentEffectiveSubscriptionRow(env, userId);
  const effectiveTier = Number(effectiveAccess?.tier || 0);
  const [sameTierAccess, blockingAccess, scheduledDowngrade] = await Promise.all([
    notExpiredSubscriptionForTier(env, userId, requestedTier),
    activeBlockingSubscriptionForTier(env, userId, requestedTier),
    scheduledLowerTierAccess(env, userId, effectiveTier)
  ]);
  if (sameTierAccess) {
    if (effectiveTier === requestedTier && scheduledDowngrade && Number(scheduledDowngrade.tier || 0) < requestedTier) {
      return {
        mode: "return_to_current_tier",
        effectiveTier,
        currentTier: effectiveTier,
        expiresAt: effectiveAccess?.expires_at || sameTierAccess.expires_at || null,
        scheduledStartsAt: effectiveAccess?.expires_at || null,
        replacesTier: Number(scheduledDowngrade.tier || 0),
        replacesStartsAt: scheduledDowngrade.starts_at || null,
        replacesExpiresAt: scheduledDowngrade.expires_at || null
      };
    }
    return {
      mode: "same_tier_active",
      effectiveTier,
      currentTier: Number(sameTierAccess.tier || requestedTier),
      expiresAt: sameTierAccess.expires_at || null,
      scheduledStartsAt: null
    };
  }
  if (blockingAccess && Number(blockingAccess.tier || 0) > requestedTier) {
    return {
      mode: "downgrade_after_current_period",
      effectiveTier,
      currentTier: Number(blockingAccess.tier || 0),
      expiresAt: blockingAccess.expires_at || null,
      scheduledStartsAt: blockingAccess.expires_at || null
    };
  }
  if (effectiveTier > 0 && requestedTier > effectiveTier) {
    return { mode: "upgrade_immediate", effectiveTier, currentTier: effectiveTier, scheduledStartsAt: null };
  }
  return { mode: "new", effectiveTier, currentTier: effectiveTier, scheduledStartsAt: null };
}
__name(moonPayCheckoutPlan, "moonPayCheckoutPlan");
async function currentEffectiveSubscriptionRow(env, userId) {
  if (!env.DB) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return env.DB.prepare(
    `SELECT id, tier, status, source, starts_at, expires_at
     FROM subscriptions
     WHERE user_id = ? AND status = 'active' AND starts_at <= ? AND expires_at > ?
     ORDER BY tier DESC, expires_at DESC
     LIMIT 1`
  ).bind(userId, now, now).first();
}
__name(currentEffectiveSubscriptionRow, "currentEffectiveSubscriptionRow");
async function notExpiredSubscriptionForTier(env, userId, tier) {
  if (!env.DB) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return env.DB.prepare(
    `SELECT id, tier, status, source, starts_at, expires_at
     FROM subscriptions
     WHERE user_id = ? AND tier = ? AND status = 'active' AND expires_at > ?
     ORDER BY starts_at DESC, expires_at DESC
     LIMIT 1`
  ).bind(userId, tier, now).first();
}
__name(notExpiredSubscriptionForTier, "notExpiredSubscriptionForTier");
async function activeBlockingSubscriptionForTier(env, userId, tier) {
  if (!env.DB) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return env.DB.prepare(
    `SELECT id, tier, status, source, starts_at, expires_at
     FROM subscriptions
     WHERE user_id = ? AND status = 'active' AND starts_at <= ? AND expires_at > ? AND tier >= ?
     ORDER BY tier DESC, expires_at DESC
     LIMIT 1`
  ).bind(userId, now, now, tier).first();
}
__name(activeBlockingSubscriptionForTier, "activeBlockingSubscriptionForTier");
async function scheduledLowerTierAccess(env, userId, currentTier) {
  if (!env.DB || Number(currentTier || 0) <= 1) return null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return env.DB.prepare(
    `SELECT id, tier, status, source, starts_at, expires_at
     FROM subscriptions
     WHERE user_id = ? AND status = 'active' AND starts_at > ? AND expires_at > ? AND tier < ?
     ORDER BY starts_at ASC, tier DESC, expires_at DESC
     LIMIT 1`
  ).bind(userId, now, now, currentTier).first();
}
__name(scheduledLowerTierAccess, "scheduledLowerTierAccess");
async function revokeScheduledLowerTierAccess(env, userId, keepTier, now = (/* @__PURE__ */ new Date()).toISOString()) {
  if (!env.DB || Number(keepTier || 0) <= 1) return 0;
  const result = await env.DB.prepare(
    `UPDATE subscriptions
     SET status = 'revoked', updated_at = ?
     WHERE user_id = ? AND status = 'active' AND starts_at > ? AND expires_at > ? AND tier < ?`
  ).bind(now, userId, now, now, keepTier).run();
  return Number(result?.meta?.changes || result?.changes || 0);
}
__name(revokeScheduledLowerTierAccess, "revokeScheduledLowerTierAccess");
async function activeRenewalCancellation(env, userId, accessRow) {
  if (!env.DB || !accessRow?.id) return null;
  try {
    return await env.DB.prepare(
      `SELECT id, subscription_id, moonpay_subscription_id, tier, action, status, effective_at, created_at
       FROM subscription_controls
       WHERE user_id = ? AND action = 'cancel_renewal' AND status = 'active'
         AND (subscription_id = ? OR (subscription_id IS NULL AND tier = ?))
       ORDER BY created_at DESC
       LIMIT 1`
    ).bind(userId, accessRow.id, Number(accessRow.tier || 0)).first();
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}
__name(activeRenewalCancellation, "activeRenewalCancellation");
async function insertSubscriptionControl(env, { userId, subscriptionId = null, moonpaySubscriptionId = null, tier = null, action, status = "active", effectiveAt = null, rawPayload = {}, now = (/* @__PURE__ */ new Date()).toISOString() }) {
  return env.DB.prepare(
    `INSERT INTO subscription_controls
      (id, user_id, subscription_id, moonpay_subscription_id, tier, action, status, effective_at, created_at, updated_at, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    randomId(),
    userId,
    subscriptionId,
    moonpaySubscriptionId,
    tier ? Number(tier) : null,
    action,
    status,
    effectiveAt,
    now,
    now,
    JSON.stringify(rawPayload || {})
  ).run();
}
__name(insertSubscriptionControl, "insertSubscriptionControl");
async function supersedeActiveLowerTierAccess(env, userId, newTier, now, details = {}, payload = {}) {
  const rows = await env.DB.prepare(
    `SELECT id, tier, source, starts_at, expires_at
     FROM subscriptions
     WHERE user_id = ? AND status = 'active' AND starts_at <= ? AND expires_at > ? AND tier < ?
     ORDER BY tier DESC, expires_at DESC`
  ).bind(userId, now, now, Number(newTier || 0)).all();
  const lowerAccess = rows?.results || [];
  if (!lowerAccess.length) return 0;
  for (const row of lowerAccess) {
    await env.DB.prepare(
      "UPDATE subscriptions SET status = 'revoked', updated_at = ? WHERE id = ? AND status = 'active'"
    ).bind(now, row.id).run();
    try {
      const latestLowerMoonPay = row.source === "moonpay" ? await latestMoonPaySubscription(env, userId, Number(row.tier || 0)) : null;
      await insertSubscriptionControl(env, {
        userId,
        subscriptionId: row.id,
        moonpaySubscriptionId: latestLowerMoonPay?.moonpay_subscription_id || null,
        tier: Number(row.tier || 0),
        action: "superseded_by_upgrade",
        status: "completed",
        effectiveAt: now,
        rawPayload: {
          newTier: Number(newTier || 0),
          newMoonPaySubscriptionId: moonPaySubscriptionRecordId(details) || null,
          checkoutSessionId: details.checkoutSessionId || null,
          originalExpiresAt: row.expires_at || null,
          payloadEvent: moonPayEventType(payload) || null
        },
        now
      });
      if (latestLowerMoonPay?.moonpay_subscription_id) {
        await env.DB.prepare(
          `UPDATE moonpay_subscriptions
           SET status = 'cancelled', updated_at = ?
           WHERE user_id = ? AND moonpay_subscription_id = ? AND status IN ('pending', 'active', 'renewed')`
        ).bind(now, userId, latestLowerMoonPay.moonpay_subscription_id).run();
      }
    } catch (error) {
      if (!isMissingSchemaError(error, ["subscription_controls"])) throw error;
    }
  }
  return lowerAccess.length;
}
__name(supersedeActiveLowerTierAccess, "supersedeActiveLowerTierAccess");
function publicScheduledSubscription(row) {
  return {
    tier: Number(row.tier || 0),
    status: row.status || "active",
    source: row.source || null,
    startsAt: row.starts_at || null,
    expiresAt: row.expires_at || null
  };
}
__name(publicScheduledSubscription, "publicScheduledSubscription");
function formatApiDate(value) {
  return value || "the current period end";
}
__name(formatApiDate, "formatApiDate");
async function latestMoonPaySubscription(env, userId, tier = null) {
  if (!env.DB) return null;
  const tierFilter = tier ? "AND tier = ?" : "";
  try {
    const statement = env.DB.prepare(
      `SELECT moonpay_subscription_id, tier, status, customer_email, payer_wallet, renewal_date, updated_at
       FROM moonpay_subscriptions
       WHERE user_id = ? ${tierFilter}
       ORDER BY
         CASE status
           WHEN 'active' THEN 1
           WHEN 'renewed' THEN 2
           WHEN 'pending' THEN 3
           WHEN 'cancelled' THEN 4
           WHEN 'expired' THEN 5
           ELSE 6
         END,
         updated_at DESC
       LIMIT 1`
    );
    return await (tier ? statement.bind(userId, tier).first() : statement.bind(userId).first());
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}
__name(latestMoonPaySubscription, "latestMoonPaySubscription");
function emptySubscription(latestMoonPay = null) {
  return {
    tier: 0,
    status: latestMoonPay?.status || "none",
    source: latestMoonPay ? "moonpay" : null,
    startsAt: null,
    expiresAt: null,
    canReadLocked: false,
    canLaunchBuilds: false,
    paymentSource: latestMoonPay ? "moonpay" : null,
    renewalStatus: latestMoonPay?.status || "none",
    moonpayTier: latestMoonPay ? Number(latestMoonPay.tier || 0) : 0,
    moonpaySubscriptionId: latestMoonPay?.moonpay_subscription_id || null,
    moonpayCustomerEmail: latestMoonPay?.customer_email || null,
    moonpayPayerWallet: latestMoonPay?.payer_wallet || null,
    moonpayRenewalDate: latestMoonPay?.renewal_date || null,
    scheduledDowngrade: null,
    cancelAtPeriodEnd: false,
    cancellationRequestedAt: null,
    cancellationEffectiveAt: null,
    canCancelRenewal: false,
    canResumeRenewal: false
  };
}
__name(emptySubscription, "emptySubscription");
function earlierIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}
__name(earlierIso, "earlierIso");
function laterIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
__name(laterIso, "laterIso");
async function accountRole(env, user) {
  if (!user) return "guest";
  if (isEnvAdminEmail(env, user.email)) return "admin";
  try {
    const row = await env.DB.prepare("SELECT role FROM user_roles WHERE user_id = ? LIMIT 1").bind(user.id).first();
    return cleanRole(row?.role) || "member";
  } catch (error) {
    if (isMissingSchemaError(error)) return "member";
    throw error;
  }
}
__name(accountRole, "accountRole");
function permissionsForRole(role, authenticated) {
  const normalized = cleanRole(role) || (authenticated ? "member" : "guest");
  const isAdmin = normalized === "admin";
  const isModerator = normalized === "moderator" || isAdmin;
  return {
    canReadPublic: true,
    canReadRegistered: Boolean(authenticated),
    canChat: Boolean(authenticated),
    canLike: Boolean(authenticated),
    canComment: Boolean(authenticated),
    canModerate: isModerator,
    canManagePosts: isAdmin,
    canManageUsers: isAdmin,
    canViewAdminPanel: isModerator || isAdmin
  };
}
__name(permissionsForRole, "permissionsForRole");
function cleanRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ["guest", "member", "moderator", "admin"].includes(role) ? role : "";
}
__name(cleanRole, "cleanRole");
function envAdminEmails(env) {
  const configured = String(env.ADMIN_EMAILS || env.OWNER_EMAILS || env.SITE_ADMINS || "");
  const projectOwnerFallback = "vargrn@gmail.com";
  return `${configured} ${projectOwnerFallback}`.split(/[\s,;]+/).map((email) => normalizeEmail(email)).filter(Boolean).filter((email, index, list) => list.indexOf(email) === index);
}
__name(envAdminEmails, "envAdminEmails");
function isEnvAdminEmail(env, email) {
  const normalized = normalizeEmail(email);
  return Boolean(normalized && envAdminEmails(env).includes(normalized));
}
__name(isEnvAdminEmail, "isEnvAdminEmail");
async function accountProfile(env, userId) {
  try {
    const row = await env.DB.prepare("SELECT bio, website_url, public_note, updated_at FROM user_profiles WHERE user_id = ? LIMIT 1").bind(userId).first();
    return {
      bio: row?.bio || "",
      websiteUrl: row?.website_url || "",
      publicNote: row?.public_note || "",
      updatedAt: row?.updated_at || null
    };
  } catch (error) {
    if (isMissingSchemaError(error)) return emptyProfile();
    throw error;
  }
}
__name(accountProfile, "accountProfile");
function emptyProfile() {
  return { bio: "", websiteUrl: "", publicNote: "", updatedAt: null };
}
__name(emptyProfile, "emptyProfile");
async function accountStats(env, userId) {
  try {
    const [comments, likes, chat] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM post_comments WHERE user_id = ?").bind(userId).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM post_likes WHERE user_id = ?").bind(userId).first(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM community_chat_messages WHERE user_id = ? AND status = 'active'").bind(userId).first()
    ]);
    return {
      comments: Number(comments?.count || 0),
      likes: Number(likes?.count || 0),
      chatMessages: Number(chat?.count || 0)
    };
  } catch (error) {
    if (isMissingSchemaError(error)) return emptyAccountStats();
    throw error;
  }
}
__name(accountStats, "accountStats");
function emptyAccountStats() {
  return { comments: 0, likes: 0, chatMessages: 0 };
}
__name(emptyAccountStats, "emptyAccountStats");
async function requirePermission(request, env, permission, message = "Access denied") {
  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  if (!account.permissions?.[permission]) return json({ error: message }, { status: 403 });
  return account;
}
__name(requirePermission, "requirePermission");
function canReadVisibility(visibility, account) {
  const level = String(visibility || "public").toLowerCase();
  if (level === "public") return true;
  if (!account?.authenticated) return false;
  if (account.permissions?.canManagePosts || account.permissions?.canModerate) return true;
  if (level === "registered") return true;
  const tier = Number(account.subscription?.tier || 0);
  if (level === "tier1") return tier >= 1;
  if (level === "tier2") return tier >= 2;
  if (level === "tier3") return tier >= 3;
  if (level === "moderator") return Boolean(account.permissions?.canModerate);
  if (level === "admin") return Boolean(account.permissions?.canManagePosts);
  return false;
}
__name(canReadVisibility, "canReadVisibility");
async function publicPost(env, row, account, options = {}) {
  const mediaRows = await env.DB.prepare(
    "SELECT id, media_type, url, title, caption, sort_order FROM post_media WHERE post_id = ? ORDER BY sort_order ASC, created_at ASC"
  ).bind(row.id).all();
  let likedByMe = false;
  if (account?.authenticated) {
    const liked = await env.DB.prepare("SELECT post_id FROM post_likes WHERE post_id = ? AND user_id = ? LIMIT 1").bind(row.id, account.user.id).first();
    likedByMe = Boolean(liked);
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt || "",
    body: options.includeBody ? row.body || "" : void 0,
    status: row.status,
    visibility: row.visibility,
    category: row.category || "Development",
    coverUrl: row.cover_url || firstMediaUrl(mediaRows.results, "image") || "assets/media/posts/biopunk-duo.webp",
    authorName: row.author_name || "Ravene",
    publishedAt: row.published_at || row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pinnedAt: row.pinned_at || null,
    pinned: Boolean(row.pinned_at),
    likeCount: Number(row.like_count || 0),
    commentCount: Number(row.comment_count || 0),
    likedByMe,
    canEdit: Boolean(account?.permissions?.canManagePosts),
    canModerate: Boolean(account?.permissions?.canModerate),
    media: (mediaRows.results || []).map((media) => ({
      id: media.id,
      type: media.media_type,
      url: media.url,
      title: media.title || "",
      caption: media.caption || "",
      sortOrder: Number(media.sort_order || 0)
    }))
  };
}
__name(publicPost, "publicPost");
function firstMediaUrl(rows, type) {
  const item = (rows || []).find((row) => row.media_type === type);
  return item?.url || "";
}
__name(firstMediaUrl, "firstMediaUrl");
async function replacePostMedia(env, postId, media, now) {
  await env.DB.prepare("DELETE FROM post_media WHERE post_id = ?").bind(postId).run();
  const normalized = normalizeMediaList(media);
  if (!normalized.length) return;
  const statements = normalized.map((item, index) => env.DB.prepare(
    "INSERT INTO post_media (id, post_id, media_type, url, title, caption, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(randomId(), postId, item.type, item.url, item.title || null, item.caption || null, index, now));
  await env.DB.batch(statements);
}
__name(replacePostMedia, "replacePostMedia");
function normalizeMediaList(media) {
  if (!Array.isArray(media)) return [];
  return media.slice(0, 20).map((item) => {
    const type = cleanMediaType(item?.type || item?.mediaType);
    const url = cleanUrl(item?.url, 1e3);
    if (!type || !url) return null;
    return {
      type,
      url,
      title: cleanLongText(item?.title, 140),
      caption: cleanLongText(item?.caption, 300)
    };
  }).filter(Boolean);
}
__name(normalizeMediaList, "normalizeMediaList");
function cleanMediaType(value) {
  const type = String(value || "").trim().toLowerCase();
  return ["image", "video", "audio", "link"].includes(type) ? type : "";
}
__name(cleanMediaType, "cleanMediaType");
function cleanPostStatus(value) {
  const status = String(value || "published").trim().toLowerCase();
  return ["draft", "published", "hidden"].includes(status) ? status : "published";
}
__name(cleanPostStatus, "cleanPostStatus");
function cleanPostVisibility(value) {
  const visibility = String(value || "public").trim().toLowerCase();
  return ["public", "registered", "tier1", "tier2", "tier3", "moderator", "admin"].includes(visibility) ? visibility : "public";
}
__name(cleanPostVisibility, "cleanPostVisibility");
function cleanLongText(value, maxLength) {
  return String(value || "").trim().replace(/\r\n/g, "\n").replace(/[\t ]+\n/g, "\n").slice(0, maxLength);
}
__name(cleanLongText, "cleanLongText");
async function writeModerationLog(env, { actorId = null, targetUserId = null, targetType, targetId, action, reason = null, rawPayload = null }) {
  try {
    await env.DB.prepare(
      "INSERT INTO moderation_logs (id, actor_id, target_user_id, target_type, target_id, action, reason, created_at, raw_payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      randomId(),
      actorId,
      targetUserId,
      targetType,
      targetId,
      action,
      reason,
      (/* @__PURE__ */ new Date()).toISOString(),
      rawPayload ? JSON.stringify(rawPayload) : null
    ).run();
  } catch (error) {
    if (!isMissingSchemaError(error, ["moderation_logs"])) throw error;
  }
}
__name(writeModerationLog, "writeModerationLog");
function isMissingSchemaError(error, tableNames = []) {
  const message = String(error?.message || error || "").toLowerCase();
  if (!message) return false;
  const looksLikeMissingSchema = message.includes("no such table") || message.includes("no such column") || message.includes("has no column named") || message.includes("unknown column") || message.includes("table") && message.includes("does not exist");
  if (!looksLikeMissingSchema) return false;
  if (!tableNames.length) return true;
  return tableNames.some((tableName) => message.includes(String(tableName).toLowerCase()));
}
__name(isMissingSchemaError, "isMissingSchemaError");
function moonPayMigrationMissingResponse() {
  return json(
    { error: "MoonPay Commerce database migration is missing. Apply db/migrations/0004_moonpay_subscriptions.sql, 0005_moonpay_commerce_compat.sql, and 0007_subscription_controls.sql." },
    { status: 503 }
  );
}
__name(moonPayMigrationMissingResponse, "moonPayMigrationMissingResponse");
function subscriptionControlsMigrationMissingResponse() {
  return json(
    { error: "Subscription controls migration is missing. Apply db/migrations/0007_subscription_controls.sql." },
    { status: 503 }
  );
}
__name(subscriptionControlsMigrationMissingResponse, "subscriptionControlsMigrationMissingResponse");
function redirectResponse(location, status = 302) {
  return new Response(null, { status, headers: { location } });
}
__name(redirectResponse, "redirectResponse");
function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
__name(randomBytes, "randomBytes");
function randomNumericCode(length = 6) {
  let code = "";
  const bytes = randomBytes(length);
  for (const byte of bytes) code += String(byte % 10);
  return code;
}
__name(randomNumericCode, "randomNumericCode");
async function sha256Bytes(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}
__name(sha256Bytes, "sha256Bytes");
async function sha256Base64Url(value) {
  return base64Url(await sha256Bytes(value));
}
__name(sha256Base64Url, "sha256Base64Url");
async function hmacSha256HexWithKey(rawKeyBytes, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    rawKeyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(hmacSha256HexWithKey, "hmacSha256HexWithKey");
async function sendVerificationEmail(env, { email, displayName, code, expiresAt }) {
  if (env.DEV_EMAIL_CODES === "1") {
    console.log(`Ravene Hub verification code for ${email}: ${code}`);
    return { ok: true, devCode: code };
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: "Email delivery is not configured yet. Add RESEND_API_KEY and EMAIL_FROM secrets before enabling email registration." };
  }
  const subject = "Your Ravene Hub verification code";
  const safeName = cleanDisplayName(displayName) || "there";
  const text = [
    `Hi ${safeName},`,
    "",
    `Your Ravene Hub verification code is: ${code}`,
    "",
    `It expires at ${new Date(expiresAt).toUTCString()}.`,
    "If you did not request this account, you can ignore this email."
  ].join("\n");
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#05070d;color:#e5eaf2;padding:28px;line-height:1.5">
      <div style="max-width:520px;margin:0 auto;border:1px solid #2b3442;background:#101620;padding:24px">
        <p style="color:#9aa5b4;margin:0 0 12px">Ravene Hub</p>
        <h1 style="font-size:24px;margin:0 0 16px;color:#f3f6fb">Verification code</h1>
        <p>Hi ${escapeEmailHtml(safeName)},</p>
        <p>Your Ravene Hub verification code is:</p>
        <p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:22px 0;color:#ffffff">${code}</p>
        <p style="color:#b8c2d2">It expires at ${escapeEmailHtml(new Date(expiresAt).toUTCString())}.</p>
        <p style="color:#7d8794;font-size:13px">If you did not request this account, you can ignore this email.</p>
      </div>
    </div>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject, text, html })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return { ok: false, error: data.message || data.error || "Could not send verification email." };
  }
  return { ok: true };
}
__name(sendVerificationEmail, "sendVerificationEmail");
function escapeEmailHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
__name(escapeEmailHtml, "escapeEmailHtml");
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
__name(readJson, "readJson");
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...jsonHeaders,
      ...init.headers || {}
    }
  });
}
__name(json, "json");
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
__name(withSecurityHeaders, "withSecurityHeaders");
function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  const part = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}
__name(getCookie, "getCookie");
function normalizeCode(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}
__name(normalizeCode, "normalizeCode");
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
__name(normalizeEmail, "normalizeEmail");
function cleanDisplayName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}
__name(cleanDisplayName, "cleanDisplayName");
function safeFallbackDisplayName(email) {
  const fallback = cleanDisplayName(String(email || "").split("@")[0]) || "Member";
  return reservedDisplayNameReason(fallback) ? "Member" : fallback;
}
__name(safeFallbackDisplayName, "safeFallbackDisplayName");
function reservedDisplayNameReason(value) {
  const name = cleanDisplayName(value);
  if (!name) return "";
  const normalized = normalizeReservedDisplayName(name);
  const blockedExact = /* @__PURE__ */ new Set([
    "rav",
    "ravene",
    "ravenehub",
    "hub",
    "admin",
    "administrator",
    "moderator",
    "mod",
    "staff",
    "support",
    "owner",
    "raveneadmin",
    "adminravene",
    "ravenehubadmin",
    "adminravenehub",
    "hubadmin",
    "adminhub",
    "ravenehubmoderator",
    "moderatorravenehub",
    "ravenehubstaff",
    "staffravenehub",
    "ravenehubsupport",
    "supportravenehub"
  ]);
  if (blockedExact.has(normalized)) return "This display name is reserved.";
  const authorityTerms = ["admin", "administrator", "moderator", "mod", "staff", "support", "owner"];
  const brandTerms = ["rav", "ravene", "hub", "ravenehub"];
  const hasAuthority = authorityTerms.some((term) => normalized.includes(term));
  const hasBrand = brandTerms.some((term) => normalized.includes(term));
  if (hasAuthority && hasBrand) return "This display name is reserved.";
  if (/^ravene(?:hub)?(?:team|official|support|staff|admin|mod|moderator|owner)$/.test(normalized)) return "This display name is reserved.";
  if (/^(?:team|official|support|staff|admin|mod|moderator|owner)ravene(?:hub)?$/.test(normalized)) return "This display name is reserved.";
  return "";
}
__name(reservedDisplayNameReason, "reservedDisplayNameReason");
function normalizeReservedDisplayName(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "").replace(/[а]/g, "a").replace(/[её]/g, "e").replace(/[о]/g, "o").replace(/[р]/g, "p").replace(/[с]/g, "c").replace(/[х]/g, "x").replace(/[у]/g, "y").replace(/[і]/g, "i");
}
__name(normalizeReservedDisplayName, "normalizeReservedDisplayName");
function cleanPostSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}
__name(cleanPostSlug, "cleanPostSlug");
function validateEmailPassword(email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 256) return "Password is too long";
  return "";
}
__name(validateEmailPassword, "validateEmailPassword");
async function hashPassword(password) {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = base64Url(saltBytes);
  const hashBytes = await pbkdf2(password, saltBytes, PASSWORD_ITERATIONS);
  return {
    algorithm: PASSWORD_ALGORITHM,
    iterations: PASSWORD_ITERATIONS,
    salt,
    hash: base64Url(hashBytes)
  };
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, credential) {
  if (credential.password_algorithm !== PASSWORD_ALGORITHM) return false;
  const saltBytes = base64UrlToBytes(credential.password_salt);
  const expected = base64UrlToBytes(credential.password_hash);
  const actual = await pbkdf2(password, saltBytes, Number(credential.password_iterations || PASSWORD_ITERATIONS));
  return timingSafeEqual(actual, expected);
}
__name(verifyPassword, "verifyPassword");
async function pbkdf2(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}
__name(pbkdf2, "pbkdf2");
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64Url, "base64Url");
function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
__name(base64UrlToBytes, "base64UrlToBytes");
async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
function safeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
__name(safeEqual, "safeEqual");
function randomId() {
  return crypto.randomUUID();
}
__name(randomId, "randomId");
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(randomToken, "randomToken");
function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
__name(addDays, "addDays");
function addMinutes(date, minutes) {
  const next = new Date(date);
  next.setUTCMinutes(next.getUTCMinutes() + minutes);
  return next;
}
__name(addMinutes, "addMinutes");

// ../../../home/oai/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../home/oai/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-8uYCEc/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../home/oai/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-8uYCEc/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=bundledWorker-0.44270293637621116.mjs.map
