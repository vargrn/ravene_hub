(() => {
  let currentAccountCache = null;
  let accountRequestVersion = 0;
  let authBusy = false;
  let logoutBusy = false;
  let communityChatLoader = null;
  let adminPanelLoader = null;
  let adminChatModerationLoader = null;
  let chatMuteTimerInterval = null;

  const guestAccount = () => ({
    authenticated: false,
    setupRequired: false,
    user: null,
    subscription: {},
    identities: [],
    role: "guest",
    permissions: {},
    profile: {},
    stats: {},
  });

  const resetPrivilegedPanels = () => {
    document.querySelectorAll("[data-admin-only], [data-moderator-only]").forEach((item) => {
      item.hidden = true;
    });
    const logout = document.querySelector("[data-logout-button]");
    if (logout) {
      logout.hidden = true;
      logout.disabled = false;
      logout.textContent = "Log out";
    }
  };

  const setFormBusy = (form, busy) => {
    form.querySelectorAll("button, input, textarea, select").forEach((item) => {
      item.disabled = busy;
    });
  };

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Request failed");
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  };

  const formatDate = (value) => {
    if (!value) return "-";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
  };

  const setText = (selector, text) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = text;
  };

  const setAuthOnlyVisible = (visible) => {
    document.querySelectorAll("[data-auth-only]").forEach((item) => {
      item.hidden = !visible;
    });
  };

  const setAuthNavVisible = (visible) => {
    document.querySelectorAll("[data-auth-nav]").forEach((item) => {
      item.hidden = !visible;
    });
  };

  const setGuestOnlyVisible = (visible) => {
    document.querySelectorAll("[data-guest-only]").forEach((item) => {
      item.hidden = !visible;
    });
  };

  const adminWorkspaceDefaults = { posts: true, chat: true };
  const adminWorkspaceStorageKey = "ravene:admin-workspace-panels";

  const readAdminWorkspaceState = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(adminWorkspaceStorageKey) || "{}");
      return {
        posts: parsed.posts !== false,
        chat: parsed.chat !== false,
      };
    } catch {
      return { ...adminWorkspaceDefaults };
    }
  };

  const writeAdminWorkspaceState = (state) => {
    try {
      localStorage.setItem(adminWorkspaceStorageKey, JSON.stringify({
        posts: state.posts !== false,
        chat: state.chat !== false,
      }));
    } catch {
      /* Ignore private browsing storage errors. */
    }
  };

  const applyAdminWorkspaceState = () => {
    const state = readAdminWorkspaceState();
    const postsPanel = document.querySelector("[data-admin-panel]");
    const chatPanel = document.querySelector("[data-admin-chat-panel]");
    if (postsPanel) postsPanel.hidden = !state.posts;
    if (chatPanel) chatPanel.hidden = !state.chat;
    document.querySelectorAll("[data-admin-panel-toggle]").forEach((button) => {
      const key = button.dataset.adminPanelToggle;
      const visible = state[key] !== false;
      button.classList.toggle("is-active", visible);
      button.setAttribute("aria-pressed", visible ? "true" : "false");
      const stateLabel = document.querySelector(`[data-admin-panel-toggle-state="${CSS.escape(key)}"]`);
      if (stateLabel) stateLabel.textContent = visible ? "Shown" : "Hidden";
    });
    return state;
  };

  const setAdminWorkspacePanel = (key, visible) => {
    const state = readAdminWorkspaceState();
    state[key] = Boolean(visible);
    writeAdminWorkspaceState(state);
    applyAdminWorkspaceState();
    if (key === "posts" && state.posts && adminPanelLoader) adminPanelLoader();
    if (key === "chat" && state.chat && adminChatModerationLoader) adminChatModerationLoader();
  };

  const initAdminWorkspaceControls = () => {
    document.querySelectorAll("[data-admin-panel-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.adminPanelToggle;
        const state = readAdminWorkspaceState();
        setAdminWorkspacePanel(key, state[key] === false);
      });
    });
    applyAdminWorkspaceState();
  };

  const loadScriptOnce = (src, id, globalReady = () => true) => new Promise((resolve, reject) => {
    const finish = () => {
      if (globalReady()) {
        resolve();
        return true;
      }
      return false;
    };

    const existing = document.getElementById(id);
    if (existing) {
      if (finish()) return;
      existing.addEventListener("load", () => finish() || reject(new Error("Checkout script loaded but did not initialize.")), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load checkout script.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.type = "module";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", () => finish() || reject(new Error("Checkout script loaded but did not initialize.")), { once: true });
    script.addEventListener("error", () => reject(new Error("Could not load checkout script.")), { once: true });
    document.head.appendChild(script);
  });

  const renderAccount = (account) => {
    const authenticated = Boolean(account?.authenticated);
    setAuthNavVisible(authenticated);
    setGuestOnlyVisible(!authenticated);
    const panel = document.querySelector("[data-account-panel]");
    const renewalNote = document.querySelector("[data-renewal-note]");
    const subscriptionMessage = document.querySelector("[data-subscription-message]");
    const cancelRenewalButton = document.querySelector("[data-cancel-renewal-button]");
    const resumeRenewalButton = document.querySelector("[data-resume-renewal-button]");
    if (!panel) return;
    const accountStateHeading = document.querySelector("[data-account-state]");

    panel.classList.toggle("is-connected", Boolean(account.authenticated));
    panel.classList.toggle("is-setup-required", Boolean(account.setupRequired));

    if (account.setupRequired) {
      setAuthOnlyVisible(false);
      setGuestOnlyVisible(true);
      resetPrivilegedPanels();
      if (accountStateHeading) accountStateHeading.hidden = false;
      setText("[data-account-state]", "Setup required");
      if (renewalNote) renewalNote.hidden = true;
      if (cancelRenewalButton) cancelRenewalButton.hidden = true;
      if (resumeRenewalButton) resumeRenewalButton.hidden = true;
      const profileForm = document.querySelector("[data-profile-form]");
      if (profileForm) profileForm.hidden = true;
      return;
    }

    if (!account.authenticated) {
      setAuthOnlyVisible(false);
      setGuestOnlyVisible(true);
      resetPrivilegedPanels();
      if (accountStateHeading) accountStateHeading.hidden = true;
      setText("[data-account-state]", "");
      setText("[data-account-name]", "Not connected");
      setText("[data-account-tier]", "No active tier");
      setText("[data-account-expires]", "-");
      setText("[data-account-access-status]", "-");
      setText("[data-account-renewal-status]", "-");
      setText("[data-account-source]", "-");
      if (renewalNote) renewalNote.hidden = true;
      if (cancelRenewalButton) cancelRenewalButton.hidden = true;
      if (resumeRenewalButton) resumeRenewalButton.hidden = true;
      const profileForm = document.querySelector("[data-profile-form]");
      if (profileForm) profileForm.hidden = true;
      document.querySelectorAll("[data-auth-gate], [data-auth-trigger]").forEach((item) => {
        item.hidden = false;
      });
      return;
    }

    setAuthOnlyVisible(true);
    setGuestOnlyVisible(false);
    const tier = Number(account.subscription?.tier || 0);
    const renewalStatus = account.subscription?.renewalStatus || account.subscription?.status || "none";
    const paymentSource = account.subscription?.paymentSource || account.subscription?.source || null;
    const showMoonPayNote = tier > 0 && paymentSource === "moonpay";
    if (accountStateHeading) accountStateHeading.hidden = false;
    setText("[data-account-state]", "Connected");
    setText("[data-account-name]", account.user?.displayName || "Connected account");
    setText("[data-account-tier]", tier > 0 ? `Tier ${tier}` : "No active tier");
    setText("[data-account-expires]", formatDate(account.subscription?.expiresAt));
    setText("[data-account-access-status]", accountAccessLabel(account.subscription));
    setText("[data-account-renewal-status]", renewalStatusLabel(renewalStatus, tier));
    setText("[data-account-source]", paymentSourceLabel(paymentSource));
    setText("[data-account-email]", account.user?.email || "-");
    setText("[data-account-role]", roleLabel(account.role));
    setText("[data-account-comments]", String(account.stats?.comments || 0));
    setText("[data-account-likes]", String(account.stats?.likes || 0));
    setText("[data-account-chat]", String(account.stats?.chatMessages || 0));

    const canManageAdmin = Boolean(account.permissions?.canManagePosts || account.permissions?.canManageUsers);
    document.querySelectorAll("[data-admin-only]").forEach((item) => {
      item.hidden = !canManageAdmin;
    });
    document.querySelectorAll("[data-moderator-only]").forEach((item) => {
      item.hidden = !account.permissions?.canModerate;
    });
    const adminWorkspaceState = canManageAdmin ? applyAdminWorkspaceState() : adminWorkspaceDefaults;
    if (canManageAdmin && adminWorkspaceState.posts && adminPanelLoader) {
      adminPanelLoader();
    }
    if (canManageAdmin && adminWorkspaceState.chat && adminChatModerationLoader) {
      adminChatModerationLoader();
    }

    const profileForm = document.querySelector("[data-profile-form]");
    if (profileForm && !profileForm.dataset.loaded) {
      profileForm.dataset.loaded = "1";
      const fields = profileForm.elements;
      if (fields.displayName) fields.displayName.value = account.user?.displayName || "";
      if (fields.avatarUrl) fields.avatarUrl.value = account.user?.avatarUrl || "";
      if (fields.bio) fields.bio.value = account.profile?.bio || "";
      if (fields.websiteUrl) fields.websiteUrl.value = account.profile?.websiteUrl || "";
      if (fields.publicNote) fields.publicNote.value = account.profile?.publicNote || "";
    }

    renderConnectedAccounts(account);

    const cancelAtPeriodEnd = Boolean(account.subscription?.cancelAtPeriodEnd);
    if (renewalNote) renewalNote.hidden = !(showMoonPayNote || cancelAtPeriodEnd);
    if (subscriptionMessage) {
      subscriptionMessage.textContent = cancelAtPeriodEnd
        ? `Renewal is cancelled. Paid access remains until ${formatDate(account.subscription?.expiresAt)}.`
        : showMoonPayNote
          ? "MoonPay Commerce renewals are managed through Ravene Hub. Access updates here after confirmed webhook events."
          : renewalStatus === "cancelled" && tier > 0
            ? "Renewal is cancelled. Paid access remains until the expiry date."
            : "";
    }
    if (cancelRenewalButton) {
      cancelRenewalButton.hidden = !account.subscription?.canCancelRenewal;
      cancelRenewalButton.disabled = false;
    }
    if (resumeRenewalButton) {
      resumeRenewalButton.hidden = !account.subscription?.canResumeRenewal;
      resumeRenewalButton.disabled = false;
    }

    document.querySelectorAll("[data-tier-indicator]").forEach((item) => {
      item.classList.toggle("is-unlocked", tier >= Number(item.dataset.tierIndicator || 0));
    });

    const logout = document.querySelector("[data-logout-button]");
    if (logout) logout.hidden = false;

    document.querySelectorAll("[data-auth-form], [data-auth-gate], [data-auth-trigger]").forEach((item) => {
      item.hidden = true;
    });

    if (communityChatLoader) {
      communityChatLoader();
    }
  };

  const accountAccessLabel = (subscription) => {
    const tier = Number(subscription?.tier || 0);
    if (tier > 0) return "Active";
    if (subscription?.renewalStatus === "payment_failed") return "Payment failed";
    if (subscription?.renewalStatus === "suspended") return "Suspended";
    if (subscription?.renewalStatus === "expired") return "Expired";
    if (subscription?.renewalStatus === "cancelled") return "Ended";
    return "No active access";
  };

  const renewalStatusLabel = (status, tier) => {
    if (Number(tier || 0) <= 0 && (!status || status === "none")) return "-";

    const labels = {
      active: "MoonPay membership active",
      renewed: "MoonPay renewal confirmed",
      ended: "Ended",
      cancelled: Number(tier || 0) > 0 ? "Cancelled; access remains" : "Cancelled",
      payment_failed: "Payment failed",
      suspended: "Suspended",
      expired: "Expired",
      pending: "Pending",
      revoked: "Revoked",
      none: "-",
    };

    return labels[status] || status || "-";
  };

  const paymentSourceLabel = (source) => {
    if (source === "moonpay") return "MoonPay Commerce";
    if (!source) return "-";
    return source;
  };

  const roleLabel = (role) => ({
    admin: "Admin",
    moderator: "Moderator",
    member: "Member",
    guest: "Guest",
  }[role] || "Member");


  const providerLabels = {
    google: "Google",
    x: "X",
    telegram: "Telegram",
    email: "Email",
    workspace: "Workspace",
  };

  const identityForProvider = (account, provider) => (account.identities || []).find((item) => item.provider === provider);

  const providerDisplayName = (identity) => {
    if (!identity) return "Not linked";
    return identity.provider_username || identity.provider_user_id || "Linked";
  };

  const providerStateText = (identity) => identity ? `Linked · ${providerDisplayName(identity)}` : "Not linked";

  const setAccountLinkMessageFromUrl = () => {
    const message = document.querySelector("[data-account-link-message]");
    if (!message) return;
    const params = new URLSearchParams(window.location.search);
    const error = params.get("link_error");
    if (error) {
      message.hidden = false;
      message.textContent = error;
    } else {
      message.hidden = true;
      message.textContent = "";
    }
  };

  const renderConnectedAccounts = async (account) => {
    const card = document.querySelector(".connected-accounts-card");
    if (!card || !account?.authenticated) return;

    ["google", "telegram"].forEach((provider) => {
      const identity = identityForProvider(account, provider);
      const status = document.querySelector(`[data-link-provider-status="${provider}"]`);
      const row = document.querySelector(`[data-link-provider-row="${provider}"]`);
      const button = document.querySelector(`[data-link-provider-button="${provider}"]`);
      if (status) status.textContent = providerStateText(identity);
      if (row) row.classList.toggle("is-linked", Boolean(identity));
      if (button) {
        button.hidden = Boolean(identity);
        button.textContent = `Link ${providerLabels[provider] || provider}`;
        button.classList.toggle("is-disabled", Boolean(identity));
        button.setAttribute("aria-disabled", identity ? "true" : "false");
        button.addEventListener("click", (event) => {
          if (button.classList.contains("is-disabled")) event.preventDefault();
        }, { once: true });
      }
    });

    const telegramCodeForm = document.querySelector("[data-telegram-code-form]");
    if (telegramCodeForm) telegramCodeForm.hidden = Boolean(identityForProvider(account, "telegram"));

    try {
      const config = await api("/api/account/links/config");
      ["google"].forEach((provider) => {
        const button = document.querySelector(`[data-link-provider-button="${provider}"]`);
        const status = document.querySelector(`[data-link-provider-status="${provider}"]`);
        const linked = Boolean(identityForProvider(account, provider));
        if (!button) return;
        if (!config.providers?.[provider] && !linked) {
          button.classList.add("is-disabled");
          button.setAttribute("aria-disabled", "true");
          button.addEventListener("click", (event) => event.preventDefault(), { once: true });
          if (status) status.textContent = "Not configured";
        }
      });
      renderTelegramLinkWidget(config, account);
    } catch (error) {
      const message = document.querySelector("[data-account-link-message]");
      if (message) {
        message.hidden = false;
        message.textContent = error.message || "Could not load account link settings.";
      }
    }

    setAccountLinkMessageFromUrl();
  };

  const renderTelegramLinkWidget = (config, account) => {
    const container = document.querySelector("[data-telegram-login-widget]");
    const telegramIdentity = identityForProvider(account, "telegram");
    if (!container) return;
    container.innerHTML = "";
    if (telegramIdentity) {
      container.hidden = true;
      return;
    }
    container.hidden = false;
    if (!config.providers?.telegram || !config.telegramBotUsername) {
      const note = document.createElement("span");
      note.className = "form-note inline-note";
      note.textContent = "Widget not configured";
      container.appendChild(note);
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", config.telegramBotUsername);
    script.setAttribute("data-size", "medium");
    script.setAttribute("data-auth-url", `${window.location.origin}/api/account/link/telegram/callback`);
    script.setAttribute("data-request-access", "write");
    container.appendChild(script);
  };

  const initTelegramCodeForm = () => {
    const form = document.querySelector("[data-telegram-code-form]");
    if (!form) return;
    const message = document.querySelector("[data-account-link-message]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = String(new FormData(form).get("code") || "").trim();
      if (!code) return;
      setFormBusy(form, true);
      if (message) message.textContent = "Linking Telegram...";
      try {
        const data = await api("/api/account/link/telegram-code", { method: "POST", body: JSON.stringify({ code }) });
        if (message) {
          message.hidden = false;
          message.textContent = data.message || "Telegram account linked.";
        }
        form.reset();
        await refreshAccount();
      } catch (error) {
        if (message) {
          message.hidden = false;
          message.textContent = error.message || "Could not link Telegram.";
        }
      } finally {
        setFormBusy(form, false);
      }
    });
  };

  const refreshAccount = async ({ render = true } = {}) => {
    const version = ++accountRequestVersion;
    const account = await api("/api/me");
    if (version !== accountRequestVersion) return null;
    currentAccountCache = account;
    if (render) renderAccount(account);
    return account;
  };

  const renderAccountError = (version) => {
    if (version !== accountRequestVersion) return;
    currentAccountCache = guestAccount();
    setAuthNavVisible(false);
    setAuthOnlyVisible(false);
    setGuestOnlyVisible(true);
    resetPrivilegedPanels();
    if (accountStateHeading) accountStateHeading.hidden = false;
    setText("[data-account-state]", "Local preview");
    document.querySelectorAll("[data-auth-gate], [data-auth-trigger]").forEach((item) => {
      item.hidden = false;
    });
  };

  const initAccount = async () => {
    if (!document.querySelector("[data-account-panel], [data-auth-nav], [data-auth-only], [data-guest-only], [data-community-chat]")) return;

    const version = ++accountRequestVersion;
    try {
      const account = await api("/api/me");
      if (version !== accountRequestVersion) return;
      currentAccountCache = account;
      renderAccount(account);
    } catch {
      renderAccountError(version);
    }
  };

  const closeAuthForms = () => {
    document.querySelectorAll("[data-auth-trigger]").forEach((button) => {
      button.classList.remove("is-active");
    });
    document.querySelectorAll("[data-auth-form]").forEach((form) => {
      form.hidden = true;
    });
  };

  const showAuthForm = (name) => {
    let shouldOpen = true;
    document.querySelectorAll("[data-auth-trigger]").forEach((button) => {
      const isTarget = button.dataset.authTrigger === name;
      if (isTarget && button.classList.contains("is-active")) {
        shouldOpen = false;
      }
      button.classList.toggle("is-active", isTarget && shouldOpen);
    });
    document.querySelectorAll("[data-auth-form]").forEach((form) => {
      form.hidden = !(shouldOpen && form.dataset.authForm === name);
    });
  };

  const initAuthTabs = () => {
    document.querySelectorAll("[data-auth-trigger]").forEach((button) => {
      button.addEventListener("click", () => showAuthForm(button.dataset.authTrigger));
    });
  };

  const initPasswordAuth = () => {
    let pendingRegistrationEmail = "";

    document.querySelectorAll('[data-auth-form="login"], [data-auth-form="register"]').forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const mode = form.dataset.authForm;
        const message = document.querySelector(`[data-auth-message="${mode}"]`);
        const body = Object.fromEntries(new FormData(form));

        if (authBusy) return;
        authBusy = true;
        setFormBusy(form, true);
        if (message) message.textContent = mode === "register" ? "Sending verification code..." : "Logging in...";

        try {
          const result = await api(`/api/auth/${mode}`, {
            method: "POST",
            body: JSON.stringify(body),
          });
          if (mode === "register" && result.pendingVerification) {
            pendingRegistrationEmail = result.email || body.email || "";
            const verifyForm = document.querySelector('[data-auth-form="verify-register"]');
            if (verifyForm) {
              if (verifyForm.elements.email) verifyForm.elements.email.value = pendingRegistrationEmail;
              document.querySelectorAll('[data-auth-form="login"], [data-auth-form="register"]').forEach((item) => {
                item.hidden = true;
              });
              verifyForm.hidden = false;
            }
            if (message) message.textContent = result.message || "Verification code sent.";
            return;
          }
          if (message) message.textContent = mode === "register" ? "Account created." : "Logged in.";
          await refreshAccount();
          form.reset();
        } catch (error) {
          if (message) message.textContent = error.message || "Could not continue.";
        } finally {
          authBusy = false;
          setFormBusy(form, false);
        }
      });
    });

    const verifyForm = document.querySelector('[data-auth-form="verify-register"]');
    if (verifyForm) {
      verifyForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const message = document.querySelector('[data-auth-message="verify-register"]');
        const body = Object.fromEntries(new FormData(verifyForm));
        body.email = body.email || pendingRegistrationEmail;
        if (authBusy) return;
        authBusy = true;
        setFormBusy(verifyForm, true);
        if (message) message.textContent = "Verifying code...";
        try {
          await api("/api/auth/register/verify", { method: "POST", body: JSON.stringify(body) });
          if (message) message.textContent = "Account verified.";
          await refreshAccount();
          verifyForm.reset();
          verifyForm.hidden = true;
        } catch (error) {
          if (message) message.textContent = error.message || "Could not verify code.";
        } finally {
          authBusy = false;
          setFormBusy(verifyForm, false);
        }
      });
    }
  };

  const initLogout = () => {
    const button = document.querySelector("[data-logout-button]");
    if (!button) return;

    button.addEventListener("click", async () => {
      if (logoutBusy) return;
      logoutBusy = true;
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = "Logging out...";

      try {
        accountRequestVersion += 1;
        await api("/api/logout", { method: "POST", body: "{}" }).catch(() => null);
        currentAccountCache = guestAccount();
        renderAccount(currentAccountCache);
        const profileForm = document.querySelector("[data-profile-form]");
        if (profileForm) delete profileForm.dataset.loaded;
      } finally {
        logoutBusy = false;
        button.disabled = false;
        button.textContent = previous;
      }
    });
  };

  const initRenewalControls = () => {
    const bindRenewalButton = (selector, endpoint, workingText) => {
      const button = document.querySelector(selector);
      if (!button) return;

      button.addEventListener("click", async () => {
        const previous = button.textContent;
        const message = document.querySelector("[data-subscription-message]");
        button.disabled = true;
        button.textContent = workingText;
        if (message) message.textContent = workingText;

        try {
          const result = await api(endpoint, { method: "POST", body: "{}" });
          if (message) message.textContent = result.message || "Subscription updated.";
          renderAccount(await api("/api/me"));
        } catch (error) {
          button.disabled = false;
          button.textContent = previous;
          if (message) message.textContent = error.message || "Could not update renewal.";
        }
      });
    };

    bindRenewalButton("[data-cancel-renewal-button]", "/api/subscription/cancel-renewal", "Cancelling renewal...");
    bindRenewalButton("[data-resume-renewal-button]", "/api/subscription/resume-renewal", "Resuming renewal...");
  };

  const initBuildLaunch = () => {
    const link = document.querySelector("[data-build-launch]");
    if (!link) return;

    link.addEventListener("click", async (event) => {
      const fallbackUrl = link.getAttribute("href") || "https://biopunk-vn-hub-ea.pages.dev/";
      event.preventDefault();
      link.classList.add("is-loading");
      link.setAttribute("aria-busy", "true");

      try {
        const launch = await api("/api/builds/current/launch", { method: "POST", body: "{}" });
        window.location.href = launch.launchUrl || fallbackUrl;
      } catch {
        window.location.href = fallbackUrl;
      } finally {
        link.classList.remove("is-loading");
        link.removeAttribute("aria-busy");
      }
    });
  };

  const initMoonPaySubscriptions = async () => {
    const containers = [...document.querySelectorAll("[data-moonpay-widget]")];
    if (!containers.length) return;

    const setTierMessage = (tier, text) => {
      const message = document.querySelector(`[data-moonpay-message="${tier}"]`);
      if (message) message.textContent = text;
    };

    const setJoinButton = (tier, mode, message) => {
      const button = document.querySelector(`[data-moonpay-fallback="${tier}"]`);
      if (!button) return;

      button.hidden = false;
      button.disabled = false;
      button.onclick = () => {
        if (mode === "login") {
          window.location.href = "account.html#connect-account";
          return;
        }
        setTierMessage(tier, message);
      };
    };

    const pollMoonPayAccess = async (tier, showMessage, session = {}) => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt ? 2200 : 900));
        try {
          const account = await api("/api/me");
          const activeTier = Number(account.subscription?.tier || 0);
          const source = account.subscription?.paymentSource || account.subscription?.source;
          const moonpayTier = Number(account.subscription?.moonpayTier || 0);
          const moonpayStatus = account.subscription?.renewalStatus || account.subscription?.status || "none";
          const confirmedMoonPayTier = moonpayTier === Number(tier) && ["active", "renewed"].includes(moonpayStatus);
          const upgradedAccess = source === "moonpay" && activeTier >= Number(tier || 0);

          if (account.authenticated && (confirmedMoonPayTier || upgradedAccess)) {
            const scheduledStartsAt = session.scheduledStartsAt || null;
            const message = scheduledStartsAt
              ? `MoonPay confirmed the membership. Tier ${tier} will take over after ${formatDate(scheduledStartsAt)}.`
              : "MoonPay confirmed the membership. Redirecting to account...";
            showMessage(message);
            window.setTimeout(() => window.location.href = "account.html#connect-account", 900);
            return true;
          }
        } catch {
          // Keep the checkout UX calm; webhook delivery can finish independently.
        }
      }
      showMessage("Payment submitted. Access will appear here after the MoonPay webhook is confirmed.");
      return false;
    };

    containers.forEach((container) => {
      const tier = container.dataset.moonpayWidget;
      container.hidden = true;
      setJoinButton(tier, "login", "Log in or register before subscribing.");
    });

    try {
      const [account, config] = await Promise.all([
        api("/api/me"),
        api("/api/moonpay/config"),
      ]);

      if (!account.authenticated) {
        containers.forEach((container) => {
          const tier = container.dataset.moonpayWidget;
          container.hidden = true;
          setJoinButton(tier, "login", "Log in or register before subscribing.");
          setTierMessage(tier, "Log in or register before subscribing.");
        });
        return;
      }

      if (!config.configured) {
        containers.forEach((container) => {
          const tier = container.dataset.moonpayWidget;
          container.hidden = true;
          setJoinButton(tier, "notice", "MoonPay Commerce is not configured yet.");
          setTierMessage(tier, "MoonPay Commerce subscription Pay Links are not configured yet.");
        });
        return;
      }

      await loadScriptOnce(
        config.widgetScriptUrl || "https://embed.hel.io/assets/index-v1.js",
        "moonpay-commerce-checkout",
        () => Boolean(window.helioCheckout),
      );

      await Promise.all(containers.map(async (container) => {
        const tier = Number(container.dataset.moonpayWidget || 0);
        const plan = config.plans?.[tier];
        const fallback = document.querySelector(`[data-moonpay-fallback="${tier}"]`);
        const activeTier = Number(account.subscription?.tier || 0);
        const activeExpiresAt = account.subscription?.expiresAt || null;
        const scheduledDowngrade = account.subscription?.scheduledDowngrade || null;
        const hasScheduledDowngrade = Boolean(scheduledDowngrade && Number(scheduledDowngrade.tier || 0) > 0 && Number(scheduledDowngrade.tier || 0) < activeTier);

        if (!plan?.paylinkId || !window.helioCheckout) {
          setJoinButton(tier, "notice", "This tier is not connected to MoonPay Commerce yet.");
          setTierMessage(tier, "This tier is not connected to MoonPay Commerce yet.");
          return;
        }

        if (activeTier === tier && account.subscription?.cancelAtPeriodEnd && !hasScheduledDowngrade) {
          if (fallback) {
            fallback.hidden = false;
            fallback.disabled = false;
            fallback.textContent = "Resume renewal";
            fallback.onclick = async () => {
              fallback.disabled = true;
              fallback.textContent = "Resuming...";
              setTierMessage(tier, "Resuming renewal in Ravene Hub...");
              try {
                await api("/api/subscription/resume-renewal", { method: "POST", body: "{}" });
                window.location.reload();
              } catch (error) {
                fallback.disabled = false;
                fallback.textContent = "Resume renewal";
                setTierMessage(tier, error.message || "Could not resume renewal.");
              }
            };
          }
          container.hidden = true;
          setTierMessage(tier, `Renewal is cancelled. Paid access remains until ${formatDate(activeExpiresAt)}.`);
          return;
        }

        if (activeTier === tier && !hasScheduledDowngrade) {
          if (fallback) {
            fallback.hidden = false;
            fallback.disabled = true;
            fallback.textContent = "Current membership";
          }
          container.hidden = true;
          setTierMessage(tier, "This membership tier is already active.");
          return;
        }

        let session;
        try {
          session = await api("/api/moonpay/checkout/session", {
            method: "POST",
            body: JSON.stringify({ tier }),
          });
        } catch (error) {
          if (fallback) {
            fallback.hidden = false;
            fallback.disabled = true;
            fallback.textContent = error.code === "tier_already_active" ? "Current membership" : "Unavailable";
          }
          container.hidden = true;
          setTierMessage(tier, "Membership checkout is temporarily unavailable. Please try again after the site update is fully deployed.");
          return;
        }

        if (fallback) fallback.hidden = true;
        container.hidden = false;
        container.innerHTML = "";

        const isReturnToCurrentTier = session.accessMode === "return_to_current_tier";
        const isDowngrade = session.accessMode === "downgrade_after_current_period" || (!isReturnToCurrentTier && activeTier > tier);
        const isUpgrade = session.accessMode === "upgrade_immediate" || (activeTier > 0 && tier > activeTier);
        const scheduledStartsAt = session.scheduledStartsAt || activeExpiresAt;
        const replacedTier = Number(session.replacesTier || scheduledDowngrade?.tier || 0);
        const message = isReturnToCurrentTier
          ? `Return to Tier ${tier}. Your current Tier ${tier} access stays active until ${formatDate(scheduledStartsAt)}; the scheduled Tier ${replacedTier || 1} downgrade will be replaced after MoonPay confirms the payment.`
          : isDowngrade
            ? `Your current Tier ${activeTier} access stays active until ${formatDate(scheduledStartsAt)}. Tier ${tier} will take over after that period.`
            : isUpgrade
              ? `Upgrade to Tier ${tier}. This charges the full Tier ${tier} price, activates higher access immediately after MoonPay confirms it, and marks the lower MoonPay tier as replaced in Ravene Hub.`
              : "Monthly membership via MoonPay Commerce.";
        setTierMessage(tier, message);

        window.helioCheckout(container, {
          paylinkId: session.paylinkId || plan.paylinkId,
          network: session.network || config.network || "main",
          paymentType: "paylink",
          primaryPaymentMethod: session.primaryPaymentMethod || config.primaryPaymentMethod || "crypto",
          display: "button",
          theme: { themeMode: "dark" },
          customTexts: {
            mainButtonTitle: isReturnToCurrentTier ? `Return to Tier ${tier}` : isDowngrade ? `Switch to Tier ${tier}` : isUpgrade ? `Upgrade to Tier ${tier}` : "Join with MoonPay",
            payButtonTitle: isReturnToCurrentTier ? `Keep Tier ${tier}` : isDowngrade ? "Confirm next membership" : isUpgrade ? "Pay full Tier 2 price" : "Start membership",
          },
          autofillConfig: {
            email: account.user?.email || "",
            fullName: account.user?.displayName || "",
          },
          additionalJSON: {
            provider: "moonpay_commerce",
            source: "ravene_hub_membership",
            userId: account.user?.id || "",
            tier,
            accessMode: session.accessMode || "new",
            scheduledStartsAt: session.scheduledStartsAt || "",
            checkoutSessionId: session.sessionId || "",
            checkoutToken: session.checkoutToken || "",
            accountEmail: account.user?.email || "",
          },
          onStartPayment: () => setTierMessage(tier, "MoonPay checkout started. Confirm the payment in the widget."),
          onPending: () => setTierMessage(tier, isReturnToCurrentTier ? `Payment is pending. Tier ${tier} will remain scheduled after your current period once MoonPay confirms it.` : isDowngrade ? "Payment is pending. Tier change is scheduled after your current higher tier ends." : "Payment is pending. Access activates after MoonPay confirms it."),
          onSuccess: () => pollMoonPayAccess(tier, (nextMessage) => setTierMessage(tier, nextMessage), session),
          onCancel: () => setTierMessage(tier, "Checkout was closed before confirmation."),
          onError: (error) => {
            console.error(error);
            setTierMessage(tier, "MoonPay Commerce could not start the membership checkout.");
          },
        });
      }));
    } catch (error) {
      containers.forEach((container) => {
        const tier = container.dataset.moonpayWidget;
        container.hidden = true;
        setJoinButton(tier, "notice", "Membership checkout is temporarily unavailable.");
        setTierMessage(tier, "Membership checkout is temporarily unavailable. Please try again after the site update is fully deployed.");
      });
    }
  };

  const escapeHTML = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const shortDateTime = (value) => {
    if (!value) return "";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  };

  const postDate = (value) => value ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "-";

  const textToParagraphs = (value) => String(value || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHTML(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const postSlugFromLocation = () => {
    const pathMatch = window.location.pathname.match(/\/post\/([^/?#]+)/);
    if (pathMatch) return decodeURIComponent(pathMatch[1] || "");
    const params = new URLSearchParams(window.location.search);
    return params.get("post") || "";
  };

  const postPermalink = (slug) => {
    const cleanSlug = encodeURIComponent(slug || "alternative-system-for-early-access-verification");
    if (window.location.protocol === "file:") return `post-alternative-system.html?post=${cleanSlug}`;
    return `/post/${cleanSlug}`;
  };

  const postHref = (post) => post.staticHref || postPermalink(post.slug || "alternative-system-for-early-access-verification");

  const mediaMarkup = (media = []) => media.map((item) => {
    const url = escapeHTML(item.url || "");
    const caption = item.caption ? `<figcaption>${escapeHTML(item.caption)}</figcaption>` : "";
    if (item.type === "image") return `<figure class="post-media-item"><img src="${url}" alt="${escapeHTML(item.title || item.caption || "Post image")}" />${caption}</figure>`;
    if (item.type === "video") return `<figure class="post-media-item"><video controls src="${url}"></video>${caption}</figure>`;
    if (item.type === "audio") return `<figure class="post-media-item"><audio controls src="${url}"></audio>${caption}</figure>`;
    return `<p><a class="mini-btn" href="${url}" target="_blank" rel="noopener">${escapeHTML(item.title || item.url)}</a></p>`;
  }).join("");

  const setCommentCount = (count) => {
    document.querySelectorAll("[data-comment-count]").forEach((item) => {
      item.textContent = String(count);
    });
    document.querySelectorAll("[data-comment-summary]").forEach((item) => {
      item.textContent = `Comments ${count}`;
    });
  };

  const setLikeState = (post) => {
    const count = Number(post?.likeCount || 0);
    document.querySelectorAll("[data-like-count]").forEach((item) => {
      item.textContent = String(count);
    });
    document.querySelectorAll("[data-like-post]").forEach((button) => {
      button.classList.toggle("is-active", Boolean(post?.likedByMe));
      button.dataset.previousCount = String(count);
      button.textContent = `Likes ${count}`;
      button.disabled = false;
    });
  };

  const renderComments = (comments) => {
    const list = document.querySelector("[data-comment-list]");
    if (!list) return;

    setCommentCount(comments.length);

    if (!comments.length) {
      list.innerHTML = `<p class="form-note">No comments yet. Start the conversation.</p>`;
      return;
    }

    list.innerHTML = comments.map((comment) => `
      <article class="comment-item" data-comment-id="${escapeHTML(comment.id)}">
        <img src="${escapeHTML(comment.authorAvatar || "assets/media/profile/avatar.webp")}" alt="" />
        <div class="comment-item-body">
          <div class="comment-item-head"><strong>${escapeHTML(comment.authorName)}</strong><span>${escapeHTML(shortDateTime(comment.createdAt))}</span></div>
          <p class="text">${escapeHTML(comment.body).replace(/\n/g, "<br>")}</p>
          ${comment.canDelete ? `<button class="mini-btn danger" type="button" data-delete-comment="${escapeHTML(comment.id)}">Delete</button>` : ""}
        </div>
      </article>
    `).join("");
  };

  const initPostComments = async () => {
    const page = document.querySelector("[data-post-page]");
    const form = document.querySelector("[data-comment-form]");
    const message = document.querySelector("[data-comment-message]");
    const loginLink = document.querySelector("[data-comment-login]");
    if (!page || !form) return;

    const postSlug = postSlugFromLocation() || page.dataset.postSlug || "alternative-system-for-early-access-verification";
    page.dataset.postSlug = postSlug;

    const loadComments = async () => {
      try {
        const data = await api(`/api/post-comments?post=${encodeURIComponent(postSlug)}`);
        renderComments(data.comments || []);
      } catch (error) {
        const list = document.querySelector("[data-comment-list]");
        if (list) list.innerHTML = `<p class="form-note">${escapeHTML(error.message || "Comments are not available yet.")}</p>`;
      }
    };

    try {
      const account = currentAccountCache || await api("/api/me");
      currentAccountCache = account;
      const authenticated = Boolean(account.authenticated);
      form.querySelector("textarea").disabled = !authenticated;
      form.querySelector('button[type="submit"]').hidden = !authenticated;
      if (loginLink) loginLink.hidden = authenticated;
      if (message) {
        message.textContent = authenticated
          ? "Write as your Ravene Hub account."
          : "Log in or register to comment.";
      }
    } catch {
      form.querySelector("textarea").disabled = true;
      form.querySelector('button[type="submit"]').hidden = true;
      if (loginLink) loginLink.hidden = false;
      if (message) message.textContent = "Open the hosted Worker build to use comments.";
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = String(new FormData(form).get("body") || "").trim();
      if (!body) {
        if (message) message.textContent = "Write a comment first.";
        return;
      }

      if (message) message.textContent = "Sending comment...";

      try {
        const data = await api("/api/post-comments", {
          method: "POST",
          body: JSON.stringify({ postSlug, body }),
        });
        form.reset();
        renderComments(data.comments || []);
        if (message) message.textContent = "Comment posted.";
      } catch (error) {
        if (message) message.textContent = error.message || "Could not send comment.";
      }
    });

    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-delete-comment]");
      if (!button || !page.contains(button)) return;
      button.disabled = true;
      try {
        const data = await api(`/api/post-comments/${encodeURIComponent(button.dataset.deleteComment)}`, { method: "DELETE" });
        renderComments(data.comments || []);
        if (message) message.textContent = "Comment deleted.";
      } catch (error) {
        button.disabled = false;
        if (message) message.textContent = error.message || "Could not delete comment.";
      }
    });

    await loadComments();
  };

  const postVisibilityLabel = (value) => {
    const visibility = String(value || "public").toLowerCase();
    if (visibility === "registered") return "Members";
    if (visibility === "tier1") return "Tier 1+";
    if (visibility === "tier2") return "Tier 2+";
    if (visibility === "tier3") return "Tier 3";
    if (visibility === "moderator") return "Moderators";
    if (visibility === "admin") return "Admins";
    return "Public";
  };

  const postMetaMarkup = (post) => `
    <div class="post-meta-row">
      <span>${escapeHTML(post.category || "Development")}</span>
      <span>${escapeHTML(postDate(post.publishedAt))}</span>
      <span class="post-access-badge">${escapeHTML(postVisibilityLabel(post.visibility))}</span>
    </div>
  `;

  const renderPostCard = (post) => `
    <a class="post-feed-row" href="${escapeHTML(postHref(post))}">
      <div class="post-feed-cover">
        <img src="${escapeHTML(post.coverUrl || "assets/media/posts/biopunk-duo.webp")}" alt="${escapeHTML(post.title)} artwork" />
      </div>
      <div class="post-feed-body">
        ${postMetaMarkup(post)}
        <h3>${escapeHTML(post.title)}</h3>
        <p class="text">${escapeHTML(post.excerpt || "")}</p>
        <div class="reaction-line"><span>Likes ${post.likeCount || 0}</span><span>${post.commentCount || 0} comments</span></div>
      </div>
    </a>
  `;

  const renderPostThumb = (post) => `
    <a class="post-feed-row" href="${escapeHTML(postHref(post))}">
      <div class="post-feed-cover">
        <img src="${escapeHTML(post.coverUrl || "assets/media/posts/biopunk-duo.webp")}" alt="${escapeHTML(post.title)} artwork" />
      </div>
      <div class="post-feed-body">
        ${postMetaMarkup(post)}
        <h3>${escapeHTML(post.title)}</h3>
        <p class="text">${escapeHTML(post.excerpt || "")}</p>
        <div class="reaction-line"><span>Likes ${post.likeCount || 0}</span><span>${post.commentCount || 0} comments</span></div>
      </div>
    </a>
  `;

  const renderPinnedPost = (post) => `
    <a class="glass card pinned-post-card" href="${escapeHTML(postHref(post))}">
      <div class="meta"><span>Pinned</span><span>${escapeHTML(post.category || "Post")}</span></div>
      <h3>${escapeHTML(post.title)}</h3>
      <p class="text">${escapeHTML(post.excerpt || "")}</p>
    </a>
  `;

  const renderFeedPosts = (mode, selected) => {
    if (mode === "grid") return selected.map((post) => renderPostThumb(post)).join("");
    if (mode === "pinned") return `<div class="pinned-post-list">${selected.map((post) => renderPinnedPost(post)).join("")}</div>`;
    return selected.map((post) => renderPostCard(post)).join("");
  };

  const initPostFeeds = async () => {
    const feedTargets = Array.from(document.querySelectorAll("[data-post-feed]"));
    if (!feedTargets.length) return;

    const grouped = feedTargets.reduce((map, target) => {
      const mode = target.dataset.postFeed;
      const key = mode === "pinned" ? "pinned" : "default";
      if (!map[key]) map[key] = [];
      map[key].push(target);
      return map;
    }, {});

    const fallbackForMode = (mode) => (mode === "pinned" ? (window.fallbackPinnedPosts || []) : (window.fallbackPosts || []));

    const loadGroup = async (key, targets) => {
      const data = await api(key === "pinned" ? "/api/posts?pinned=1" : "/api/posts");
      const posts = data.posts || [];
      targets.forEach((target) => {
        const mode = target.dataset.postFeed;
        const limit = Number(target.dataset.limit || 12);
        const offset = Number(target.dataset.offset || 0);
        const source = posts.length ? posts : fallbackForMode(mode);
        const selected = source.slice(offset, offset + limit);
        target.innerHTML = selected.length ? renderFeedPosts(mode, selected) : "";
      });
    };

    await Promise.all(Object.entries(grouped).map(async ([key, targets]) => {
      try {
        await loadGroup(key, targets);
      } catch {
        targets.forEach((target) => {
          const mode = target.dataset.postFeed;
          const limit = Number(target.dataset.limit || 12);
          const offset = Number(target.dataset.offset || 0);
          const source = fallbackForMode(target.dataset.postFeed);
          const selected = source.slice(offset, offset + limit);
          target.innerHTML = selected.length ? renderFeedPosts(target.dataset.postFeed, selected) : "";
        });
      }
    }));
  };

  const initPostDetail = async () => {
    const page = document.querySelector("[data-post-page]");
    if (!page) return;
    const postSlug = postSlugFromLocation() || page.dataset.postSlug || "alternative-system-for-early-access-verification";
    page.dataset.postSlug = postSlug;

    try {
      const data = await api(`/api/posts/${encodeURIComponent(postSlug)}`);
      const post = data.post;
      if (!post) return;
      document.title = `${post.title} · Ravene Hub`;
      setText("[data-post-title]", post.title);
      setText("[data-post-category]", post.category || "Development");
      setText("[data-post-date]", postDate(post.publishedAt));
      setText("[data-post-visibility]", post.visibility || "public");
      setText("[data-post-author]", post.authorName || "Ravene");
      setText("[data-post-author-date]", `Posted ${postDate(post.publishedAt)}`);
      const hero = document.querySelector("[data-post-cover]");
      if (hero) hero.src = post.coverUrl || "assets/media/posts/biopunk-duo.webp";
      const content = document.querySelector("[data-post-content]");
      if (content) content.innerHTML = textToParagraphs(post.body) + mediaMarkup((post.media || []).filter((item) => item.url !== post.coverUrl));
      setCommentCount(post.commentCount || 0);
      setLikeState(post);
      const editLink = document.querySelector("[data-edit-post-link]");
      if (editLink) {
        editLink.hidden = !post.canEdit;
        editLink.href = `account.html#admin-posts`;
      }
    } catch (error) {
      const content = document.querySelector("[data-post-content]");
      const params = new URLSearchParams(window.location.search);
      if (content && params.get("post")) content.innerHTML = `<p>${escapeHTML(error.message || "Post is not available.")}</p>`;
    }
  };

  const initPostLikes = () => {
    document.querySelectorAll("[data-like-post]").forEach((button) => {
      button.addEventListener("click", async () => {
        const page = document.querySelector("[data-post-page]");
        const slug = page?.dataset.postSlug || button.dataset.likePost;
        if (!slug) return;
        button.disabled = true;
        const liked = button.classList.contains("is-active");
        try {
          const data = await api(`/api/posts/${encodeURIComponent(slug)}/like`, { method: liked ? "DELETE" : "POST" });
          setLikeState(data.post);
        } catch (error) {
          button.disabled = false;
          button.textContent = error.message || "Login required";
          window.setTimeout(() => setLikeState({ likedByMe: liked, likeCount: Number(button.dataset.previousCount || 0) }), 1200);
        }
      });
    });
  };

  const mediaFromForm = (form) => {
    const media = [];
    const types = form.querySelectorAll('[name="mediaType"]');
    const urls = form.querySelectorAll('[name="mediaUrl"]');
    const captions = form.querySelectorAll('[name="mediaCaption"]');
    types.forEach((type, index) => {
      const url = urls[index]?.value?.trim();
      if (!url) return;
      media.push({ type: type.value, url, caption: captions[index]?.value || "" });
    });
    return media;
  };

  const fillPostForm = (form, post = {}) => {
    form.dataset.editingSlug = post.slug || "";
    const fields = form.elements;
    fields.title.value = post.title || "";
    fields.slug.value = post.slug || "";
    fields.category.value = post.category || "Development";
    fields.status.value = post.status || "published";
    fields.visibility.value = post.visibility || "public";
    fields.coverUrl.value = post.coverUrl || "";
    fields.excerpt.value = post.excerpt || "";
    fields.body.value = post.body || "";
    if (fields.pinned) fields.pinned.checked = Boolean(post.pinned || post.pinnedAt);
    const mediaBox = form.querySelector("[data-media-fields]");
    if (mediaBox) {
      const media = post.media?.length ? post.media : [{}];
      mediaBox.innerHTML = media.map((item) => mediaFieldMarkup(item)).join("");
    }
  };

  const mediaFieldMarkup = (item = {}) => `
    <div class="media-field-row">
      <select name="mediaType"><option value="image" ${item.type === "image" ? "selected" : ""}>Image</option><option value="video" ${item.type === "video" ? "selected" : ""}>Video</option><option value="audio" ${item.type === "audio" ? "selected" : ""}>Audio</option><option value="link" ${item.type === "link" ? "selected" : ""}>Link</option></select>
      <input name="mediaUrl" type="text" placeholder="assets/media/... or https://..." value="${escapeHTML(item.url || "")}" />
      <input name="mediaCaption" type="text" placeholder="Caption" value="${escapeHTML(item.caption || "")}" />
      <button class="mini-btn danger" type="button" data-remove-media>×</button>
    </div>
  `;

  const renderAdminPosts = (posts) => {
    const list = document.querySelector("[data-admin-post-list]");
    if (!list) return;
    if (!posts.length) {
      list.innerHTML = `<p class="form-note">No posts yet.</p>`;
      return;
    }
    list.innerHTML = posts.map((post) => `
      <article class="admin-row">
        <div><strong>${escapeHTML(post.title)}</strong><span>${escapeHTML(post.status)} · ${escapeHTML(post.visibility)} · ${post.pinned || post.pinnedAt ? "Pinned · " : ""}${escapeHTML(postDate(post.publishedAt))}</span></div>
        <div class="admin-row-actions">
          <button class="mini-btn" type="button" data-admin-edit-post="${escapeHTML(post.slug)}">Edit</button>
          <button class="mini-btn danger" type="button" data-admin-delete-post="${escapeHTML(post.slug)}">Delete</button>
        </div>
      </article>
    `).join("");
  };

  const renderAdminUsers = (users) => {
    const list = document.querySelector("[data-admin-user-list]");
    if (!list) return;
    if (!users.length) {
      list.innerHTML = `<p class="form-note">No users yet.</p>`;
      return;
    }
    list.innerHTML = users.map((user) => `
      <article class="admin-row">
        <div><strong>${escapeHTML(user.displayName)}</strong><span>${escapeHTML(user.email || "no email")} · Tier ${user.tier || 0} · ${escapeHTML(user.isOwner ? "Owner" : "User")}</span></div>
        <div class="admin-row-actions">
          <select data-role-select="${escapeHTML(user.id)}" ${user.isOwner ? "disabled" : ""}>
            <option value="member" ${user.role === "member" ? "selected" : ""}>Member</option>
            <option value="moderator" ${user.role === "moderator" ? "selected" : ""}>Moderator</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
          <button class="mini-btn" type="button" data-save-role="${escapeHTML(user.id)}" ${user.isOwner ? "disabled" : ""}>Save</button>
        </div>
      </article>
    `).join("");
  };

  const initAdminPanel = async () => {
    const panel = document.querySelector("[data-admin-panel]");
    if (!panel) return;
    const message = document.querySelector("[data-admin-message]");
    const form = document.querySelector("[data-admin-post-form]");
    const mediaBox = document.querySelector("[data-media-fields]");
    let adminLoaded = false;
    let adminLoading = false;

    const loadAdmin = async () => {
      if (!currentAccountCache?.permissions?.canManagePosts) return;
      const adminWorkspaceState = applyAdminWorkspaceState();
      if (!adminWorkspaceState.posts) return;
      if (adminLoading) return;
      adminLoading = true;
      panel.hidden = false;
      if (message && !adminLoaded) message.textContent = "Loading admin panel...";
      try {
        const posts = await api("/api/posts?scope=all");
        renderAdminPosts(posts.posts || []);
        adminLoaded = true;
        if (message) message.textContent = "Admin panel loaded.";
      } catch (error) {
        if (message) message.textContent = error.message || "Admin access is not available.";
      } finally {
        adminLoading = false;
      }
    };

    adminPanelLoader = loadAdmin;

    if (mediaBox && !mediaBox.children.length) mediaBox.innerHTML = mediaFieldMarkup();

    document.addEventListener("click", async (event) => {
      const addMedia = event.target.closest("[data-add-media]");
      if (addMedia && mediaBox) {
        mediaBox.insertAdjacentHTML("beforeend", mediaFieldMarkup());
      }
      const removeMedia = event.target.closest("[data-remove-media]");
      if (removeMedia) removeMedia.closest(".media-field-row")?.remove();

      const editButton = event.target.closest("[data-admin-edit-post]");
      if (editButton && form) {
        const data = await api(`/api/posts/${encodeURIComponent(editButton.dataset.adminEditPost)}`);
        fillPostForm(form, data.post);
        if (message) message.textContent = "Post loaded into editor.";
      }

      const deleteButton = event.target.closest("[data-admin-delete-post]");
      if (deleteButton) {
        deleteButton.disabled = true;
        try {
          await api(`/api/posts/${encodeURIComponent(deleteButton.dataset.adminDeletePost)}`, { method: "DELETE" });
          adminLoaded = false;
          await loadAdmin();
          if (message) message.textContent = "Post deleted.";
        } catch (error) {
          deleteButton.disabled = false;
          if (message) message.textContent = error.message || "Could not delete post.";
        }
      }

      const clearButton = event.target.closest("[data-clear-post-form]");
      if (clearButton && form) fillPostForm(form, {});
    });

    if (form) {
      fillPostForm(form, {});
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        const payload = {
          title: values.title,
          slug: values.slug,
          category: values.category,
          status: values.status,
          visibility: values.visibility,
          coverUrl: values.coverUrl,
          excerpt: values.excerpt,
          body: values.body,
          pinned: Boolean(values.pinned),
          media: mediaFromForm(form),
        };
        const editingSlug = form.dataset.editingSlug;
        if (message) message.textContent = editingSlug ? "Saving post..." : "Creating post...";
        try {
          const data = await api(editingSlug ? `/api/posts/${encodeURIComponent(editingSlug)}` : "/api/posts", {
            method: editingSlug ? "PUT" : "POST",
            body: JSON.stringify(payload),
          });
          fillPostForm(form, data.post);
          adminLoaded = false;
          await loadAdmin();
          if (message) message.textContent = editingSlug ? "Post saved." : "Post created.";
        } catch (error) {
          if (message) message.textContent = error.message || "Could not save post.";
        }
      });
    }

    if (currentAccountCache?.permissions?.canManagePosts && readAdminWorkspaceState().posts) {
      await loadAdmin();
    }
  };


  const renderAdminChatQueue = (items) => {
    const list = document.querySelector("[data-admin-chat-queue]");
    if (!list) return;
    if (!items.length) {
      list.innerHTML = `<p class="form-note">No quarantined messages. Clean air for now.</p>`;
      return;
    }
    list.innerHTML = items.map((item) => `
      <article class="admin-row admin-chat-row" data-queue-row="${escapeHTML(item.id)}">
        <div>
          <strong>${escapeHTML(item.decision === "blocked" ? "Blocked" : "Quarantined")} · ${escapeHTML(item.queueType === "edit_message" ? "edited message" : "new message")} · ${escapeHTML(item.authorName)}</strong>
          <span>${escapeHTML(shortDateTime(item.createdAt))} · ${escapeHTML(item.reason || "Needs review")} · ${(item.categories || []).map(escapeHTML).join(", ")}</span>
          ${item.previousBody ? `<p class="admin-hidden-body" hidden data-queue-previous="${escapeHTML(item.id)}"><strong>Previous:</strong><br>${escapeHTML(item.previousBody).replace(/\n/g, "<br>")}</p>` : ""}
          <p class="admin-hidden-body" data-queue-body="${escapeHTML(item.id)}" hidden>${escapeHTML(item.body).replace(/\n/g, "<br>")}</p>
          <div class="chat-translation" data-queue-translation="${escapeHTML(item.id)}" hidden></div>
        </div>
        <div class="admin-row-actions">
          <button class="mini-btn" type="button" data-show-queue-message="${escapeHTML(item.id)}">Show text</button>
          <select data-queue-translate-language="${escapeHTML(item.id)}">
            ${chatLanguageOptions.map((language) => `<option value="${escapeHTML(language)}">${escapeHTML(language)}</option>`).join("")}
          </select>
          <button class="mini-btn" type="button" data-translate-queue="${escapeHTML(item.id)}">Translate</button>
          <button class="mini-btn" type="button" data-approve-queue="${escapeHTML(item.id)}">Approve</button>
          <button class="mini-btn danger" type="button" data-dismiss-queue="${escapeHTML(item.id)}">Dismiss</button>
        </div>
      </article>
    `).join("");
  };

  const initAdminChatModeration = async () => {
    const panel = document.querySelector("[data-admin-chat-panel]");
    if (!panel) return;
    const message = document.querySelector("[data-admin-chat-message]");
    let queueLoaded = false;
    let queueLoading = false;

    const loadQueue = async () => {
      if (!currentAccountCache?.permissions?.canManagePosts) return;
      const adminWorkspaceState = applyAdminWorkspaceState();
      if (!adminWorkspaceState.chat) return;
      if (queueLoading) return;
      queueLoading = true;
      panel.hidden = false;
      if (message && !queueLoaded) message.textContent = "Loading chat shield...";
      try {
        const data = await api("/api/admin/chat/moderation-queue");
        renderAdminChatQueue(data.items || []);
        queueLoaded = true;
        if (message) message.textContent = "Hidden messages are not shown in public chat.";
      } catch (error) {
        if (message) message.textContent = error.message || "Chat moderation is not available.";
      } finally {
        queueLoading = false;
      }
    };

    adminChatModerationLoader = loadQueue;

    document.addEventListener("click", async (event) => {
      const showButton = event.target.closest("[data-show-queue-message]");
      if (showButton && panel.contains(showButton)) {
        const id = showButton.dataset.showQueueMessage;
        const body = panel.querySelector(`[data-queue-body="${CSS.escape(id)}"]`);
        const previous = panel.querySelector(`[data-queue-previous="${CSS.escape(id)}"]`);
        if (body) {
          const nextHidden = !body.hidden;
          body.hidden = nextHidden;
          if (previous) previous.hidden = nextHidden;
          showButton.textContent = body.hidden ? "Show text" : "Hide text";
        }
        return;
      }

      const translateButton = event.target.closest("[data-translate-queue]");
      if (translateButton && panel.contains(translateButton)) {
        const id = translateButton.dataset.translateQueue;
        const language = panel.querySelector(`[data-queue-translate-language="${CSS.escape(id)}"]`)?.value || "English";
        const target = panel.querySelector(`[data-queue-translation="${CSS.escape(id)}"]`);
        translateButton.disabled = true;
        if (target) {
          target.hidden = false;
          target.textContent = "Translating...";
        }
        try {
          const data = await api(`/api/admin/chat/moderation-queue/${encodeURIComponent(id)}/translate`, {
            method: "POST",
            body: JSON.stringify({ targetLanguage: language }),
          });
          if (target) target.innerHTML = `<strong>${escapeHTML(data.targetLanguage)}:</strong> ${escapeHTML(data.translation).replace(/\n/g, "<br>")}`;
        } catch (error) {
          if (target) target.textContent = error.message || "Could not translate message.";
        } finally {
          translateButton.disabled = false;
        }
        return;
      }

      const approveButton = event.target.closest("[data-approve-queue]");
      if (approveButton && panel.contains(approveButton)) {
        approveButton.disabled = true;
        try {
          const data = await api(`/api/admin/chat/moderation-queue/${encodeURIComponent(approveButton.dataset.approveQueue)}/approve`, { method: "POST" });
          renderAdminChatQueue(data.items || []);
          if (message) message.textContent = "Message approved and published.";
          if (communityChatLoader) communityChatLoader();
        } catch (error) {
          approveButton.disabled = false;
          if (message) message.textContent = error.message || "Could not approve message.";
        }
        return;
      }

      const dismissButton = event.target.closest("[data-dismiss-queue]");
      if (dismissButton && panel.contains(dismissButton)) {
        dismissButton.disabled = true;
        try {
          const data = await api(`/api/admin/chat/moderation-queue/${encodeURIComponent(dismissButton.dataset.dismissQueue)}/dismiss`, { method: "POST" });
          renderAdminChatQueue(data.items || []);
          if (message) message.textContent = "Message dismissed.";
        } catch (error) {
          dismissButton.disabled = false;
          if (message) message.textContent = error.message || "Could not dismiss message.";
        }
      }
    });

    if (currentAccountCache?.permissions?.canManagePosts && readAdminWorkspaceState().chat) {
      await loadQueue();
    }
  };

  const initProfileToggle = () => {
    const button = document.querySelector("[data-profile-toggle]");
    const form = document.querySelector("[data-profile-form]");
    if (!button || !form) return;

    button.addEventListener("click", () => {
      form.hidden = !form.hidden;
    });
  };

  const initProfileForm = () => {
    const form = document.querySelector("[data-profile-form]");
    if (!form) return;
    const message = document.querySelector("[data-profile-message]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (message) message.textContent = "Saving profile...";
      try {
        const payload = Object.fromEntries(new FormData(form));
        const data = await api("/api/account/profile", { method: "PUT", body: JSON.stringify(payload) });
        currentAccountCache = await api("/api/me");
        renderAccount(currentAccountCache);
        if (message) message.textContent = "Profile saved.";
      } catch (error) {
        if (message) message.textContent = error.message || "Could not save profile.";
      }
    });
  };


  const formatChatDuration = (totalSeconds) => {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  };

  const setChatComposerLocked = (locked) => {
    const form = document.querySelector("[data-chat-form]");
    if (!form) return;
    form.querySelectorAll("textarea, button").forEach((item) => {
      item.disabled = locked;
    });
  };

  const renderChatMuteState = (chatState = {}) => {
    const banner = document.querySelector("[data-chat-mute-banner]");
    const timer = document.querySelector("[data-chat-mute-timer]");
    if (chatMuteTimerInterval) {
      clearInterval(chatMuteTimerInterval);
      chatMuteTimerInterval = null;
    }
    if (!banner || !timer) return;

    const mutedUntil = chatState?.mutedUntil ? new Date(chatState.mutedUntil).getTime() : 0;
    const banned = Boolean(chatState?.banned);

    const render = () => {
      if (banned) {
        banner.hidden = false;
        banner.classList.add("is-banned");
        timer.textContent = "restricted";
        setChatComposerLocked(true);
        return false;
      }

      const remaining = mutedUntil ? Math.ceil((mutedUntil - Date.now()) / 1000) : 0;
      if (remaining > 0) {
        banner.hidden = false;
        banner.classList.remove("is-banned");
        timer.textContent = formatChatDuration(remaining);
        setChatComposerLocked(true);
        return true;
      }

      banner.hidden = true;
      banner.classList.remove("is-banned");
      setChatComposerLocked(false);
      return false;
    };

    if (render()) {
      chatMuteTimerInterval = setInterval(() => {
        if (!render()) {
          clearInterval(chatMuteTimerInterval);
          chatMuteTimerInterval = null;
          if (communityChatLoader) communityChatLoader();
        }
      }, 1000);
    }
  };

  const chatLanguageOptions = ["English", "Russian", "Polish", "Korean", "Japanese"];

  const chatTranslateControls = (item, source = "message") => {
    if (!item.canTranslate) return "";
    const id = escapeHTML(item.id);
    return `
      <div class="chat-control-group chat-translate-group">
        <select aria-label="Translation language" data-chat-translate-language="${id}">
          ${chatLanguageOptions.map((language) => `<option value="${escapeHTML(language)}">${escapeHTML(language)}</option>`).join("")}
        </select>
        <button class="mini-btn" type="button" data-translate-chat="${id}" data-translate-source="${escapeHTML(source)}">Translate</button>
      </div>
    `;
  };

  const renderChatMessages = (messages) => {
    const list = document.querySelector("[data-chat-list]");
    if (!list) return;
    if (!messages.length) {
      list.innerHTML = `<p class="form-note">No messages yet.</p>`;
      return;
    }
    list.innerHTML = messages.map((item) => {
      const id = escapeHTML(item.id);
      const editedLabel = item.edited ? ` · edited` : "";
      const messageActions = `
        ${item.canEdit ? `<button class="chat-action-link" type="button" data-edit-chat="${id}">Edit</button>` : ""}
        ${item.canDelete ? `<button class="chat-action-link is-danger" type="button" data-delete-chat="${id}">Delete</button>` : ""}
      `.trim();
      const translateControls = chatTranslateControls(item);
      return `
        <article class="chat-message ${item.own ? "is-own" : ""}" data-chat-row="${id}">
          <img src="${escapeHTML(item.authorAvatar || "assets/media/profile/avatar.webp")}" alt="" />
          <div class="chat-message-body">
            <div class="comment-item-head chat-message-head">
              <div class="chat-message-meta"><strong>${escapeHTML(item.authorName)}</strong><span>${escapeHTML(shortDateTime(item.createdAt))}${editedLabel}</span></div>
              ${messageActions ? `<div class="chat-inline-actions">${messageActions}</div>` : ""}
            </div>
            <p data-chat-text="${id}">${escapeHTML(item.body).replace(/\n/g, "<br>")}</p>
            <form class="chat-edit-form" data-chat-edit-form="${id}" hidden>
              <textarea name="body" rows="3">${escapeHTML(item.body)}</textarea>
              <div class="chat-actions">
                <button class="mini-btn" type="submit">Save edit</button>
                <button class="mini-btn" type="button" data-cancel-chat-edit="${id}">Cancel</button>
              </div>
            </form>
            ${translateControls ? `<div class="chat-control-panel">${translateControls}</div>` : ""}
            <div class="chat-translation" data-chat-translation="${id}" hidden></div>
          </div>
        </article>
      `;
    }).join("");
    list.scrollTop = list.scrollHeight;
  };


  const initCommunityChat = async () => {
    const chat = document.querySelector("[data-community-chat]");
    if (!chat) return;
    const form = document.querySelector("[data-chat-form]");
    const message = document.querySelector("[data-chat-message]");

    const loadChat = async () => {
      if (!currentAccountCache?.authenticated) {
        renderChatMessages([]);
        renderChatMuteState({});
        if (message) message.textContent = "Login is required for chat.";
        return;
      }

      try {
        const data = await api("/api/community/chat");
        renderChatMessages(data.messages || []);
        renderChatMuteState(data.chatState || {});
        if (message) message.textContent = data.notice || "Shared for all users. Yes, the author also sees this chat.";
      } catch (error) {
        if (message) message.textContent = error.message || "Chat is temporarily unavailable.";
      }
    };

    communityChatLoader = loadChat;

    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = String(new FormData(form).get("body") || "").trim();
        if (!body) return;
        if (message) message.textContent = "Sending message...";
        try {
          const data = await api("/api/community/chat", { method: "POST", body: JSON.stringify({ body }) });
          form.reset();
          renderChatMessages(data.messages || []);
          renderChatMuteState(data.chatState || {});
          if (message) message.textContent = data.notice || "Shared for all users. Yes, the author also sees this chat.";
        } catch (error) {
          if (error.data?.chatState) renderChatMuteState(error.data.chatState);
          if (message) message.textContent = error.message || "Could not send message.";
        }
      });
    }

    document.addEventListener("click", async (event) => {
      const translateButton = event.target.closest("[data-translate-chat]");
      if (translateButton && chat.contains(translateButton)) {
        const id = translateButton.dataset.translateChat;
        const language = chat.querySelector(`[data-chat-translate-language="${CSS.escape(id)}"]`)?.value || "English";
        const target = chat.querySelector(`[data-chat-translation="${CSS.escape(id)}"]`);
        translateButton.disabled = true;
        if (target) {
          target.hidden = false;
          target.textContent = "Translating...";
        }
        try {
          const data = await api(`/api/admin/chat/messages/${encodeURIComponent(id)}/translate`, {
            method: "POST",
            body: JSON.stringify({ targetLanguage: language }),
          });
          if (target) target.innerHTML = `<strong>${escapeHTML(data.targetLanguage)}:</strong> ${escapeHTML(data.translation).replace(/\n/g, "<br>")}`;
        } catch (error) {
          if (target) target.textContent = error.message || "Could not translate message.";
        } finally {
          translateButton.disabled = false;
        }
        return;
      }

      const editButton = event.target.closest("[data-edit-chat]");
      if (editButton && chat.contains(editButton)) {
        const id = editButton.dataset.editChat;
        const row = chat.querySelector(`[data-chat-row="${CSS.escape(id)}"]`);
        const text = row?.querySelector(`[data-chat-text="${CSS.escape(id)}"]`);
        const editForm = row?.querySelector(`[data-chat-edit-form="${CSS.escape(id)}"]`);
        if (text && editForm) {
          text.hidden = true;
          editForm.hidden = false;
          editForm.querySelector("textarea")?.focus();
          editButton.hidden = true;
        }
        return;
      }

      const cancelEditButton = event.target.closest("[data-cancel-chat-edit]");
      if (cancelEditButton && chat.contains(cancelEditButton)) {
        const id = cancelEditButton.dataset.cancelChatEdit;
        const row = chat.querySelector(`[data-chat-row="${CSS.escape(id)}"]`);
        const text = row?.querySelector(`[data-chat-text="${CSS.escape(id)}"]`);
        const editForm = row?.querySelector(`[data-chat-edit-form="${CSS.escape(id)}"]`);
        const editButtonAgain = row?.querySelector(`[data-edit-chat="${CSS.escape(id)}"]`);
        if (text && editForm) {
          editForm.hidden = true;
          text.hidden = false;
          if (editButtonAgain) editButtonAgain.hidden = false;
        }
        return;
      }

      const button = event.target.closest("[data-delete-chat]");
      if (!button || !chat.contains(button)) return;
      button.disabled = true;
      try {
        const data = await api(`/api/community/chat/${encodeURIComponent(button.dataset.deleteChat)}`, { method: "DELETE" });
        renderChatMessages(data.messages || []);
        if (message) message.textContent = "Shared for all users. Yes, the author also sees this chat.";
      } catch (error) {
        button.disabled = false;
        if (message) message.textContent = error.message || "Could not delete message.";
      }
    });

    document.addEventListener("submit", async (event) => {
      const editForm = event.target.closest("[data-chat-edit-form]");
      if (!editForm || !chat.contains(editForm)) return;
      event.preventDefault();
      const id = editForm.dataset.chatEditForm;
      const body = String(new FormData(editForm).get("body") || "").trim();
      if (!body) return;
      const submitButton = editForm.querySelector("button[type='submit']");
      if (submitButton) submitButton.disabled = true;
      if (message) message.textContent = "Saving edit...";
      try {
        const data = await api(`/api/community/chat/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ body }),
        });
        renderChatMessages(data.messages || []);
        renderChatMuteState(data.chatState || {});
        if (message) message.textContent = data.notice || "Message edited.";
      } catch (error) {
        if (error.data?.chatState) renderChatMuteState(error.data.chatState);
        if (submitButton) submitButton.disabled = false;
        if (message) message.textContent = error.message || "Could not edit message.";
      }
    });

    if (currentAccountCache?.authenticated) {
      await loadChat();
    }
  };

  const postShareURL = () => {
    const page = document.querySelector("[data-post-page]");
    if (!page) {
      const url = new URL(window.location.href);
      url.hash = "";
      return url.toString();
    }

    const slug = page.dataset.postSlug || postSlugFromLocation() || "alternative-system-for-early-access-verification";
    if (window.location.protocol === "file:") {
      const url = new URL("post-alternative-system.html", window.location.href);
      url.search = `?post=${encodeURIComponent(slug)}`;
      url.hash = "";
      return url.toString();
    }

    const url = new URL(postPermalink(slug), window.location.origin);
    url.hash = "";
    return url.toString();
  };

  const copyTextToClipboard = async (text) => {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  };

  const initShareButtons = () => {
    document.querySelectorAll("[data-share-url]").forEach((button) => {
      button.addEventListener("click", async () => {
        const url = postShareURL();
        const previous = button.textContent;

        const flash = (label) => {
          button.textContent = label;
          window.setTimeout(() => {
            button.textContent = previous;
          }, 1200);
        };

        try {
          const copied = await copyTextToClipboard(url);
          if (copied) {
            flash("Link copied");
            return;
          }
        } catch {
          // Fall through to the manual copy prompt below.
        }

        window.prompt("Copy post link", url);
      });
    });
  };

  initAccount();
  initAuthTabs();
  initPasswordAuth();
  initLogout();
  initRenewalControls();
  initBuildLaunch();
  initMoonPaySubscriptions();
  initProfileToggle();
  initProfileForm();
  initTelegramCodeForm();
  initAdminWorkspaceControls();
  initAdminPanel();
  initAdminChatModeration();
  initPostFeeds();
  initPostDetail();
  initPostLikes();
  initPostComments();
  initCommunityChat();
  initShareButtons();
})();
