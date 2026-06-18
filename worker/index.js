const SESSION_COOKIE = "rh_session";
const SESSION_DAYS = 30;
const BUILD_SESSION_MINUTES = 15;
const PASSWORD_ITERATIONS = 60000;
const PASSWORD_ALGORITHM = "pbkdf2-sha256";
const MOONPAY_SUBSCRIPTION_DAYS_FALLBACK = 32;
const MOONPAY_ALLOWED_MODES = new Set(["test", "live"]);
const MOONPAY_WIDGET_SCRIPT_URL = "https://embed.hel.io/assets/index-v1.js";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request, env, ctx) {
    void ctx;

    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    if (env.ASSETS?.fetch) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return withSecurityHeaders(assetResponse);
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleApi(request, env, url) {
  try {
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, db: Boolean(env.DB) });
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      const account = await currentAccount(request, env);
      return json(account);
    }

    if (url.pathname === "/api/post-comments" && request.method === "GET") {
      return listPostComments(env, url);
    }

    if (url.pathname === "/api/post-comments" && request.method === "POST") {
      return createPostComment(request, env);
    }

    if (url.pathname === "/api/auth/login-code" && request.method === "POST") {
      return consumeLoginCode(request, env);
    }

    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      return registerWithPassword(request, env);
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return loginWithPassword(request, env);
    }

    if (url.pathname === "/api/auth/dev-session" && request.method === "POST") {
      return createDevSession(request, env);
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      return clearSession();
    }

    if (url.pathname === "/api/moonpay/config" && request.method === "GET") {
      return moonPayPublicConfig(request, env);
    }

    if (url.pathname === "/api/moonpay/checkout/session" && request.method === "POST") {
      return createMoonPayCheckoutSession(request, env);
    }

    if ((url.pathname === "/api/moonpay/webhook" || url.pathname === "/api/helio/webhook") && request.method === "POST") {
      return handleMoonPayWebhook(request, env);
    }

    if (url.pathname === "/api/builds/current/launch" && request.method === "POST") {
      return createBuildLaunch(request, env);
    }

    return json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return json(
      { error: "Server error", detail: env.DEBUG_ERRORS === "1" ? String(error?.message || error) : undefined },
      { status: 500 },
    );
  }
}

async function currentAccount(request, env) {
  if (!env.DB) {
    return {
      authenticated: false,
      setupRequired: true,
      user: null,
      subscription: emptySubscription(),
      identities: [],
    };
  }

  const workspaceUser = await workspaceIdentity(request, env);
  const sessionUser = workspaceUser || await sessionIdentity(request, env);

  if (!sessionUser) {
    return {
      authenticated: false,
      setupRequired: false,
      user: null,
      subscription: emptySubscription(),
      identities: [],
    };
  }

  const [subscription, identities] = await Promise.all([
    activeSubscription(env, sessionUser.id),
    env.DB.prepare(
      "SELECT provider, provider_user_id, provider_username FROM user_identities WHERE user_id = ? ORDER BY created_at DESC",
    ).bind(sessionUser.id).all(),
  ]);

  return {
    authenticated: true,
    setupRequired: false,
    user: {
      id: sessionUser.id,
      email: sessionUser.email,
      displayName: sessionUser.display_name || sessionUser.email || "Ravene Hub user",
      avatarUrl: sessionUser.avatar_url,
    },
    subscription,
    identities: identities.results || [],
  };
}

async function sessionIdentity(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();

  const row = await env.DB.prepare(
    `SELECT users.*
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?
     LIMIT 1`,
  ).bind(tokenHash, now).first();

  if (row) {
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
  }

  return row;
}

async function workspaceIdentity(request, env) {
  const email = request.headers.get("oai-authenticated-user-email");
  if (!email) return null;

  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  const displayName = encoding === "percent-encoded-utf-8" && encodedName
    ? decodeURIComponent(encodedName)
    : email;

  const user = await upsertUser(env, { email, displayName });
  await upsertIdentity(env, user.id, {
    provider: "workspace",
    providerUserId: email,
    providerUsername: email,
  });

  return user;
}

