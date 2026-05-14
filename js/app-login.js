/* Login overlay controller.
 *
 * Owns: the show/hide of #login-overlay, the signin/signup form
 * submission, the Google button, the password visibility toggle,
 * and the header "Connexion" / "<email>" button that opens it.
 *
 * Does not own: the actual auth — that's window.sync.signInWith*().
 * The overlay closes automatically when window.sync.onAuthChange
 * reports a logged-in user, so any path that authenticates
 * (popup, password, even devtools) gets the same UX. */

(function () {
  /* sync.js is an ES module and runs AFTER classic deferred scripts,
   * so window.sync isn't defined yet at this point. Wait for DOM
   * ready before wiring anything — all deferred + module scripts
   * have executed by then. */
  document.addEventListener("DOMContentLoaded", () => {
    const overlay = document.getElementById("login-overlay");
    const closeBtn = document.getElementById("login-close");
    const accountBtn = document.getElementById("btn-account");
    const form = document.getElementById("login-form");
    const emailInput = document.getElementById("login-email");
    const pwdInput = document.getElementById("login-pwd");
    const pwdToggle = document.getElementById("login-pwd-toggle");
    const pwdHint = document.getElementById("login-pwd-hint");
    const googleBtn = document.getElementById("login-google");
    const submitBtn = document.getElementById("login-submit");
    const submitLabel = document.getElementById("login-submit-label");
    const modeToggleLink = document.getElementById("login-mode-toggle");
    const modePrefix = document.getElementById("login-mode-prefix");
    const signinOnlyRow = document.getElementById("login-signin-only");
    const errorBox = document.getElementById("login-error");
    const title = document.getElementById("login-title");
    const sub = document.getElementById("login-sub");
    const forgotLink = document.getElementById("login-forgot");

    if (!overlay || !accountBtn) return; // page not deckrypt's

    /* "signin" or "signup". The signup form requires a longer
     * password and uses different autocomplete + copy. */
    let mode = "signin";
    let openerForFocusReturn = null;

    function applyMode() {
      if (mode === "signin") {
        title.textContent = "Connexion";
        sub.textContent = "Accède à tes decks, ton historique de parties et tes analyses.";
        submitLabel.textContent = "Se connecter";
        pwdInput.autocomplete = "current-password";
        pwdInput.removeAttribute("minlength");
        pwdHint.hidden = true;
        signinOnlyRow.hidden = false;
        modePrefix.textContent = "Pas encore de compte ?";
        modeToggleLink.textContent = "S'inscrire";
      } else {
        title.textContent = "Créer un compte";
        sub.textContent = "Gère tes decks dans le cloud, synchronisés sur tous tes appareils.";
        submitLabel.textContent = "Créer mon compte";
        pwdInput.autocomplete = "new-password";
        pwdInput.minLength = 8;
        pwdHint.hidden = false;
        signinOnlyRow.hidden = true;
        modePrefix.textContent = "Déjà inscrit ?";
        modeToggleLink.textContent = "Se connecter";
      }
      clearError();
    }

    /* Low-level toggle that bypasses the auth-lock guard. Used by the
     * auth-state subscriber to open/close the overlay in lock-step
     * with sign-in / sign-out. User-initiated close goes through
     * closeOverlay() instead so the lock is respected. */
    function setOverlayVisible(visible) {
      if (visible) {
        if (overlay.hidden) openerForFocusReturn = document.activeElement;
        mode = "signin";
        applyMode();
        form.reset();
        pwdInput.type = "password";
        pwdToggle.textContent = "Voir";
        pwdToggle.setAttribute("aria-pressed", "false");
        overlay.hidden = false;
        accountBtn.setAttribute("aria-expanded", "true");
        /* Defer focus to give the overlay a frame to lay out — focusing
         * on a display:none subtree fails silently. */
        requestAnimationFrame(() => emailInput.focus());
      } else {
        overlay.hidden = true;
        accountBtn.setAttribute("aria-expanded", "false");
        clearError();
        if (openerForFocusReturn && typeof openerForFocusReturn.focus === "function") {
          openerForFocusReturn.focus();
        }
        openerForFocusReturn = null;
      }
    }

    function openOverlay() {
      setOverlayVisible(true);
    }

    /* User-initiated close (X button, Escape, backdrop click). Bails
     * when the app is auth-locked: the overlay is the ONLY thing
     * standing between an anonymous user and a blank page, so we
     * can't let it be dismissed without authenticating. The auth
     * subscriber bypasses this guard via setOverlayVisible.
     *
     * The class lives on <html> (set synchronously by boot-theme.js
     * before <body> parses, see the session-hint optimistic-boot
     * comment there). */
    function closeOverlay() {
      if (document.documentElement.classList.contains("auth-locked")) return;
      setOverlayVisible(false);
    }

    function clearError() {
      errorBox.hidden = true;
      errorBox.textContent = "";
      window.formValidate.clearInvalid(emailInput);
      window.formValidate.clearInvalid(pwdInput);
    }

    /* Per-field auto-clear: red border disappears as the user engages
     * with the flagged field. The aggregate error message stays until
     * the next submit so they can still read it. */
    window.formValidate.attachAutoClear(emailInput);
    window.formValidate.attachAutoClear(pwdInput);

    /* Firebase auth error codes -> readable French. Anything not in
     * the map falls back to a generic message + the raw code, so
     * users can at least search for it. */
    function readableAuthError(err) {
      const code = err && err.code ? String(err.code) : "";
      const map = {
        "auth/invalid-email": "Adresse email invalide.",
        "auth/missing-password": "Renseigne ton mot de passe.",
        "auth/wrong-password": "Email ou mot de passe incorrect.",
        "auth/user-not-found": "Aucun compte avec cet email.",
        "auth/invalid-credential": "Email ou mot de passe incorrect.",
        "auth/email-already-in-use": "Un compte existe déjà avec cet email.",
        "auth/weak-password": "Mot de passe trop faible (minimum 8 caractères).",
        "auth/too-many-requests": "Trop d'essais. Réessaie dans quelques minutes.",
        "auth/popup-closed-by-user": "Fenêtre Google fermée avant la connexion.",
        "auth/popup-blocked": "Fenêtre Google bloquée par le navigateur.",
        "auth/network-request-failed": "Pas de réseau. Vérifie ta connexion.",
      };
      if (map[code]) return map[code];
      if (code) return `Connexion impossible (${code}).`;
      return "Connexion impossible. Réessaie.";
    }

    function showError(errOrMessage) {
      errorBox.textContent = typeof errOrMessage === "string"
        ? errOrMessage
        : readableAuthError(errOrMessage);
      errorBox.hidden = false;
    }

    function setBusy(busy) {
      submitBtn.disabled = busy;
      googleBtn.disabled = busy;
      emailInput.disabled = busy;
      pwdInput.disabled = busy;
    }

    /* The account button has two visual modes — anon (Connexion pill)
     * and authed (avatar + name + chevron). In the login-obligatoire
     * model the anon variant is rendered ONLY as a defensive fallback
     * during the brief window between sync.js firing user=null and
     * applyAuthState adding html.auth-locked to hide the shell; the
     * user never sees it interactively. The click handler keeps both
     * branches so a stray click during that transition still does
     * something useful (open the overlay) instead of throwing. */
    const accountMenu = document.getElementById("account-dropdown-menu");
    const accountLabel = document.getElementById("account-label");
    const accountMenuName = document.getElementById("account-menu-name");
    const accountMenuEmail = document.getElementById("account-menu-email");
    const accountSignoutBtn = document.getElementById("btn-account-signout");

    function initialsOf(user) {
      const src = user.displayName || user.email || "?";
      const parts = src.split(/[\s@.]+/).filter(Boolean);
      const first = parts[0]?.[0] || "?";
      const second = parts[1]?.[0] || "";
      return (first + second).toUpperCase().slice(0, 2);
    }

    function refreshAccountButton(user) {
      accountBtn.replaceChildren();
      if (user) {
        accountBtn.classList.remove("account-anon");
        accountBtn.classList.add("account-authed");
        const avatar = document.createElement("span");
        avatar.className = "account-avatar";
        avatar.textContent = initialsOf(user);
        const name = document.createElement("span");
        name.className = "account-name";
        name.id = "account-label";
        name.textContent = user.displayName || user.email || "Mon compte";
        const chev = document.createElement("span");
        chev.className = "account-chev";
        chev.setAttribute("aria-hidden", "true");
        chev.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
        accountBtn.appendChild(avatar);
        accountBtn.appendChild(name);
        accountBtn.appendChild(chev);
        if (accountMenuName) accountMenuName.textContent = user.displayName || user.email || "";
        if (accountMenuEmail) accountMenuEmail.textContent = user.email || "";
      } else {
        accountBtn.classList.remove("account-authed");
        accountBtn.classList.add("account-anon");
        const span = document.createElement("span");
        span.className = "account-name";
        span.id = "account-label";
        span.textContent = "Connexion";
        accountBtn.appendChild(span);
        if (accountMenu) accountMenu.hidden = true;
      }
    }

    /* Account dropdown machinery (outside-click close, Escape close,
     * aria-expanded sync) handled by setupDropdown. We pass
     * autoToggle:false because the trigger does different things
     * depending on auth state — opening the login overlay when anon
     * vs toggling the menu when authed. */
    const accountDropdown = setupDropdown({
      trigger: accountBtn,
      menu: accountMenu,
      autoToggle: false,
    });
    accountBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const user = window.sync && window.sync.currentUser();
      if (user) {
        if (accountDropdown) accountDropdown.toggle();
      } else {
        openOverlay();
      }
    });

    if (accountSignoutBtn) {
      accountSignoutBtn.addEventListener("click", async () => {
        if (accountDropdown) accountDropdown.close();
        try { await window.sync.signOut(); } catch (e) { console.error(e); }
      });
    }

    closeBtn.addEventListener("click", closeOverlay);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) closeOverlay();
    });

    pwdToggle.addEventListener("click", () => {
      const showing = pwdInput.type === "text";
      pwdInput.type = showing ? "password" : "text";
      pwdToggle.textContent = showing ? "Voir" : "Cacher";
      pwdToggle.setAttribute("aria-pressed", String(!showing));
    });

    modeToggleLink.addEventListener("click", (e) => {
      e.preventDefault();
      mode = mode === "signin" ? "signup" : "signin";
      applyMode();
    });

    forgotLink.addEventListener("click", (e) => {
      e.preventDefault();
      /* Password reset endpoint isn't on the façade yet. Stub for
       * now — wire when sendPasswordResetEmail is exposed. */
      alert("Réinitialisation par email à venir. En attendant, contacte l'admin.");
    });

    googleBtn.addEventListener("click", async () => {
      clearError();
      setBusy(true);
      try {
        await window.sync.signInWithGoogle();
        /* Overlay close handled by onAuthChange below. */
      } catch (e) {
        showError(e);
      } finally {
        setBusy(false);
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();
      const email = emailInput.value.trim();
      const pwd = pwdInput.value;
      const missingEmail = !email;
      const missingPwd = !pwd;
      /* Collect every problem before bailing — flagging only the
       * first invalid field made the form feel like whack-a-mole on
       * each submit. Now both fields are validated independently;
       * each gets its own red border + reason, and the aggregate
       * message stitches them together. */
      const issues = [];
      if (missingEmail) {
        window.formValidate.flagInvalid(emailInput);
        issues.push({ field: emailInput, msg: "Renseigne ton email" });
      } else if (!window.formValidate.isValidEmail(email)) {
        window.formValidate.flagInvalid(emailInput);
        issues.push({ field: emailInput, msg: "Format d'email invalide" });
      }
      if (missingPwd) {
        window.formValidate.flagInvalid(pwdInput);
        issues.push({ field: pwdInput, msg: "Renseigne ton mot de passe" });
      } else if (mode === "signup" && !window.formValidate.isStrongPassword(pwd)) {
        window.formValidate.flagInvalid(pwdInput);
        issues.push({ field: pwdInput, msg: "Mot de passe : minimum 8 caractères avec au moins 1 chiffre" });
      }
      if (issues.length > 0) {
        /* Both fields empty is the most common scrub-submit case --
         * keep the nicer "X et Y" phrasing for it. Any other combo
         * (mixed empty/format) falls back to a `·`-joined list. */
        const bothMissing = missingEmail && missingPwd && issues.length === 2;
        const msg = bothMissing
          ? "Renseigne ton email et ton mot de passe."
          : issues.map((i) => i.msg).join(" · ") + ".";
        showError(msg);
        issues[0].field.focus();
        return;
      }
      setBusy(true);
      try {
        if (mode === "signin") {
          await window.sync.signInWithEmail(email, pwd);
        } else {
          await window.sync.signUpWithEmail(email, pwd);
        }
        /* Overlay close handled by onAuthChange. */
      } catch (err) {
        showError(err);
      } finally {
        setBusy(false);
      }
    });

    /* React to auth changes: refresh the header button, gate the app
     * shell behind the overlay. The html.auth-locked class is the
     * single source of truth — boot-theme.js applies it synchronously
     * pre-paint when the session hint is absent (avoids flash for
     * anon boots), and we toggle it here on every auth transition.
     * Components.css reads it to hide .container + the login-close X.
     *
     * Subscriber timing: sync.js's onAuthChange skips the immediate
     * replay until Firebase resolves persistence (authResolved flag),
     * so this callback fires ONCE with the real state — no premature
     * cb(null) → relock → flash race.
     *
     *  - user present  → unlock + close overlay
     *  - user absent   → lock + show overlay
     * Idempotent on both transitions (already-hidden / already-shown
     * are no-ops). */
    function applyAuthState(user) {
      refreshAccountButton(user);
      /* The hint class served its purpose (paint the optimistic
       * authed placeholder pre-paint) the moment we have a real
       * answer from Firebase. Drop it so a later sign-out or sign-in
       * doesn't repaint the placeholder over the real state. */
      document.documentElement.classList.remove("has-session-hint");
      if (user) {
        document.documentElement.classList.remove("auth-locked");
        if (!overlay.hidden) setOverlayVisible(false);
      } else {
        document.documentElement.classList.add("auth-locked");
        if (overlay.hidden) setOverlayVisible(true);
      }
    }
    if (window.sync && typeof window.sync.onAuthChange === "function") {
      window.sync.onAuthChange(applyAuthState);
    } else {
      /* sync.js is a module and may execute after this classic-defer
       * script even though we wrapped in DOMContentLoaded — different
       * browsers schedule module-vs-defer ordering differently. Poll
       * for it (cheaply) until it shows up. */
      const t = setInterval(() => {
        if (window.sync && typeof window.sync.onAuthChange === "function") {
          clearInterval(t);
          window.sync.onAuthChange(applyAuthState);
        }
      }, 50);
      setTimeout(() => clearInterval(t), 5000);
    }
  });
})();
