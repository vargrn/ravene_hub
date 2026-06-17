const SESSION_COOKIE = "rh_session";
const SESSION_DAYS = 30;
const BUILD_SESSION_MINUTES = 15;
const PASSWORD_ITERATIONS = 210000;
const PASSWORD_ALGORITHM = "pbkdf2-sha256";

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
     WHERE user_id = ? AND status = 'active' AND expires_at > ?
     ORDER BY tier DESC, expires_at DESC
     LIMIT 1`,
  ).bind(userId, now).first();

  if (!row) return emptySubscription();

  return {
    tier: Number(row.tier),
    status: row.status,
    source: row.source,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    canReadLocked: Number(row.tier) >= 1,
    canLaunchBuilds: Number(row.tier) >= 2,
  };
}

function emptySubscription() {
  return {
    tier: 0,
    status: "none",
    source: null,
    startsAt: null,
    expiresAt: null,
    canReadLocked: false,
    canLaunchBuilds: false,
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
