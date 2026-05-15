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

    /* ---------------- Theme picker ----------------
     * Local-first: localStorage is the boot source (read by
     * boot-theme.js before any stylesheet evaluates, no flash).
     * Firestore mirror is best-effort — saved on click for the next
     * device, loaded after auth resolves to pick up another device's
     * change. `_remote = true` skips the save round-trip when the
     * caller is itself applying a remote value. */
    function applyTheme(direction, { remote = false } = {}) {
      if (direction !== "studio" && direction !== "editorial") return;
      document.documentElement.setAttribute("data-direction", direction);
      try { localStorage.setItem(STORAGE_KEYS.direction, direction); } catch (e) { /* ignore */ }
      refreshThemeSelection();
      if (!remote && window.sync && typeof window.sync.savePreference === "function") {
        window.sync.savePreference("theme", direction).catch((e) => {
          console.warn("theme sync failed:", e?.message || e);
        });
      }
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

    /* On every login transition, pull the remote prefs once and adopt
     * the server's theme if it differs from what's locally applied.
     * Silent on failure — we keep whatever the local boot already
     * resolved. */
    if (window.sync && typeof window.sync.onAuthChange === "function") {
      window.sync.onAuthChange((user) => {
        if (!user) return;
        window.sync.loadPreferences().then((prefs) => {
          if (prefs && typeof prefs.theme === "string"
              && prefs.theme !== document.documentElement.getAttribute("data-direction")) {
            applyTheme(prefs.theme, { remote: true });
          }
        }).catch(() => { /* offline / rules — silent */ });
      });
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

    /* ---------------- Account tab ----------------
     * Renders:
     *   - account-card    : avatar + Pseudo / Email (read-only)
     *   - account-edit-row "Pseudo"        : Modifier → inline form
     *   - account-edit-row "Mot de passe"  : Modifier → inline form
     *     (disabled with a note when the user signed in via Google
     *      — there's no password to change in the app, only at Google).
     * UID is deliberately not displayed: it's an internal Firestore
     * primary key (rules + per-uid queue), not user-facing data. */
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
      accountCard.appendChild(buildAccountCard(user));
      accountCard.appendChild(buildPseudoEditor(user));
      accountCard.appendChild(buildPasswordEditor(user));
    }

    function userInitials(user) {
      return (user.displayName || user.email || "?")
        .split(/[\s@.]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() || "")
        .join("") || "?";
    }

    function buildAccountCard(user) {
      const card = document.createElement("div");
      card.className = "account-card";
      const avatar = document.createElement("span");
      avatar.className = "account-avatar account-avatar-lg";
      avatar.textContent = userInitials(user);
      const info = document.createElement("div");
      info.className = "account-info";
      for (const [label, value, mono] of [
        ["Pseudo", user.displayName || "—", false],
        ["Email", user.email || "—", true],
      ]) {
        const row = document.createElement("div");
        row.className = "account-info-row";
        const lab = document.createElement("span");
        lab.className = "label";
        lab.textContent = label;
        const val = document.createElement("strong");
        if (mono) {
          val.style.fontFamily = "var(--font-mono)";
          val.style.fontWeight = "500";
          val.style.fontSize = "13px";
        }
        val.textContent = value;
        row.append(lab, val);
        info.appendChild(row);
      }
      card.append(avatar, info);
      return card;
    }

    /* Toggleable inline editor. `mount` is the container that holds
     * the trigger row + the form; the form is rendered hidden, the
     * trigger flips its visibility. `onSubmit` returns a promise; on
     * resolve we close the form and re-render the card, on reject we
     * surface the message inline. */
    function attachInlineEditor({ row, form, onSubmit, onOpen }) {
      const wrap = document.createElement("div");
      wrap.append(row, form);
      const trigger = row.querySelector("[data-edit-open]");
      const cancel = form.querySelector("[data-edit-cancel]");
      const msg = form.querySelector(".account-edit-msg");
      form.hidden = true;
      const close = () => {
        form.hidden = true;
        if (msg) { msg.hidden = true; msg.className = "account-edit-msg"; msg.textContent = ""; }
        form.reset();
      };
      if (trigger) {
        trigger.addEventListener("click", () => {
          form.hidden = !form.hidden;
          if (!form.hidden) {
            if (typeof onOpen === "function") onOpen(form);
            const first = form.querySelector("input:not([disabled])");
            if (first) first.focus();
          }
        });
      }
      if (cancel) cancel.addEventListener("click", close);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (msg) { msg.hidden = true; msg.className = "account-edit-msg"; msg.textContent = ""; }
        const submit = form.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        try {
          const result = await onSubmit(form);
          if (msg && result && result.success) {
            msg.textContent = result.success;
            msg.className = "account-edit-msg success";
            msg.hidden = false;
            /* Re-render to pick up the new pseudo/etc. — defer so the
             * success message is visible for a moment before the form
             * collapses. */
            setTimeout(() => { renderAccountCard(); }, 700);
          } else {
            close();
            renderAccountCard();
          }
        } catch (err) {
          if (msg) {
            msg.textContent = errorMessage(err);
            msg.className = "account-edit-msg error";
            msg.hidden = false;
          }
        } finally {
          if (submit) submit.disabled = false;
        }
      });
      return wrap;
    }

    /* Password policy shared by the form HTML and the JS pre-flight
     * check. Min = 8 mirrors the signup form in app-login.js (Firebase
     * itself only enforces 6 — we apply the stricter rule across the
     * app). Max = 128 is defensive — Firebase quietly accepts huge
     * strings, but anything longer than this is almost certainly a
     * paste of unrelated content. */
    const PWD_MIN = 8;
    const PWD_MAX = 128;
    const PSEUDO_MAX = 60;

    /* Defensive normaliser for free-text user fields: strip control
     * characters (newlines, NULs, etc.) and trim outer whitespace.
     * Rendering paths already use textContent so the actual XSS
     * surface is closed; this is belt-and-braces against pastes that
     * sneak in tab/newline garbage. */
    function sanitiseLine(value) {
      if (typeof value !== "string") return "";
      // eslint-disable-next-line no-control-regex
      return value.replace(/[\x00-\x1F\x7F]/g, "").trim();
    }

    function errorMessage(err) {
      const code = err && err.code;
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        return "Mot de passe actuel incorrect.";
      }
      if (code === "auth/weak-password") {
        return `Mot de passe trop faible (${PWD_MIN} caractères minimum).`;
      }
      if (code === "auth/requires-recent-login") {
        return "Reconnecte-toi puis réessaie.";
      }
      return (err && err.message) || "Échec — réessaie.";
    }

    /* Reusable password input + Voir/Cacher toggle, matching the
     * login form's `.pwd-wrap` pattern. Returns the wrapper so the
     * caller can append it to a field. */
    function buildPasswordField({ id, name, autocomplete, label }) {
      const field = document.createElement("div");
      field.className = "field";
      const lbl = document.createElement("label");
      lbl.setAttribute("for", id);
      lbl.textContent = label;
      const wrap = document.createElement("div");
      wrap.className = "pwd-wrap";
      const input = document.createElement("input");
      input.type = "password";
      input.id = id;
      input.name = name;
      input.autocomplete = autocomplete;
      input.required = true;
      input.minLength = PWD_MIN;
      input.maxLength = PWD_MAX;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "pwd-toggle";
      toggle.setAttribute("aria-pressed", "false");
      toggle.setAttribute("aria-label", "Afficher le mot de passe");
      toggle.textContent = "Voir";
      toggle.addEventListener("click", () => {
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        toggle.textContent = showing ? "Voir" : "Cacher";
        toggle.setAttribute("aria-pressed", String(!showing));
        toggle.setAttribute(
          "aria-label",
          showing ? "Afficher le mot de passe" : "Masquer le mot de passe",
        );
      });
      wrap.append(input, toggle);
      field.append(lbl, wrap);
      return field;
    }

    function buildPseudoEditor(user) {
      const row = document.createElement("div");
      row.className = "account-edit-row";
      const left = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = "Pseudo";
      const desc = document.createElement("p");
      desc.textContent = "Le nom qu'on affiche pour ton compte.";
      left.append(title, desc);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm";
      btn.dataset.editOpen = "pseudo";
      btn.textContent = "Modifier";
      row.append(left, btn);

      const form = document.createElement("form");
      form.className = "account-edit-form";
      form.id = "settings-pseudo-form";
      const field = document.createElement("div");
      field.className = "field";
      const label = document.createElement("label");
      label.setAttribute("for", "settings-pseudo-input");
      label.textContent = "Nouveau pseudo";
      const input = document.createElement("input");
      input.type = "text";
      input.id = "settings-pseudo-input";
      input.name = "pseudo";
      input.autocomplete = "nickname";
      input.maxLength = PSEUDO_MAX;
      input.required = true;
      field.append(label, input);
      const actions = document.createElement("div");
      actions.className = "account-edit-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn btn-sm";
      cancel.dataset.editCancel = "true";
      cancel.textContent = "Annuler";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "btn btn-sm primary";
      submit.textContent = "Enregistrer";
      actions.append(cancel, submit);
      const msg = document.createElement("p");
      msg.className = "account-edit-msg";
      msg.hidden = true;
      form.append(field, actions, msg);

      return attachInlineEditor({
        row,
        form,
        onOpen: () => { input.value = user.displayName || ""; },
        onSubmit: async (f) => {
          const value = sanitiseLine(f.elements.pseudo.value);
          if (!value) throw new Error("Le pseudo ne peut pas être vide.");
          if (value.length > PSEUDO_MAX) {
            throw new Error(`Le pseudo ne peut pas dépasser ${PSEUDO_MAX} caractères.`);
          }
          await window.sync.updateDisplayName(value);
          return { success: "Pseudo mis à jour." };
        },
      });
    }

    function buildPasswordEditor(user) {
      const row = document.createElement("div");
      row.className = "account-edit-row";
      const left = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = "Mot de passe";
      const desc = document.createElement("p");
      const isPasswordUser = Array.isArray(user.providers) && user.providers.includes("password");
      desc.textContent = isPasswordUser
        ? "Renouvelle ton mot de passe d'accès."
        : "Connecté via Google — change ton mot de passe depuis ton compte Google.";
      left.append(title, desc);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm";
      btn.dataset.editOpen = "password";
      btn.textContent = "Modifier";
      btn.disabled = !isPasswordUser;
      if (!isPasswordUser) btn.title = "Indisponible pour un compte Google.";
      row.append(left, btn);

      const form = document.createElement("form");
      form.className = "account-edit-form";
      form.id = "settings-password-form";
      for (const [name, label, autocomplete] of [
        ["current", "Mot de passe actuel", "current-password"],
        ["next", "Nouveau mot de passe", "new-password"],
        ["confirm", "Confirmer le nouveau mot de passe", "new-password"],
      ]) {
        form.appendChild(buildPasswordField({
          id: `settings-pwd-${name}`,
          name,
          autocomplete,
          label,
        }));
      }
      const actions = document.createElement("div");
      actions.className = "account-edit-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn btn-sm";
      cancel.dataset.editCancel = "true";
      cancel.textContent = "Annuler";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "btn btn-sm primary";
      submit.textContent = "Mettre à jour";
      actions.append(cancel, submit);
      const msg = document.createElement("p");
      msg.className = "account-edit-msg";
      msg.hidden = true;
      form.append(actions, msg);

      return attachInlineEditor({
        row,
        form,
        onSubmit: async (f) => {
          const current = f.elements.current.value;
          const next = f.elements.next.value;
          const confirm = f.elements.confirm.value;
          /* Pre-flight validations — Firebase would catch length and
           * mismatch eventually, but the inline message lands faster
           * and avoids round-tripping a wrong-password reauth before
           * the user even sees the issue. Order matters: empty/length
           * before mismatch (no point telling them "passwords don't
           * match" when one is too short anyway). */
          if (!current || !next || !confirm) {
            throw new Error("Renseigne les trois champs.");
          }
          if (next.length < PWD_MIN) {
            throw new Error(`Le nouveau mot de passe doit faire au moins ${PWD_MIN} caractères.`);
          }
          if (next.length > PWD_MAX) {
            throw new Error(`Le nouveau mot de passe ne peut pas dépasser ${PWD_MAX} caractères.`);
          }
          if (next !== confirm) {
            throw new Error("Les deux nouveaux mots de passe ne correspondent pas.");
          }
          if (next === current) {
            throw new Error("Le nouveau mot de passe doit être différent de l'ancien.");
          }
          await window.sync.changePassword(current, next);
          return { success: "Mot de passe mis à jour." };
        },
      });
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
