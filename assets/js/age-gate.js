(() => {
  const STORAGE_KEY = "raveneHub.ageGate.v1";
  const ACCEPTED_VALUE = "adult";
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
      // Storage can be disabled in private browsers. The gate still works for the current page load.
    }
  };

  const state = safeGet(STORAGE_KEY);
  if (state === ACCEPTED_VALUE) return;

  document.documentElement.classList.add(PENDING_CLASS);

  const injectStyles = () => {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.${PENDING_CLASS},
      html.${PENDING_CLASS} body {
        overflow: hidden !important;
      }

      html.${PENDING_CLASS} body > :not(.age-gate-overlay) {
        visibility: hidden !important;
      }

      .age-gate-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        padding: 22px;
        color: #e8eef8;
        background:
          radial-gradient(circle at 20% 8%, rgba(133, 59, 255, 0.30), transparent 34%),
          radial-gradient(circle at 82% 22%, rgba(255, 125, 59, 0.14), transparent 32%),
          rgba(2, 4, 9, 0.94);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        box-sizing: border-box;
        font-family: Exo2, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .age-gate-card {
        width: min(560px, 100%);
        padding: 28px;
        border: 1px solid rgba(232, 238, 248, 0.16);
        border-radius: 26px;
        background:
          linear-gradient(145deg, rgba(18, 22, 34, 0.98), rgba(7, 10, 18, 0.98)),
          rgba(8, 11, 20, 0.96);
        box-shadow: 0 28px 90px rgba(0, 0, 0, 0.58), inset 0 1px 0 rgba(255, 255, 255, 0.06);
        box-sizing: border-box;
      }

      .age-gate-kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 14px;
        color: rgba(232, 238, 248, 0.68);
        font-size: 12px;
        line-height: 1.4;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .age-gate-kicker::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #8b4dff;
        box-shadow: 0 0 22px rgba(139, 77, 255, 0.85);
      }

      .age-gate-title {
        margin: 0;
        color: #ffffff;
        font-size: clamp(30px, 5vw, 48px);
        line-height: 0.96;
        font-weight: 700;
        letter-spacing: -0.045em;
      }

      .age-gate-text {
        margin: 16px 0 0;
        color: rgba(232, 238, 248, 0.76);
        font-size: 15px;
        line-height: 1.7;
      }

      .age-gate-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-top: 24px;
      }

      .age-gate-button {
        appearance: none;
        min-height: 48px;
        padding: 13px 16px;
        border: 1px solid rgba(232, 238, 248, 0.16);
        border-radius: 16px;
        color: #e8eef8;
        background: rgba(255, 255, 255, 0.055);
        box-shadow: none;
        cursor: pointer;
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.2;
        transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
      }

      .age-gate-button:hover,
      .age-gate-button:focus-visible {
        border-color: rgba(232, 238, 248, 0.34);
        background: rgba(255, 255, 255, 0.095);
        outline: none;
        transform: translateY(-1px);
      }

      .age-gate-button-primary {
        border-color: rgba(159, 104, 255, 0.65);
        background: linear-gradient(135deg, rgba(126, 42, 255, 0.98), rgba(173, 82, 255, 0.92));
        box-shadow: 0 16px 38px rgba(126, 42, 255, 0.34);
        color: #ffffff;
      }

      .age-gate-button-primary:hover,
      .age-gate-button-primary:focus-visible {
        border-color: rgba(210, 184, 255, 0.88);
        background: linear-gradient(135deg, rgba(140, 61, 255, 1), rgba(190, 98, 255, 0.98));
      }

      .age-gate-footnote {
        margin: 18px 0 0;
        color: rgba(232, 238, 248, 0.52);
        font-size: 12px;
        line-height: 1.6;
      }

      @media (max-width: 560px) {
        .age-gate-overlay {
          padding: 16px;
          align-items: end;
        }

        .age-gate-card {
          padding: 22px;
          border-radius: 22px;
        }

        .age-gate-actions {
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
    overlay.innerHTML = `
      <section class="age-gate-card" role="document">
        <p class="age-gate-kicker">Adult access only</p>
        <h2 class="age-gate-title" id="age-gate-title">Access unavailable</h2>
        <p class="age-gate-text" id="age-gate-description">Ravene Hub is intended for adult visitors only. Please leave the site if you are not of legal age in your jurisdiction.</p>
        <div class="age-gate-actions">
          <button class="age-gate-button age-gate-button-primary" type="button" data-age-gate-leave>Leave site</button>
        </div>
        <p class="age-gate-footnote">If you selected this by mistake, clear this site's browser storage and reload the page.</p>
      </section>
    `;

    const leaveButton = overlay.querySelector("[data-age-gate-leave]");
    leaveButton?.addEventListener("click", leaveSite);
    leaveButton?.focus({ preventScroll: true });
  };

  const renderQuestion = (overlay) => {
    overlay.innerHTML = `
      <section class="age-gate-card" role="document">
        <p class="age-gate-kicker">Age check</p>
        <h2 class="age-gate-title" id="age-gate-title">Are you an adult?</h2>
        <p class="age-gate-text" id="age-gate-description">Ravene Hub may contain mature fictional themes and adult-oriented digital content. By entering, you confirm that you are at least 18 years old, or the age of majority in your jurisdiction if higher.</p>
        <div class="age-gate-actions">
          <button class="age-gate-button age-gate-button-primary" type="button" data-age-gate-accept>Yes, enter</button>
          <button class="age-gate-button" type="button" data-age-gate-deny>No, leave</button>
        </div>
        <p class="age-gate-footnote">This check is remembered in this browser. Ravene Hub does not use it to verify your legal identity.</p>
      </section>
    `;

    const acceptButton = overlay.querySelector("[data-age-gate-accept]");
    const denyButton = overlay.querySelector("[data-age-gate-deny]");

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
    overlay.className = "age-gate-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "age-gate-title");
    overlay.setAttribute("aria-describedby", "age-gate-description");
    overlay.addEventListener("keydown", (event) => trapFocus(overlay, event));

    document.body.appendChild(overlay);

    if (state === DENIED_VALUE) {
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