async function consumeLoginCode(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });

  const body = await readJson(request);
  const code = normalizeCode(body.code);
  if (!code) return json({ error: "Enter the code from the bot" }, { status: 400 });

  const codeHash = await sha256(code);
  const now = new Date().toISOString();
  const loginCode = await env.DB.prepare(
    "SELECT * FROM login_codes WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1",
  ).bind(codeHash, now).first();

  if (!loginCode) return json({ error: "Code is wrong or expired" }, { status: 401 });

  let user = loginCode.user_id
    ? await env.DB.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(loginCode.user_id).first()
    : null;

  if (!user) {
    user = await upsertUser(env, {
      displayName: loginCode.telegram_username ? `@${loginCode.telegram_username}` : "Telegram user",
    });
  }

  if (loginCode.telegram_id) {
    await upsertIdentity(env, user.id, {
      provider: "telegram",
      providerUserId: loginCode.telegram_id,
      providerUsername: loginCode.telegram_username,
    });
  }

  await env.DB.prepare("UPDATE login_codes SET consumed_at = ? WHERE id = ?").bind(now, loginCode.id).run();
  return createSessionResponse(request, env, user);
}

async function registerWithPassword(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });

  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const displayName = cleanDisplayName(body.displayName) || email.split("@")[0];

  const validationError = validateEmailPassword(email, password);
  if (validationError) return json({ error: validationError }, { status: 400 });

  const existingCredential = await env.DB.prepare(
    "SELECT id FROM user_credentials WHERE email_normalized = ? LIMIT 1",
  ).bind(email).first();
  if (existingCredential) return json({ error: "Email is already registered" }, { status: 409 });

  const existingUser = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").bind(email).first();
  if (existingUser) return json({ error: "Email is already attached to another account" }, { status: 409 });

  const passwordRecord = await hashPassword(password);
  const now = new Date().toISOString();
  const user = {
    id: randomId(),
    email,
    display_name: displayName,
    avatar_url: null,
    created_at: now,
    updated_at: now,
  };

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(user.id, user.email, user.display_name, user.avatar_url, user.created_at, user.updated_at),
    env.DB.prepare(
      "INSERT INTO user_identities (id, user_id, provider, provider_user_id, provider_username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(randomId(), user.id, "email", email, email, now, now),
    env.DB.prepare(
      `INSERT INTO user_credentials
        (id, user_id, email, email_normalized, password_hash, password_salt, password_iterations, password_algorithm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      randomId(),
      user.id,
      email,
      email,
      passwordRecord.hash,
      passwordRecord.salt,
      passwordRecord.iterations,
      passwordRecord.algorithm,
      now,
      now,
    ),
  ]);

  return createSessionResponse(request, env, user);
}

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
     LIMIT 1`,
  ).bind(email).first();

  if (!credential) return json({ error: "Email or password is wrong" }, { status: 401 });

  const ok = await verifyPassword(password, credential);
  if (!ok) return json({ error: "Email or password is wrong" }, { status: 401 });

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE user_credentials SET last_login_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, credential.id)
    .run();

  return createSessionResponse(request, env, {
    id: credential.user_id,
    email: credential.user_email,
    display_name: credential.display_name,
    avatar_url: credential.avatar_url,
    created_at: credential.created_at,
    updated_at: credential.updated_at,
  });
}

async function createDevSession(request, env) {
  if (env.DEV_LOGIN_ENABLED !== "1") {
    return json({ error: "Developer login is disabled" }, { status: 404 });
  }

  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });

  const body = await readJson(request);
  const user = await upsertUser(env, {
    email: body.email || "dev@ravene.local",
    displayName: body.displayName || "Ravene",
  });

  return createSessionResponse(request, env, user);
}

