(() => {
  const STORAGE_KEY = "raveneHub.ageGate.v2";
  const ACCEPTED_VALUE = "confirmed-adult";
  const DENIED_VALUE = "underage";
  const PENDING_CLASS = "ravene-age-pending";
  const OVERLAY_ID = "ravene-age-gate";
  const STYLE_ID = "ravene-age-gate-style";

  const safeGet = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const safeSet = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage may be unavailable in private browser modes. The current page still stays gated.
    }
  };

  const hasPreviousAcceptance = () => (
    safeGet(STORAGE_KEY) === ACCEPTED_VALUE ||
    safeGet("raveneHub.ageGate.v1") === "adult" ||
    safeGet("raveneHub.ageGate.accepted.v1") === "yes"
  );

  const hasPreviousDenial = () => (
    safeGet(STORAGE_KEY) === DENIED_VALUE ||
    safeGet("raveneHub.ageGate.v1") === "underage"
  );

  if (hasPreviousAcceptance()) return;

  document.documentElement.classList.add(PENDING_CLASS);

  const scriptSrc = document.currentScript?.getAttribute("src") || "";
  const assetPrefix = scriptSrc.includes("../assets/") ? "../" : "";
  const brandMarkSrc = `${assetPrefix}assets/media/profile/avatar.webp`;

  const injectStyles = () => {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.${PENDING_CLASS},
      html.${PENDING_CLASS} body {
        overflow: hidden !important;
      }

      html.${PENDING_CLASS} body > :not(.ravene-age-gate) {
        visibility: hidden !important;
      }

      .ravene-age-gate,
      .ravene-age-gate * {
        box-sizing: border-box;
      }

      .ravene-age-gate {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        padding: 22px;
        color: var(--text, #f0f2f4);
        background:
          radial-gradient(circle at 19% 0%, rgba(118, 147, 196, 0.16) 0%, transparent 34%),
          radial-gradient(circle at 79% 15%, rgba(159, 178, 211, 0.12) 0%, transparent 33%),
          radial-gradient(circle at 50% 0%, rgba(32, 47, 77, 0.54) 0%, rgba(4, 7, 13, 0.98) 58%),
          rgba(4, 7, 13, 0.96);
        font-family: "Exo2", serif;
      }

      .ravene-age-gate::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0.07;
        background-image: radial-gradient(rgba(255, 255, 255, 0.25) 1px, transparent 1px);
        background-size: 4px 4px;
      }

      .ravene-age-card {
        position: relative;
        width: min(100%, 620px);
        border: 1px solid var(--line, rgba(232, 238, 248, 0.14));
        background:
          linear-gradient(145deg, rgba(255, 255, 255, 0.072), rgba(255, 255, 255, 0.014) 42%, rgba(255, 255, 255, 0.035)),
          linear-gradient(180deg, rgba(12, 16, 24, 0.92), rgba(7, 10, 16, 0.82));
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.075),
          inset 0 -42px 80px rgba(0, 0, 0, 0.22),
          0 24px 72px rgba(0, 0, 0, 0.58),
          0 0 52px rgba(184, 212, 255, 0.09);
        overflow: hidden;
      }

      .ravene-age-card::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(110deg, transparent 0%, rgba(255, 255, 255, 0.052) 28%, transparent 58%),
          radial-gradient(circle at 100% 0%, rgba(184, 212, 255, 0.07), transparent 36%);
        pointer-events: none;
      }

      .ravene-age-card::after {
        content: "";
        position: absolute;
        inset: 1px;
        border: 1px solid rgba(255, 255, 255, 0.035);
        pointer-events: none;
      }

      .ravene-age-card-inner {
        position: relative;
        z-index: 1;
        padding: 24px;
      }

      .ravene-age-topline {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 26px;
      }

      .ravene-age-brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        color: var(--text, #f0f2f4);
        text-transform: uppercase;
        letter-spacing: 0.02em;
        font-size: 18px;
      }

      .ravene-age-brand img {
        width: 42px;
        height: 42px;
        flex: 0 0 auto;
        border: 1px solid var(--line, rgba(232, 238, 248, 0.14));
        object-fit: cover;
        opacity: 0.9;
        background: rgba(255, 255, 255, 0.03);
        box-shadow:
          inset 0 0 0 1px rgba(255, 255, 255, 0.04),
          0 0 24px rgba(184, 212, 255, 0.10);
      }

      .ravene-age-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 48px;
        min-height: 34px;
        padding: 7px 10px;
        border: 1px solid var(--line-soft, rgba(232, 238, 248, 0.085));
        background: rgba(255, 255, 255, 0.026);
        color: var(--text-soft, #b7c0cb);
        font-size: 12px;
        line-height: 1;
      }

      .ravene-age-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0 0 10px;
        color: var(--text-muted, #77808d);
        font-size: 11px;
      }

      .ravene-age-meta span {
        border: 1px solid var(--line-soft, rgba(232, 238, 248, 0.085));
        background: rgba(255, 255, 255, 0.026);
        padding: 8px 10px;
      }

      .ravene-age-title {
        margin: 0;
        color: var(--text, #f0f2f4);
        font-size: clamp(34px, 6vw, 48px);
        line-height: 0.96;
        font-weight: 400;
        text-transform: none;
        text-shadow: 0 18px 38px rgba(0, 0, 0, 0.52);
      }

      .ravene-age-text {
        max-width: 540px;
        margin: 14px 0 0;
        color: var(--text-soft, #b7c0cb);
        font-size: 14px;
        line-height: 1.68;
      }

      .ravene-age-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 24px;
      }

      .ravene-age-button {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 12px 16px;
        border: 1px solid var(--line, rgba(232, 238, 248, 0.14));
        background:
          linear-gradient(90deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.018)),
          rgba(255, 255, 255, 0.012);
        color: var(--text, #f0f2f4);
        font: inherit;
        font-size: 14px;
        line-height: 1.2;
        box-shadow:
          inset 0 0 0 1px rgba(255, 255, 255, 0.025),
          0 12px 28px rgba(0, 0, 0, 0.18);
        cursor: pointer;
        overflow: hidden;
        transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
      }

      .ravene-age-button:hover,
      .ravene-age-button:focus-visible {
        border-color: rgba(255, 255, 255, 0.26);
        outline: none;
        transform: translateY(-1px);
        box-shadow:
          inset 0 0 0 1px rgba(255, 255, 255, 0.045),
          0 18px 40px rgba(0, 0, 0, 0.34),
          0 0 22px rgba(184, 212, 255, 0.09);
      }

      .ravene-age-button-secondary {
        color: var(--text-soft, #b7c0cb);
        background: rgba(255, 255, 255, 0.018);
        font-size: 13px;
      }

      .ravene-age-note {
        margin: 16px 0 0;
        color: var(--text-muted, #77808d);
        font-size: 12px;
        line-height: 1.5;
      }

      .ravene-age-gate.is-denied .ravene-age-badge {
        color: var(--warning, #d6c08f);
        border-color: rgba(214, 192, 143, 0.28);
      }

      @media (max-width: 620px) {
        .ravene-age-gate {
          align-items: end;
          padding: 14px;
        }

        .ravene-age-card-inner {
          padding: 20px;
        }

        .ravene-age-topline {
          margin-bottom: 22px;
        }

        .ravene-age-actions {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  };

  const leaveSite = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    try {
      window.location.replace("https://www.google.com/");
    } catch {
      window.location.href = "about:blank";
    }
  };

  const renderDenied = (overlay) => {
    overlay.classList.add("is-denied");
    overlay.innerHTML = `
      <section class="ravene-age-card" role="document">
        <div class="ravene-age-card-inner">
          <div class="ravene-age-topline">
            <div class="ravene-age-brand"><img src="${brandMarkSrc}" alt="" /><span>Ravene Hub</span></div>
            <div class="ravene-age-badge" aria-hidden="true">18+</div>
          </div>
          <p class="ravene-age-meta"><span>Mature content notice</span></p>
          <h2 class="ravene-age-title" id="ravene-age-title">Access unavailable</h2>
          <p class="ravene-age-text" id="ravene-age-description">Ravene Hub is intended for visitors who are legally allowed to access mature digital content in their jurisdiction.</p>
          <div class="ravene-age-actions">
            <button class="ravene-age-button" type="button" data-ravene-age-leave>Leave site</button>
          </div>
          <p class="ravene-age-note">If this was selected by mistake, clear this site's browser storage and reload the page.</p>
        </div>
      </section>
    `;

    const leaveButton = overlay.querySelector("[data-ravene-age-leave]");
    leaveButton?.addEventListener("click", leaveSite);
    leaveButton?.focus({ preventScroll: true });
  };

  const renderQuestion = (overlay) => {
    overlay.classList.remove("is-denied");
    overlay.innerHTML = `
      <section class="ravene-age-card" role="document">
        <div class="ravene-age-card-inner">
          <div class="ravene-age-topline">
            <div class="ravene-age-brand"><img src="${brandMarkSrc}" alt="" /><span>Ravene Hub</span></div>
            <div class="ravene-age-badge" aria-hidden="true">18+</div>
          </div>
          <p class="ravene-age-meta"><span>Mature content notice</span></p>
          <h2 class="ravene-age-title" id="ravene-age-title">Age verification</h2>
          <p class="ravene-age-text" id="ravene-age-description">Ravene Hub may contain mature fictional themes and adult-oriented digital content. By entering, you confirm that you are at least 18 years old, or the age of majority in your jurisdiction if higher.</p>
          <div class="ravene-age-actions">
            <button class="ravene-age-button" type="button" data-ravene-age-accept>I am 18 or older</button>
            <button class="ravene-age-button ravene-age-button-secondary" type="button" data-ravene-age-deny>I am under 18</button>
          </div>
          <p class="ravene-age-note">This confirmation is saved in this browser. It does not verify legal identity.</p>
        </div>
      </section>
    `;

    const acceptButton = overlay.querySelector("[data-ravene-age-accept]");
    const denyButton = overlay.querySelector("[data-ravene-age-deny]");

    acceptButton?.addEventListener("click", () => {
      safeSet(STORAGE_KEY, ACCEPTED_VALUE);
      document.documentElement.classList.remove(PENDING_CLASS);
      overlay.remove();
    });

    denyButton?.addEventListener("click", () => {
      safeSet(STORAGE_KEY, DENIED_VALUE);
      renderDenied(overlay);
    });

    acceptButton?.focus({ preventScroll: true });
  };

  const trapFocus = (overlay, event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      return;
    }

    if (event.key !== "Tab") return;

    const focusables = [...overlay.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((item) => !item.disabled && item.offsetParent !== null);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const showGate = () => {
    if (document.getElementById(OVERLAY_ID)) return;

    injectStyles();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "ravene-age-gate";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "ravene-age-title");
    overlay.setAttribute("aria-describedby", "ravene-age-description");
    overlay.addEventListener("keydown", (event) => trapFocus(overlay, event));

    document.body.appendChild(overlay);

    if (hasPreviousDenial()) {
      renderDenied(overlay);
    } else {
      renderQuestion(overlay);
    }
  };

  injectStyles();

  if (document.body) {
    showGate();
  } else {
    document.addEventListener("DOMContentLoaded", showGate, { once: true });
  }
})();
