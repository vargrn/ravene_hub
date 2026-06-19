(() => {
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
    const panel = document.querySelector("[data-account-panel]");
    const renewalNote = document.querySelector("[data-renewal-note]");
    const subscriptionMessage = document.querySelector("[data-subscription-message]");
    setAuthNavVisible(Boolean(account.authenticated));
    if (!panel) return;

    panel.classList.toggle("is-connected", Boolean(account.authenticated));
    panel.classList.toggle("is-setup-required", Boolean(account.setupRequired));

    if (account.setupRequired) {
      setAuthOnlyVisible(false);
      setText("[data-account-state]", "Setup required");
      setText("[data-account-summary]", "The account database is not connected yet. Hosting needs the DB binding and migration.");
      if (renewalNote) renewalNote.hidden = true;
      return;
    }

    if (!account.authenticated) {
      setAuthOnlyVisible(false);
      setText("[data-account-state]", "Not connected");
      setText("[data-account-summary]", "Log in to an existing account or create a new browser account.");
      setText("[data-account-name]", "Not connected");
      setText("[data-account-tier]", "No active tier");
      setText("[data-account-expires]", "-");
      setText("[data-account-access-status]", "-");
      setText("[data-account-renewal-status]", "-");
      setText("[data-account-source]", "-");
      if (renewalNote) renewalNote.hidden = true;
      document.querySelectorAll("[data-auth-gate], [data-auth-trigger]").forEach((item) => {
        item.hidden = false;
      });
      closeAuthForms();
      return;
    }

    setAuthOnlyVisible(true);
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

    if (renewalNote) renewalNote.hidden = !showMoonPayNote;
    if (subscriptionMessage) {
      subscriptionMessage.textContent = showMoonPayNote
        ? "MoonPay Commerce controls renewal links. Access updates here after confirmed webhook events."
        : renewalStatus === "cancelled" && tier > 0
          ? "Renewal is cancelled. Paid access remains until the expiry date."
          : "";
    }

    document.querySelectorAll("[data-tier-indicator]").forEach((item) => {
      item.classList.toggle("is-unlocked", tier >= Number(item.dataset.tierIndicator || 0));
    });

    const logout = document.querySelector("[data-logout-button]");
    if (logout) logout.hidden = false;

    document.querySelectorAll("[data-auth-form], [data-auth-gate], [data-auth-trigger]").forEach((item) => {
      item.hidden = true;
    });
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

  const initAccount = async () => {
    if (!document.querySelector("[data-account-panel], [data-auth-nav]")) return;

    try {
      renderAccount(await api("/api/me"));
    } catch {
      setAuthNavVisible(false);
      setText("[data-account-state]", "Local preview");
      setText("[data-account-summary]", "Open the hosted Worker build to check account status.");
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

        if (message) message.textContent = mode === "register" ? "Creating account..." : "Logging in...";

        try {
          await api(`/api/auth/${mode}`, {
            method: "POST",
            body: JSON.stringify(body),
          });
          if (message) message.textContent = mode === "register" ? "Account created." : "Logged in.";
          renderAccount(await api("/api/me"));
          form.reset();
        } catch (error) {
          if (message) message.textContent = error.message || "Could not continue.";
        }
      });
    });
  };

  const initLogout = () => {
    const button = document.querySelector("[data-logout-button]");
    if (!button) return;

    button.addEventListener("click", async () => {
      await api("/api/logout", { method: "POST", body: "{}" }).catch(() => null);
      window.location.reload();
    });
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

    const pollMoonPayAccess = async (tier, showMessage) => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt ? 2200 : 900));
        try {
          const account = await api("/api/me");
          const activeTier = Number(account.subscription?.tier || 0);
          const source = account.subscription?.paymentSource || account.subscription?.source;
          if (account.authenticated && source === "moonpay" && activeTier >= Number(tier || 0)) {
            showMessage("MoonPay confirmed the membership. Redirecting to account...");
            window.setTimeout(() => window.location.href = "account.html#connect-account", 700);
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

        if (!plan?.paylinkId || !window.helioCheckout) {
          setJoinButton(tier, "notice", "This tier is not connected to MoonPay Commerce yet.");
          setTierMessage(tier, "This tier is not connected to MoonPay Commerce yet.");
          return;
        }

        const session = await api("/api/moonpay/checkout/session", {
          method: "POST",
          body: JSON.stringify({ tier }),
        });

        if (fallback) fallback.hidden = true;
        container.hidden = false;
        container.innerHTML = "";
        setTierMessage(tier, "Monthly membership via MoonPay Commerce.");

        window.helioCheckout(container, {
          paylinkId: session.paylinkId || plan.paylinkId,
          network: session.network || config.network || "test",
          paymentType: "paylink",
          primaryPaymentMethod: session.primaryPaymentMethod || config.primaryPaymentMethod || "crypto",
          display: "button",
          theme: { themeMode: "dark" },
          customTexts: {
            mainButtonTitle: "Join with MoonPay",
            payButtonTitle: "Start membership",
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
            checkoutSessionId: session.sessionId || "",
            checkoutToken: session.checkoutToken || "",
            accountEmail: account.user?.email || "",
          },
          onStartPayment: () => setTierMessage(tier, "MoonPay checkout started. Confirm the payment in the widget."),
          onPending: () => setTierMessage(tier, "Payment is pending. Access activates after MoonPay confirms it."),
          onSuccess: () => pollMoonPayAccess(tier, (message) => setTierMessage(tier, message)),
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
        setJoinButton(tier, "notice", error.message || "MoonPay Commerce is not available yet.");
        setTierMessage(tier, error.message || "MoonPay Commerce is not available yet.");
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

  const setCommentCount = (count) => {
    document.querySelectorAll("[data-comment-count]").forEach((item) => {
      item.textContent = String(count);
    });
    document.querySelectorAll("[data-comment-summary]").forEach((item) => {
      item.textContent = `${count} ${count === 1 ? "comment" : "comments"}`;
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
      <article class="comment-item">
        <img src="${escapeHTML(comment.authorAvatar || "assets/media/profile/avatar.webp")}" alt="" />
        <div class="comment-item-body">
          <div class="comment-item-head"><strong>${escapeHTML(comment.authorName)}</strong><span>${escapeHTML(shortDateTime(comment.createdAt))}</span></div>
          <p class="text">${escapeHTML(comment.body).replace(/\n/g, "<br>")}</p>
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

    const postSlug = page.dataset.postSlug || "alternative-system";

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
      const account = await api("/api/me");
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

    await loadComments();
  };

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
          flash("OK");
          return;
        }

        window.prompt("Copy post link", url);
      } catch {
        flash("...");
      }
    });
  });

  initAccount();
  initAuthTabs();
  initPasswordAuth();
  initLogout();
  initBuildLaunch();
  initMoonPaySubscriptions();
  initPostComments();
})();