async function createBuildLaunch(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });

  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });
  if (!account.subscription.canLaunchBuilds) {
    return json({ error: "Tier 2 access is required" }, { status: 403 });
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = addMinutes(now, BUILD_SESSION_MINUTES).toISOString();

  await env.DB.prepare(
    "INSERT INTO build_launch_sessions (id, user_id, build_key, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(randomId(), account.user.id, "current-ea", tokenHash, now.toISOString(), expiresAt).run();

  const baseUrl = env.CURRENT_BUILD_URL || "";
  return json({
    buildKey: "current-ea",
    launchToken: token,
    expiresAt,
    launchUrl: baseUrl ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}session=${encodeURIComponent(token)}` : null,
  });
}

async function listPostComments(env, url) {
  if (!env.DB) return json({ comments: [], setupRequired: true });

  const postSlug = cleanPostSlug(url.searchParams.get("post"));
  if (!postSlug) return json({ error: "Post slug is required" }, { status: 400 });

  const rows = await env.DB.prepare(
    `SELECT post_comments.id, post_comments.body, post_comments.created_at, users.display_name, users.email, users.avatar_url
     FROM post_comments
     JOIN users ON users.id = post_comments.user_id
     WHERE post_comments.post_slug = ?
     ORDER BY post_comments.created_at ASC
     LIMIT 100`,
  ).bind(postSlug).all();

  return json({
    comments: (rows.results || []).map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      authorName: row.display_name || row.email || "Ravene Hub user",
      authorAvatar: row.avatar_url || null,
    })),
  });
}

async function createPostComment(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });

  const account = await currentAccount(request, env);
  if (!account.authenticated) return json({ error: "Sign in first" }, { status: 401 });

  const body = await readJson(request);
  const postSlug = cleanPostSlug(body.postSlug);
  const comment = String(body.body || "").trim().replace(/\s+\n/g, "\n").slice(0, 2000);

  if (!postSlug) return json({ error: "Post slug is required" }, { status: 400 });
  if (comment.length < 1) return json({ error: "Write a comment first" }, { status: 400 });

  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO post_comments (id, post_slug, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(randomId(), postSlug, account.user.id, comment, now, now).run();

  return listPostComments(env, new URL(`https://local/api/post-comments?post=${encodeURIComponent(postSlug)}`));
}

async function createSessionResponse(request, env, user) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = addDays(now, SESSION_DAYS);

  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, user_agent, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    randomId(),
    user.id,
    tokenHash,
    request.headers.get("user-agent") || "",
    now.toISOString(),
    expiresAt.toISOString(),
    now.toISOString(),
  ).run();

  return json(
    { ok: true, userId: user.id },
    {
      headers: {
        "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expiresAt.toUTCString()}`,
      },
    },
  );
}

