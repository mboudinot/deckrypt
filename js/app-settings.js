/* Settings modal controller.
 *
 * Owns: open/close of #settings-modal, the tab switching, and the
 * persistence of every preference that's actually wired today
 * (theme, default view, card language). Inert affordances (density,
 * format, notifications) are visual placeholders for now — their
 * full wiring is on the backlog.
 *
 * Entry points: account dropdown "Paramètres" item, or Ctrl+, / ⌘+,
 * (only when no other modal is open and no input is focused). */

(function () {
  const STORAGE_KEYS = {
    direction: "deckrypt-direction",
    defaultView: "deckrypt-default-view",
    cardLang: "mtg-hand-sim:manage-lang", // shared with app-manage.js
  };

  document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("settings-modal");
    const closeBtn = document.getElementById("btn-settings-close");
    const openTrigger = document.getElementById("btn-open-settings");
    if (!modal || !openTrigger) return;

    const navItems = modal.querySelectorAll(".settings-nav-item");
    const panels = modal.querySelectorAll(".settings-panel");
    const themeCards = modal.querySelectorAll(".theme-card");
    const accountCard = document.getElementById("settings-account-card");

    let restoreFocusTo = null;

    function openModal() {
      restoreFocusTo = document.activeElement;
      modal.hidden = false;
      /* Refresh dynamic content every open: theme card highlight,
       * preferences segmented controls, account info from the
       * current auth state. */
      refreshThemeSelection();
      refreshSegmented("default-view", localStorage.getItem(STORAGE_KEYS.defaultView) || "play");
      refreshSegmented("card-lang", localStorage.getItem(STORAGE_KEYS.cardLang) || "en");
      renderAccountCard();
      /* Defer focus so the modal has rendered. */
      requestAnimationFrame(() => {
        const firstTab = modal.querySelector(".settings-nav-item.active") || navItems[0];
        if (firstTab) firstTab.focus();
      });
    }

    function closeModal() {
      modal.hidden = true;
      if (restoreFocusTo && typeof restoreFocusTo.focus === "function") {
        restoreFocusTo.focus();
      }
    }

    function isInputFocused() {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }

    /* ---------------- Tab switching ---------------- */
    function switchTab(id) {
      for (const nav of navItems) {
        const active = nav.dataset.settingsTab === id;
        nav.classList.toggle("active", active);
        nav.setAttribute("aria-selected", String(active));
      }
      for (const panel of panels) {
        panel.hidden = panel.dataset.settingsPanel !== id;
      }
    }
    for (const nav of navItems) {
      nav.addEventListener("click", () => switchTab(nav.dataset.settingsTab));
    }

    /* ---------------- Theme picker ---------------- */
    function applyTheme(direction) {
      if (direction !== "studio" && direction !== "editorial") return;
      document.documentElement.setAttribute("data-direction", direction);
      try { localStorage.setItem(STORAGE_KEYS.direction, direction); } catch (e) { /* ignore */ }
      refreshThemeSelection();
    }
    function refreshThemeSelection() {
      const current = document.documentElement.getAttribute("data-direction") || "studio";
      for (const card of themeCards) {
        const isActive = card.dataset.theme === current;
        card.classList.toggle("active", isActive);
        card.setAttribute("aria-pressed", String(isActive));
      }
    }
    for (const card of themeCards) {
      card.addEventListener("click", () => applyTheme(card.dataset.theme));
    }

    /* ---------------- Generic segmented control helper ----------------
     * Some segmented groups persist their selection (default view,
     * card lang); others (density) are read-only placeholders for
     * now. The "data-segmented" attribute identifies the group;
     * persistence is keyed off it. */
    const PERSISTED_SEGMENTED = {
      "default-view": STORAGE_KEYS.defaultView,
      "card-lang": STORAGE_KEYS.cardLang,
    };
    function refreshSegmented(group, value) {
      const root = modal.querySelector(`.segmented[data-segmented="${group}"]`);
      if (!root) return;
      for (const btn of root.querySelectorAll("button")) {
        btn.classList.toggle("active", btn.dataset.value === value);
      }
    }
    for (const seg of modal.querySelectorAll(".segmented")) {
      if (seg.getAttribute("aria-disabled") === "true") continue;
      const group = seg.dataset.segmented;
      for (const btn of seg.querySelectorAll("button")) {
        btn.addEventListener("click", () => {
          const value = btn.dataset.value;
          refreshSegmented(group, value);
          const key = PERSISTED_SEGMENTED[group];
          if (key) {
            try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
          }
          /* Card language affects the manage view immediately — give
           * the app a chance to react if its hook exists. */
          if (group === "card-lang" && typeof window.setManageLanguage === "function") {
            window.setManageLanguage(value);
          }
        });
      }
    }

    /* ---------------- Account tab ---------------- */
    function renderAccountCard() {
      if (!accountCard) return;
      const user = window.sync && window.sync.currentUser();
      accountCard.replaceChildren();
      if (!user) {
        const p = document.createElement("p");
        p.style.color = "var(--text-muted)";
        p.style.margin = "0";
        p.textContent = "Pas connecté. Ouvre la page de connexion depuis le bouton du header.";
        accountCard.appendChild(p);
        return;
      }
      const initials = (user.displayName || user.email || "?")
        .split(/[\s@.]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() || "")
        .join("") || "?";
      const avatar = document.createElement("span");
      avatar.className = "account-avatar account-avatar-lg";
      avatar.textContent = initials;
      const info = document.createElement("div");
      info.className = "account-info";
      for (const [label, value] of [
        ["Nom", user.displayName || "—"],
        ["Email", user.email || "—"],
        ["UID", user.uid],
      ]) {
        const row = document.createElement("div");
        row.className = "account-info-row";
        const lab = document.createElement("span");
        lab.className = "label";
        lab.textContent = label;
        const val = document.createElement("strong");
        if (label === "UID" || label === "Email") {
          val.style.fontFamily = "var(--font-mono)";
          val.style.fontWeight = "500";
          val.style.fontSize = "13px";
        }
        val.textContent = value;
        row.appendChild(lab);
        row.appendChild(val);
        info.appendChild(row);
      }
      accountCard.appendChild(avatar);
      accountCard.appendChild(info);
    }

    /* ---------------- Open/close wiring ---------------- */
    openTrigger.addEventListener("click", () => {
      /* Close the account dropdown that hosts this trigger. */
      const acctMenu = document.getElementById("account-dropdown-menu");
      const acctBtn = document.getElementById("btn-account");
      if (acctMenu) acctMenu.hidden = true;
      if (acctBtn) acctBtn.setAttribute("aria-expanded", "false");
      openModal();
    });
    closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      /* Ctrl+, / Cmd+, opens the modal. Skip if any modal is open
       * (we don't want the shortcut firing inside a modal) or if
       * the user is typing in an input. */
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        if (isInputFocused()) return;
        e.preventDefault();
        if (modal.hidden) openModal();
        else closeModal();
        return;
      }
      if (e.key === "Escape" && !modal.hidden) {
        e.stopPropagation();
        closeModal();
      }
    });
  });
})();
