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

  const renderAccount = (account) => {
    const panel = document.querySelector("[data-account-panel]");
    if (!panel) return;

    panel.classList.toggle("is-connected", Boolean(account.authenticated));
    panel.classList.toggle("is-setup-required", Boolean(account.setupRequired));

    if (account.setupRequired) {
      setText("[data-account-state]", "Setup required");
      setText("[data-account-summary]", "The account database is not connected yet. Hosting needs the DB binding and migration.");
      return;
    }

    if (!account.authenticated) {
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
    if (!document.querySelector("[data-account-panel]")) return;

    try {
      renderAccount(await api("/api/me"));
    } catch {
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
})();