function clearSession() {
  return json(
    { ok: true },
    {
      headers: {
        "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      },
    },
  );
}

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
      2: moonPayPublicPlan(config, 2),
    },
  });
}

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

  const now = new Date().toISOString();
  const sessionId = randomId();
  const checkoutToken = randomToken();

  await env.DB.prepare(
    `INSERT INTO moonpay_checkout_sessions
      (id, user_id, tier, paylink_id, status, checkout_token, created_at, updated_at, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    }),
  ).run();

  return json({
    ok: true,
    sessionId,
    checkoutToken,
    tier,
    paylinkId,
    network: config.network,
    paymentType: config.paymentType,
    primaryPaymentMethod: config.primaryPaymentMethod,
  });
}

async function handleMoonPayWebhook(request, env) {
  if (!env.DB) return json({ error: "Database is not configured yet" }, { status: 503 });

  const rawBody = await request.text();
  const payload = JSON.parse(rawBody || "{}");
  const eventType = moonPayEventType(payload);
  if (!eventType) return json({ error: "MoonPay webhook event is malformed" }, { status: 400 });

  await verifyMoonPayWebhook(request, env, rawBody);

  const now = new Date().toISOString();
  const eventId = await moonPayWebhookEventId(request, payload, eventType, rawBody);

  try {
    await env.DB.prepare(
      "INSERT INTO webhook_events (id, provider, provider_event_id, event_type, received_at, raw_payload) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(randomId(), "moonpay", eventId, eventType, now, rawBody).run();
  } catch (error) {
    if (String(error?.message || error).includes("UNIQUE")) {
      return json({ ok: true, duplicate: true });
    }
    throw error;
  }

  await applyMoonPayWebhookEvent(env, payload, eventType);
  return json({ ok: true });
}

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
  }

  if (paylinkId) tier = tierForMoonPayPaylink(env, paylinkId) || tier;

  if (!userId && details.subscriptionId) {
    const existing = await env.DB.prepare(
      "SELECT user_id, tier, paylink_id, checkout_session_id FROM moonpay_subscriptions WHERE moonpay_subscription_id = ? LIMIT 1",
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
    checkoutSessionId: cleanRecordId(checkoutSessionId),
  };
}

async function moonPayCheckoutSession(env, sessionId, checkoutToken) {
  const token = cleanMoonPayToken(checkoutToken);
  if (token) {
    const row = await env.DB.prepare(
      "SELECT id, user_id, tier, paylink_id FROM moonpay_checkout_sessions WHERE checkout_token = ? LIMIT 1",
    ).bind(token).first();
    if (row) return row;
  }

  const id = cleanRecordId(sessionId);
  if (!id) return null;
  return env.DB.prepare(
    "SELECT id, user_id, tier, paylink_id FROM moonpay_checkout_sessions WHERE id = ? LIMIT 1",
  ).bind(id).first();
}

async function grantMoonPayAccess(env, userId, tier, details, payload) {
  const now = new Date().toISOString();
  const startsAt = details.createdAt || now;
  const expiresAt = details.renewalDate || addDays(new Date(), MOONPAY_SUBSCRIPTION_DAYS_FALLBACK).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE subscriptions SET status = 'revoked', updated_at = ? WHERE user_id = ? AND source = 'moonpay' AND status = 'active'",
    ).bind(now, userId),
    env.DB.prepare(
      "INSERT INTO subscriptions (id, user_id, tier, status, source, starts_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(randomId(), userId, tier, "active", "moonpay", startsAt, expiresAt, now, now),
  ]);

  if (details.checkoutSessionId || details.checkoutToken) {
    await markMoonPayCheckoutSession(env, details, "active", now, payload);
  }

  return { expiresAt };
}

async function endMoonPayAccess(env, details, eventType, payload) {
  const now = new Date().toISOString();
  const subscriptionId = moonPaySubscriptionRecordId(details);
  let existing = null;

  if (subscriptionId) {
    existing = await env.DB.prepare(
      "SELECT user_id, tier FROM moonpay_subscriptions WHERE moonpay_subscription_id = ? LIMIT 1",
    ).bind(subscriptionId).first();
  }

  const userId = details.userId || existing?.user_id || null;
  const tier = details.tier || Number(existing?.tier || 0);

  if (subscriptionId && tier) {
    await upsertMoonPaySubscription(env, { ...details, userId, tier, subscriptionId }, moonPayEndedStatus(eventType), payload);
  }

  if (!userId) return;

  await env.DB.prepare(
    "UPDATE subscriptions SET status = ?, updated_at = ? WHERE user_id = ? AND source = 'moonpay' AND status = 'active'",
  ).bind(eventType === "ENDED" || eventType === "EXPIRED" ? "expired" : "revoked", now, userId).run();

  if (details.checkoutSessionId || details.checkoutToken) {
    await markMoonPayCheckoutSession(env, details, "ended", now, payload);
  }
}

async function upsertMoonPaySubscription(env, details, status, payload) {
  const now = new Date().toISOString();
  const subscriptionId = moonPaySubscriptionRecordId(details);
  const tier = Number(details.tier || 0);
  if (!subscriptionId || !tier) return;

  const existing = await env.DB.prepare(
    "SELECT id, user_id FROM moonpay_subscriptions WHERE moonpay_subscription_id = ? LIMIT 1",
  ).bind(subscriptionId).first();

  const rawPayload = JSON.stringify(payload || {});
  const userId = details.userId || null;

  if (existing) {
    await env.DB.prepare(
      `UPDATE moonpay_subscriptions
       SET user_id = COALESCE(?, user_id), tier = ?, paylink_id = ?, status = ?, customer_email = COALESCE(?, customer_email),
           payer_wallet = COALESCE(?, payer_wallet), checkout_session_id = COALESCE(?, checkout_session_id), renewal_date = COALESCE(?, renewal_date),
           raw_payload = ?, updated_at = ?
       WHERE id = ?`,
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
      existing.id,
    ).run();
    return;
  }

  await env.DB.prepare(
    `INSERT INTO moonpay_subscriptions
      (id, user_id, tier, moonpay_subscription_id, paylink_id, status, customer_email, payer_wallet, checkout_session_id, renewal_date, raw_payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    now,
  ).run();
}

