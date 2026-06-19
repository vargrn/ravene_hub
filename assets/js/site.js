(() => {
  let currentAccountCache = null;
  let accountRequestVersion = 0;
  let authBusy = false;
  let logoutBusy = false;
  let communityChatLoader = null;
  let adminPanelLoader = null;

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
      throw new Error(data.error || "Request failed");
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

    panel.classList.toggle("is-connected", Boolean(account.authenticated));
    panel.classList.toggle("is-setup-required", Boolean(account.setupRequired));

    if (account.setupRequired) {
      setAuthOnlyVisible(false);
      setGuestOnlyVisible(true);
      resetPrivilegedPanels();
      setText("[data-account-state]", "Setup required");
      setText("[data-account-summary]", "Account service is temporarily unavailable. Please try again after the current site update is applied.");
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
      setText("[data-account-state]", "Not connected");
      setText("[data-account-summary]", "Log in to an existing account or create a new browser account.");
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
    setText("[data-account-state]", "Connected");
    setText("[data-account-summary]", tier > 0
      ? renewalStatus === "cancelled"
        ? "Account is connected. Paid access remains active until the expiry date."
        : "Account is connected and active access was found."
      : "Account is connected. No active membership tier is attached yet.");
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
    if (canManageAdmin && adminPanelLoader) {
      adminPanelLoader();
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
    setText("[data-account-state]", "Local preview");
    setText("[data-account-summary]", "Open the hosted Worker build to check account status.");
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
    document.querySelectorAll('[data-auth-form="login"], [data-auth-form="register"]').forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const mode = form.dataset.authForm;
        const message = document.querySelector(`[data-auth-message="${mode}"]`);
        const body = Object.fromEntries(new FormData(form));

        if (authBusy) return;
        authBusy = true;
        setFormBusy(form, true);
        if (message) message.textContent = mode === "register" ? "Creating account..." : "Logging in...";

        try {
          await api(`/api/auth/${mode}`, {
            method: "POST",
            body: JSON.stringify(body),
          });
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
    const button = document.querySelector("[data-build-launch]");
    if (!button) return;

    button.addEventListener("click", async () => {
      const message = document.querySelector("[data-build-message]");
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = "Checking access...";

      try {
        const launch = await api("/api/builds/current/launch", { method: "POST", body: "{}" });
        if (launch.launchUrl) {
          window.location.href = launch.launchUrl;
          return;
        }
        if (message) {
          message.textContent = "Access confirmed. Build URL is not connected yet, but the server issued a launch token.";
        }
      } catch (error) {
        if (message) message.textContent = error.message || "Could not open build.";
      } finally {
        button.disabled = false;
        button.textContent = previous;
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

  const postHref = (post) => post.staticHref || (post.slug === "alternative-system" ? "post-alternative-system.html" : `post-alternative-system.html?post=${encodeURIComponent(post.slug || "")}`);

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
      item.textContent = `${count} ${count === 1 ? "comment" : "comments"}`;
    });
  };

  const setLikeState = (post) => {
    document.querySelectorAll("[data-like-count]").forEach((item) => {
      item.textContent = String(post?.likeCount || 0);
    });
    document.querySelectorAll("[data-like-post]").forEach((button) => {
      button.classList.toggle("is-active", Boolean(post?.likedByMe));
      button.textContent = `${post?.likedByMe ? "♥" : "♡"} ${post?.likeCount || 0}`;
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

    const params = new URLSearchParams(window.location.search);
    const postSlug = params.get("post") || page.dataset.postSlug || "alternative-system";
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

  const postActionsMarkup = (post, label = "Open post") => `
    <div class="post-action-row">
      <div class="reaction-line"><span>♡ ${post.likeCount || 0}</span><span>${post.commentCount || 0} comments</span></div>
      <span class="post-open-link">${escapeHTML(label)}</span>
    </div>
  `;

  const renderPostCard = (post, featured = false) => featured ? `
    <a class="post-feature-card" href="${escapeHTML(postHref(post))}">
      <div class="post-feature-cover">
        <img src="${escapeHTML(post.coverUrl || "assets/media/posts/biopunk-duo.webp")}" alt="${escapeHTML(post.title)} artwork" />
      </div>
      <div class="post-feature-body">
        ${postMetaMarkup(post)}
        <h3>${escapeHTML(post.title)}</h3>
        <p class="text">${escapeHTML(post.excerpt || "")}</p>
        ${postActionsMarkup(post, "Read post")}
      </div>
    </a>
  ` : `
    <a class="post-feed-row" href="${escapeHTML(postHref(post))}">
      <div class="post-feed-cover">
        <img src="${escapeHTML(post.coverUrl || "assets/media/posts/biopunk-duo.webp")}" alt="${escapeHTML(post.title)} artwork" />
      </div>
      <div class="post-feed-body">
        ${postMetaMarkup(post)}
        <h3>${escapeHTML(post.title)}</h3>
        <p class="text">${escapeHTML(post.excerpt || "")}</p>
        ${postActionsMarkup(post, "Open post")}
      </div>
    </a>
  `;

  const renderPostThumb = (post) => `
    <a class="post-card-thumb" href="${escapeHTML(postHref(post))}">
      <img src="${escapeHTML(post.coverUrl || "assets/media/posts/biopunk-duo.webp")}" alt="${escapeHTML(post.title)} artwork" />
      <div class="post-card-body">
        ${postMetaMarkup(post)}
        <h3>${escapeHTML(post.title)}</h3>
        <p class="text">${escapeHTML(post.excerpt || "")}</p>
        ${postActionsMarkup(post, "Open post")}
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
    if (mode === "latest") return selected.slice(0, 1).map((post) => renderPostCard(post, true)).join("");
    return selected.map((post) => renderPostCard(post, false)).join("");
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

    const fallbackForMode = (mode) => (mode === "pinned" ? fallbackPinnedPosts : fallbackPosts);

    const loadGroup = async (key, targets) => {
      const data = await api(key === "pinned" ? "/api/posts?pinned=1" : "/api/posts");
      const posts = data.posts || [];
      targets.forEach((target) => {
        const mode = target.dataset.postFeed;
        const limit = Number(target.dataset.limit || (mode === "latest" ? 1 : 12));
        const source = posts.length ? posts : fallbackForMode(mode);
        const selected = source.slice(0, limit);
        target.innerHTML = renderFeedPosts(mode, selected);
      });
    };

    await Promise.all(Object.entries(grouped).map(async ([key, targets]) => {
      try {
        await loadGroup(key, targets);
      } catch {
        targets.forEach((target) => {
          const mode = target.dataset.postFeed;
          const limit = Number(target.dataset.limit || (mode === "latest" ? 1 : 12));
          target.innerHTML = renderFeedPosts(mode, fallbackForMode(mode).slice(0, limit));
        });
      }
    }));
  };

  const initPostDetail = async () => {
    const page = document.querySelector("[data-post-page]");
    if (!page) return;
    const params = new URLSearchParams(window.location.search);
    const postSlug = params.get("post") || page.dataset.postSlug || "alternative-system";
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

    if (currentAccountCache?.permissions?.canManagePosts) {
      await loadAdmin();
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

  const renderChatMessages = (messages) => {
    const list = document.querySelector("[data-chat-list]");
    if (!list) return;
    if (!messages.length) {
      list.innerHTML = `<p class="form-note">No messages yet.</p>`;
      return;
    }
    list.innerHTML = messages.map((item) => `
      <article class="chat-message ${item.own ? "is-own" : ""}">
        <img src="${escapeHTML(item.authorAvatar || "assets/media/profile/avatar.webp")}" alt="" />
        <div class="chat-message-body">
          <div class="comment-item-head"><strong>${escapeHTML(item.authorName)}</strong><span>${escapeHTML(shortDateTime(item.createdAt))}</span></div>
          <p>${escapeHTML(item.body).replace(/\n/g, "<br>")}</p>
          ${item.canDelete ? `<button class="mini-btn danger" type="button" data-delete-chat="${escapeHTML(item.id)}">Delete</button>` : ""}
        </div>
      </article>
    `).join("");
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
        if (message) message.textContent = "Login is required for chat.";
        return;
      }

      try {
        const data = await api("/api/community/chat");
        renderChatMessages(data.messages || []);
        if (message) message.textContent = "Shared for all users. Yes, the author also sees this chat.";
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
          if (message) message.textContent = "Shared for all users. Yes, the author also sees this chat.";
        } catch (error) {
          if (message) message.textContent = error.message || "Could not send message.";
        }
      });
    }

    document.addEventListener("click", async (event) => {
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

    if (currentAccountCache?.authenticated) {
      await loadChat();
    }
  };

  const initShareButtons = () => {
    document.querySelectorAll("[data-share-url]").forEach((button) => {
      button.addEventListener("click", async () => {
        const url = window.location.href;
        const title = document.title;
        const previous = button.textContent;

        const flash = (label) => {
          button.textContent = label;
          window.setTimeout(() => {
            button.textContent = previous;
          }, 1200);
        };

        try {
          if (navigator.share) {
            await navigator.share({ title, url });
            return;
          }

          if (navigator.clipboard) {
            await navigator.clipboard.writeText(url);
            flash("Copied");
            return;
          }

          window.prompt("Copy post link", url);
        } catch {
          flash("...");
        }
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
  initAdminPanel();
  initPostFeeds();
  initPostDetail();
  initPostLikes();
  initPostComments();
  initCommunityChat();
  initShareButtons();
})();
