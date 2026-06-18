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

  const loadScriptOnce = (src, id) => new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      if (window.paypal) resolve();
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("Could not load PayPal")), { once: true });
    document.head.appendChild(script);
  });

  const renderAccount = (account) => {
    const panel = document.querySelector("[data-account-panel]");
    setAuthNavVisible(Boolean(account.authenticated));
    if (!panel) return;

    panel.classList.toggle("is-connected", Boolean(account.authenticated));
    panel.classList.toggle("is-setup-required", Boolean(account.setupRequired));

    if (account.setupRequired) {
      setAuthOnlyVisible(false);
      setText("[data-account-state]", "Setup required");
      setText("[data-account-summary]", "The account database is not connected yet. Hosting needs the DB binding and migration.");
      return;
    }

    if (!account.authenticated) {
      setAuthOnlyVisible(false);
      setText("[data-account-state]", "Not connected");
      setText("[data-account-summary]", "Log in to an existing account or create a new browser account.");
      setText("[data-account-name]", "Not connected");
      setText("[data-account-tier]", "No active tier");
      setText("[data-account-expires]", "-");
      document.querySelectorAll("[data-auth-gate], [data-auth-trigger]").forEach((item) => {
        item.hidden = false;
      });
      closeAuthForms();
      return;
    }

    setAuthOnlyVisible(true);
    const tier = Number(account.subscription?.tier || 0);
    setText("[data-account-state]", "Connected");
    setText("[data-account-summary]", tier > 0
      ? "Account is connected and active access was found."
      : "Account is connected. No active membership tier is attached yet.");
    setText("[data-account-name]", account.user?.displayName || "Connected account");
    setText("[data-account-tier]", tier > 0 ? `Tier ${tier}` : "No active tier");
    setText("[data-account-expires]", formatDate(account.subscription?.expiresAt));

    document.querySelectorAll("[data-tier-indicator]").forEach((item) => {
      item.classList.toggle("is-unlocked", tier >= Number(item.dataset.tierIndicator || 0));
    });

    const logout = document.querySelector("[data-logout-button]");
    if (logout) logout.hidden = false;

    document.querySelectorAll("[data-auth-form], [data-auth-gate], [data-auth-trigger]").forEach((item) => {
      item.hidden = true;
    });
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

  const initPayPalSubscriptions = async () => {
    const containers = [...document.querySelectorAll("[data-paypal-buttons]")];
    if (!containers.length) return;

    const setTierMessage = (tier, text) => {
      const message = document.querySelector(`[data-paypal-message="${tier}"]`);
      if (message) message.textContent = text;
    };

    const setJoinButton = (tier, mode, message) => {
      const button = document.querySelector(`[data-paypal-fallback="${tier}"]`);
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

    containers.forEach((container) => {
      const tier = container.dataset.paypalButtons;
      container.hidden = true;
      setJoinButton(tier, "login", "Log in or register before subscribing.");
    });

    try {
      const [account, config] = await Promise.all([
        api("/api/me"),
        api("/api/paypal/config"),
      ]);

      if (!account.authenticated) {
        containers.forEach((container) => {
          const tier = container.dataset.paypalButtons;
          container.hidden = true;
          setJoinButton(tier, "login", "Log in or register before subscribing.");
          setTierMessage(tier, "Log in or register before subscribing.");
        });
        return;
      }

      if (!config.configured) {
        containers.forEach((container) => {
          const tier = container.dataset.paypalButtons;
          container.hidden = true;
          setJoinButton(tier, "notice", "PayPal is not configured yet.");
          setTierMessage(tier, "PayPal subscription plans are not configured yet.");
        });
        return;
      }

      const sdkUrl = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&vault=true&intent=subscription&currency=${encodeURIComponent(config.currency || "EUR")}`;
      await loadScriptOnce(sdkUrl, "paypal-subscriptions-sdk");

      containers.forEach((container) => {
        const tier = Number(container.dataset.paypalButtons || 0);
        const planId = config.plans?.[tier];
        const fallback = document.querySelector(`[data-paypal-fallback="${tier}"]`);

        if (!planId || !window.paypal?.Buttons) {
          setJoinButton(tier, "notice", "This tier is not connected to PayPal yet.");
          setTierMessage(tier, "This tier is not connected to PayPal yet.");
          return;
        }

        if (fallback) fallback.hidden = true;
        container.hidden = false;
        container.innerHTML = "";
        setTierMessage(tier, "Monthly subscription via PayPal.");

        window.paypal.Buttons({
          style: {
            layout: "horizontal",
            color: "silver",
            shape: "rect",
            label: "subscribe",
            height: 44,
          },
          createSubscription: (data, actions) => actions.subscription.create({
            plan_id: planId,
            custom_id: account.user?.id || "",
          }),
          onApprove: async (data) => {
            setTierMessage(tier, "Checking subscription...");
            await api("/api/paypal/subscription/activate", {
              method: "POST",
              body: JSON.stringify({
                tier,
                subscriptionId: data.subscriptionID,
              }),
            });
            setTierMessage(tier, "Subscription active. Access is connected.");
            window.setTimeout(() => window.location.href = "account.html#connect-account", 800);
          },
          onCancel: () => {
            setTierMessage(tier, "Subscription was cancelled before approval.");
          },
          onError: (error) => {
            console.error(error);
            setTierMessage(tier, "PayPal could not start the subscription.");
          },
        }).render(container);
      });
    } catch (error) {
      containers.forEach((container) => {
        const tier = container.dataset.paypalButtons;
        container.hidden = true;
        setJoinButton(tier, "notice", error.message || "PayPal is not available yet.");
        setTierMessage(tier, error.message || "PayPal is not available yet.");
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
  initPayPalSubscriptions();
  initPostComments();
})();