async function recordMoonPayPayment(env, details, payload, eventType) {
  const paymentId = cleanMoonPayId(details.transactionSignature) || cleanMoonPayId(details.transactionId) || cleanMoonPayId(`${details.subscriptionId || "subscription"}-${eventType}-${details.renewalDate || Date.now()}`);
  if (!paymentId || eventType === "ENDED" || eventType === "EXPIRED" || eventType === "CANCELLED") return;

  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO payments
        (id, user_id, provider, provider_payment_id, tier, amount_cents, currency, status, paid_at, raw_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      now,
    ).run();
  } catch (error) {
    if (!String(error?.message || error).includes("UNIQUE")) throw error;
  }
}

async function markMoonPayCheckoutSession(env, details, status, now, payload) {
  const token = cleanMoonPayToken(details.checkoutToken);
  const id = cleanRecordId(details.checkoutSessionId);
  if (!token && !id) return;

  const where = token ? "checkout_token = ?" : "id = ?";
  await env.DB.prepare(
    `UPDATE moonpay_checkout_sessions
     SET status = ?, completed_at = COALESCE(completed_at, ?), raw_payload = ?, updated_at = ?
     WHERE ${where}`,
  ).bind(status, now, JSON.stringify(payload || {}), now, token || id).run();
}

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

async function matchingMoonPayWebhookToken(tokens, received) {
  if (!received) return null;
  const receivedHash = await sha256(received);
  for (const token of tokens) {
    if (receivedHash === await sha256(token)) return token;
  }
  return null;
}

async function moonPayWebhookEventId(request, payload, eventType, rawBody) {
  const transaction = moonPayTransactionObject(payload);
  const meta = transaction?.meta || payload.meta || {};
  return cleanMoonPayId(
    request.headers.get("x-webhook-delivery-id") ||
    request.headers.get("x-transaction-id") ||
    payload.webhookDeliveryIdempotencyKey ||
    payload.txIdempotencyKey ||
    payload.eventId ||
    transaction?.id ||
    meta.transactionSignature ||
    payload.id ||
    `${eventType}-${await sha256(rawBody)}`,
  );
}

function moonPayPayloadDetails(env, payload) {
  const transaction = moonPayTransactionObject(payload);
  const meta = transaction?.meta || payload.meta || payload.data?.meta || {};
  const customer = meta.customerDetails || transaction?.customerDetails || payload.customerDetails || payload.data?.customerDetails || {};
  const subscription = payload.subscription || payload.subscriptionObject || payload.data?.subscription || payload.data?.subscriptionObject || {};
  const additional = parseMoonPayAdditionalJSON(
    customer.additionalJSON ??
    meta.additionalJSON ??
    transaction?.additionalJSON ??
    payload.additionalJSON ??
    payload.data?.additionalJSON,
  );

  const paylinkId = cleanMoonPayId(
    payload.paylinkId ||
    payload.paylink ||
    payload.data?.paylinkId ||
    subscription.paylinkId ||
    subscription.paylink ||
    transaction?.paylinkId ||
    transaction?.paylink,
  );

  const tier = Number(
    tierForMoonPayPaylink(env, paylinkId) ||
    payload.tier ||
    payload.data?.tier ||
    additional.tier ||
    additional.planTier ||
    0,
  );

  const email = normalizeEmail(
    customer.email ||
    subscription.email ||
    payload.email ||
    payload.data?.email ||
    additional.accountEmail ||
    additional.email,
  );

  const transactionSignature = cleanMoonPayId(
    meta.transactionSignature ||
    payload.transactionSignature ||
    payload.data?.transactionSignature,
  );

  return {
    event: moonPayEventType(payload),
    subscriptionId: cleanMoonPayId(
      payload.subscriptionId ||
      payload.paystreamId ||
      payload.data?.subscriptionId ||
      subscription.id ||
      subscription.subscriptionId ||
      ((payload.status || payload.renewalDate) ? payload.id : ""),
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
    email,
    payerWallet: cleanWallet(meta.senderPK || payload.senderPK || payload.payerWallet || payload.walletAddress || customer.walletAddress),
    renewalDate: cleanIsoDate(payload.renewalDate || payload.data?.renewalDate || subscription.renewalDate || payload.currentPeriodEnd || payload.expiresAt),
    createdAt: cleanIsoDate(payload.createdAt || payload.data?.createdAt || subscription.createdAt || transaction?.createdAt),
    amountCents: moonPayAmountCents(meta),
    currency: cleanCurrency(meta.tokenQuote?.from || meta.currency?.symbol || payload.currency?.symbol || payload.currency),
    additional,
  };
}

function moonPayTransactionObject(payload) {
  return parseObject(payload.transactionObject) ||
    parseObject(payload.transaction) ||
    parseObject(payload.data?.transactionObject) ||
    parseObject(payload.data?.transaction) ||
    parseObject(payload.resource?.transactionObject) ||
    parseObject(payload.resource?.transaction) ||
    null;
}

function moonPayEventType(payload) {
  const value = String(payload.event || payload.eventType || payload.event_type || payload.type || payload.data?.event || "").trim().toUpperCase();
  if (value) return value;

  const status = String(payload.status || payload.data?.status || "").trim().toUpperCase();
  if (status === "ACTIVE") return "STARTED";
  if (status === "EXPIRED") return "ENDED";
  return "";
}

function moonPaySubscriptionRecordId(details) {
  return cleanMoonPayId(details.subscriptionId) || (cleanMoonPayId(details.transactionId) ? `tx_${cleanMoonPayId(details.transactionId)}` : "");
}

function moonPayEndedStatus(eventType) {
  if (eventType === "EXPIRED" || eventType === "ENDED") return "expired";
  if (eventType === "CANCELLED") return "cancelled";
  return "ended";
}

function moonPayPublicPlan(config, tier) {
  const paylinkId = config.paylinks[tier] || "";
  if (!paylinkId) return null;
  return {
    paylinkId,
    checkoutUrl: config.checkoutUrls[tier] || moonPayHostedUrl(config, paylinkId),
  };
}

function moonPayHostedUrl(config, paylinkId) {
  const base = config.checkoutBaseUrl || (config.network === "test" ? "https://app.dev.hel.io/pay/" : "https://app.hel.io/pay/");
  return `${base.replace(/\/+$/, "")}/${encodeURIComponent(paylinkId)}`;
}

function moonPayConfig(env) {
  const rawMode = String(env.MOONPAY_MODE || env.HELIO_MODE || "test").trim().toLowerCase();
  const mode = MOONPAY_ALLOWED_MODES.has(rawMode) ? rawMode : "test";
  const network = cleanMoonPayNetwork(env.MOONPAY_NETWORK || env.HELIO_NETWORK) || (mode === "live" ? "main" : "test");
  const paymentType = String(env.MOONPAY_PAYMENT_TYPE || env.HELIO_PAYMENT_TYPE || "paystream").trim() === "paylink" ? "paylink" : "paystream";
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
      3: cleanMoonPayId(env.MOONPAY_TIER_3_PAYLINK_ID || env.HELIO_TIER_3_PAYLINK_ID),
    },
    checkoutUrls: {
      1: cleanUrl(env.MOONPAY_TIER_1_CHECKOUT_URL || env.HELIO_TIER_1_CHECKOUT_URL),
      2: cleanUrl(env.MOONPAY_TIER_2_CHECKOUT_URL || env.HELIO_TIER_2_CHECKOUT_URL),
      3: cleanUrl(env.MOONPAY_TIER_3_CHECKOUT_URL || env.HELIO_TIER_3_CHECKOUT_URL),
    },
  };
}

function moonPayWebhookTokens(env) {
  return [
    env.MOONPAY_WEBHOOK_SHARED_TOKEN,
    env.HELIO_WEBHOOK_SHARED_TOKEN,
    env.MOONPAY_TIER_1_WEBHOOK_TOKEN,
    env.MOONPAY_TIER_2_WEBHOOK_TOKEN,
    env.MOONPAY_TIER_3_WEBHOOK_TOKEN,
    env.HELIO_TIER_1_WEBHOOK_TOKEN,
    env.HELIO_TIER_2_WEBHOOK_TOKEN,
    env.HELIO_TIER_3_WEBHOOK_TOKEN,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function tierForMoonPayPaylink(env, paylinkId) {
  const cleanPaylinkId = cleanMoonPayId(paylinkId);
  const config = moonPayConfig(env);
  return [1, 2, 3].find((tier) => config.paylinks[tier] && config.paylinks[tier] === cleanPaylinkId) || 0;
}

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

function moonPayAmountCents(meta) {
  const decimal = Number(meta?.tokenQuote?.fromAmountDecimal || meta?.tokenQuote?.toAmountDecimal || NaN);
  return Number.isFinite(decimal) ? Math.round(decimal * 100) : null;
}

function cleanMoonPayId(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 160);
}

function cleanMoonPayToken(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 160);
}

function cleanRecordId(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80);
}

function cleanWallet(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 160) || null;
}

function cleanCurrency(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 24).toUpperCase() || null;
}

function cleanUrl(value) {
  const text = String(value || "").trim();
  if (!/^https:\/\//i.test(text)) return "";
  try {
    return new URL(text).toString();
  } catch {
    return "";
  }
}

function cleanMoonPayNetwork(value) {
  const network = String(value || "").trim().toLowerCase();
  return network === "main" || network === "test" ? network : "";
}

function cleanIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeHexEqual(a, b) {
  const left = hexToBytes(a);
  const right = hexToBytes(b);
  if (!left || !right) return false;
  return timingSafeEqual(left, right);
}

function hexToBytes(value) {
  const clean = String(value || "").trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < clean.length; index += 2) {
    bytes[index / 2] = Number.parseInt(clean.slice(index, index + 2), 16);
  }
  return bytes;
}

async function upsertUser(env, input) {
  const now = new Date().toISOString();
  const email = input.email || null;
  const displayName = input.displayName || email || null;

  if (email) {
    const existing = await env.DB.prepare("SELECT * FROM users WHERE email = ? LIMIT 1").bind(email).first();
    if (existing) {
      await env.DB.prepare("UPDATE users SET display_name = COALESCE(?, display_name), updated_at = ? WHERE id = ?")
        .bind(displayName, now, existing.id)
        .run();
      return { ...existing, display_name: displayName || existing.display_name };
    }
  }

  const user = {
    id: randomId(),
    email,
    display_name: displayName,
    avatar_url: null,
    created_at: now,
    updated_at: now,
  };

  await env.DB.prepare(
    "INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(user.id, user.email, user.display_name, user.avatar_url, user.created_at, user.updated_at).run();

  return user;
}

async function upsertIdentity(env, userId, identity) {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT id FROM user_identities WHERE provider = ? AND provider_user_id = ? LIMIT 1",
  ).bind(identity.provider, identity.providerUserId).first();

  if (existing) {
    await env.DB.prepare(
      "UPDATE user_identities SET user_id = ?, provider_username = ?, updated_at = ? WHERE id = ?",
    ).bind(userId, identity.providerUsername || null, now, existing.id).run();
    return;
  }

  await env.DB.prepare(
    "INSERT INTO user_identities (id, user_id, provider, provider_user_id, provider_username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    randomId(),
    userId,
    identity.provider,
    identity.providerUserId,
    identity.providerUsername || null,
    now,
    now,
  ).run();
}

async function activeSubscription(env, userId) {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT tier, status, source, starts_at, expires_at
     FROM subscriptions
     WHERE user_id = ? AND status = 'active' AND expires_at > ? AND source = 'moonpay'
     ORDER BY tier DESC, expires_at DESC
     LIMIT 1`,
  ).bind(userId, now).first();

  if (!row) {
    const latestMoonPay = await latestMoonPaySubscription(env, userId);
    return emptySubscription(latestMoonPay);
  }

  const moonpay = row.source === "moonpay"
    ? await latestMoonPaySubscription(env, userId, Number(row.tier))
    : null;

  return {
    tier: Number(row.tier),
    status: row.status,
    source: row.source,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    canReadLocked: Number(row.tier) >= 1,
    canLaunchBuilds: Number(row.tier) >= 2,
    paymentSource: row.source,
    renewalStatus: moonpay?.status || (row.source === "moonpay" ? "active" : row.status),
    moonpaySubscriptionId: moonpay?.moonpay_subscription_id || null,
    moonpayCustomerEmail: moonpay?.customer_email || null,
    moonpayPayerWallet: moonpay?.payer_wallet || null,
    moonpayRenewalDate: moonpay?.renewal_date || null,
    canCancelRenewal: false,
  };
}

async function latestMoonPaySubscription(env, userId, tier = null) {
  if (!env.DB) return null;

  const tierFilter = tier ? "AND tier = ?" : "";
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
     LIMIT 1`,
  );

  return tier
    ? statement.bind(userId, tier).first()
    : statement.bind(userId).first();
}

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
    moonpaySubscriptionId: latestMoonPay?.moonpay_subscription_id || null,
    moonpayCustomerEmail: latestMoonPay?.customer_email || null,
    moonpayPayerWallet: latestMoonPay?.payer_wallet || null,
    moonpayRenewalDate: latestMoonPay?.renewal_date || null,
    canCancelRenewal: false,
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...jsonHeaders,
      ...(init.headers || {}),
    },
  });
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  const part = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

function normalizeCode(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanDisplayName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function cleanPostSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function validateEmailPassword(email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 256) return "Password is too long";
  return "";
}

async function hashPassword(password) {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = base64Url(saltBytes);
  const hashBytes = await pbkdf2(password, saltBytes, PASSWORD_ITERATIONS);

  return {
    algorithm: PASSWORD_ALGORITHM,
    iterations: PASSWORD_ITERATIONS,
    salt,
    hash: base64Url(hashBytes),
  };
}

async function verifyPassword(password, credential) {
  if (credential.password_algorithm !== PASSWORD_ALGORITHM) return false;
  const saltBytes = base64UrlToBytes(credential.password_salt);
  const expected = base64UrlToBytes(credential.password_hash);
  const actual = await pbkdf2(password, saltBytes, Number(credential.password_iterations || PASSWORD_ITERATIONS));
  return timingSafeEqual(actual, expected);
}

async function pbkdf2(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

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

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomId() {
  return crypto.randomUUID();
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMinutes(date, minutes) {
  const next = new Date(date);
  next.setUTCMinutes(next.getUTCMinutes() + minutes);
  return next;
}
