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
    const termsLine = document.getElementById("login-terms-line");
    const dividerEl = document.getElementById("login-divider");
    const pwdField = document.getElementById("login-pwd-field");
    const resetSuccess = document.getElementById("login-reset-success");
    const resetBackBtn = document.getElementById("login-reset-back");
    const resetCompleteForm = document.getElementById("login-reset-complete-form");
    const resetEmailTarget = document.getElementById("login-reset-email-target");
    const resetNewInput = document.getElementById("login-reset-new");
    const resetNewToggle = document.getElementById("login-reset-new-toggle");
    const resetConfirmInput = document.getElementById("login-reset-confirm");
    const resetConfirmToggle = document.getElementById("login-reset-confirm-toggle");
    const resetCompleteError = document.getElementById("login-reset-complete-error");
    const resetCompleteSubmit = document.getElementById("login-reset-complete-submit");

    if (!overlay || !accountBtn) return; // page not deckrypt's

    /* Two-level state. `view` selects which pane is visible in
     * `.login-form-wrap` ("login" form, "reset-success" card,
     * "reset-complete" new-password form). Inside the "login" view,
     * `mode` selects which login sub-flow is active: "signin",
     * "signup", or "reset-request" (forgot-password email form). */
    let view = "login";
    let mode = "signin";
    /* Set when the user lands on the app via the password-reset email
     * link (?mode=resetPassword&oobCode=…). Captured at boot, replayed
     * on overlay-open so the auth-state subscriber's automatic open
     * routes to the reset-complete form instead of the signin form. */
    let pendingResetCode = null;
    /* One-shot success message to surface in the signin pane after a
     * successful password reset — cleared the moment it's rendered. */
    let postResetSuccess = false;
    let openerForFocusReturn = null;

    /* Strength meter — only relevant in signup mode (no point rating
     * the password when the user is just signing in to an existing
     * account). Mounted once next to the hint, refreshed on every
     * keystroke + email change. The meter manages its own
     * visibility for empty input; we additionally force-hide it in
     * signin mode via `refreshPwdMeter`. */
    const pwdMeter = buildPasswordMeter();
    pwdHint.after(pwdMeter.root);
    function refreshPwdMeter() {
      if (mode === "signup") {
        pwdMeter.update(pwdInput.value, { email: emailInput.value });
      } else {
        pwdMeter.update("", {});
      }
    }
    pwdInput.addEventListener("input", refreshPwdMeter);
    emailInput.addEventListener("input", refreshPwdMeter);

    function applyMode() {
      if (mode === "signin") {
        title.textContent = "Connexion";
        sub.textContent = "Accède à tes decks, ton historique de parties et tes analyses.";
        submitLabel.textContent = "Se connecter";
        pwdInput.autocomplete = "current-password";
        pwdInput.removeAttribute("minlength");
        pwdInput.required = true;
        pwdHint.hidden = true;
        pwdField.hidden = false;
        signinOnlyRow.hidden = false;
        googleBtn.hidden = false;
        if (dividerEl) dividerEl.hidden = false;
        if (termsLine) termsLine.hidden = false;
        modePrefix.textContent = "Pas encore de compte ?";
        modeToggleLink.textContent = "S'inscrire";
      } else if (mode === "signup") {
        title.textContent = "Créer un compte";
        sub.textContent = "Gère tes decks dans le cloud, synchronisés sur tous tes appareils.";
        submitLabel.textContent = "Créer mon compte";
        pwdInput.autocomplete = "new-password";
        pwdInput.minLength = 8;
        pwdInput.required = true;
        pwdHint.hidden = false;
        pwdField.hidden = false;
        signinOnlyRow.hidden = true;
        googleBtn.hidden = false;
        if (dividerEl) dividerEl.hidden = false;
        if (termsLine) termsLine.hidden = false;
        modePrefix.textContent = "Déjà inscrit ?";
        modeToggleLink.textContent = "Se connecter";
      } else {
        /* reset-request: only the email + submit are useful here.
         * Hide the password field, Google button, divider and
         * remember/forgot row to keep the form focused on the single
         * action. The terms line is also hidden since the user isn't
         * creating an account at this step. */
        title.textContent = "Mot de passe oublié";
        sub.textContent = "Saisis ton email — on t'envoie un lien pour choisir un nouveau mot de passe.";
        submitLabel.textContent = "Envoyer le lien";
        pwdInput.required = false;
        pwdField.hidden = true;
        pwdHint.hidden = true;
        signinOnlyRow.hidden = true;
        googleBtn.hidden = true;
        if (dividerEl) dividerEl.hidden = true;
        if (termsLine) termsLine.hidden = true;
        modePrefix.textContent = "Tu te rappelles de ton mot de passe ?";
        modeToggleLink.textContent = "Retour à la connexion";
      }
      refreshPwdMeter();
      clearError();
    }

    /* Swap which pane of `.login-form-wrap` is visible. Exactly one of
     * the three children (login form, reset-success card,
     * reset-complete form) is shown at a time. Called whenever `view`
     * changes — keep this the single source of truth on pane
     * visibility. */
    function applyView() {
      form.hidden = view !== "login";
      resetSuccess.hidden = view !== "reset-success";
      resetCompleteForm.hidden = view !== "reset-complete";
      /* Surface the one-shot post-reset success message exactly once,
       * on the first signin-view render after a successful reset. */
      if (view === "login" && mode === "signin" && postResetSuccess) {
        showError("Mot de passe réinitialisé. Connecte-toi avec ton nouveau mot de passe.");
        errorBox.classList.add("login-success");
        postResetSuccess = false;
      } else {
        errorBox.classList.remove("login-success");
      }
    }

    /* Low-level toggle that bypasses the auth-lock guard. Used by the
     * auth-state subscriber to open/close the overlay in lock-step
     * with sign-in / sign-out. User-initiated close goes through
     * closeOverlay() instead so the lock is respected. */
    function setOverlayVisible(visible) {
      if (visible) {
        if (overlay.hidden) openerForFocusReturn = document.activeElement;
        /* When the user lands via the password-reset email link, route
         * straight to the complete-reset form instead of the signin
         * form. pendingResetCode is captured at boot from the URL
         * params and consumed exactly once. */
        if (pendingResetCode) {
          const code = pendingResetCode;
          pendingResetCode = null;
          enterResetComplete(code);
        } else {
          view = "login";
          mode = "signin";
          applyMode();
          applyView();
          form.reset();
          pwdInput.type = "password";
          pwdToggle.textContent = "Voir";
          pwdToggle.setAttribute("aria-pressed", "false");
        }
        overlay.hidden = false;
        accountBtn.setAttribute("aria-expanded", "true");
        /* Defer focus to give the overlay a frame to lay out — focusing
         * on a display:none subtree fails silently. */
        requestAnimationFrame(() => {
          if (view === "reset-complete") resetNewInput.focus();
          else emailInput.focus();
        });
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
      errorBox.classList.remove("login-success");
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
        "auth/expired-action-code": "Ce lien de réinitialisation a expiré.",
        "auth/invalid-action-code": "Ce lien de réinitialisation est invalide ou a déjà été utilisé.",
        "auth/user-disabled": "Ce compte a été désactivé.",
      };
      if (map[code]) return map[code];
      if (code) return `Connexion impossible (${code}).`;
      return "Connexion impossible. Réessaie.";
    }

    function showError(errOrMessage) {
      errorBox.textContent = typeof errOrMessage === "string"
        ? errOrMessage
        : readableAuthError(errOrMessage);
      errorBox.classList.remove("login-success");
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
      /* signin ↔ signup is the historic toggle. reset-request always
       * returns to signin (it's not a sibling of signup). */
      mode = mode === "reset-request" ? "signin"
        : mode === "signin" ? "signup"
        : "signin";
      applyMode();
    });

    forgotLink.addEventListener("click", (e) => {
      e.preventDefault();
      mode = "reset-request";
      applyMode();
      requestAnimationFrame(() => emailInput.focus());
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
      /* Password is irrelevant in reset-request mode — the field is
       * hidden and required=false, just validate the email. */
      if (mode !== "reset-request") {
        if (missingPwd) {
          window.formValidate.flagInvalid(pwdInput);
          issues.push({ field: pwdInput, msg: "Renseigne ton mot de passe" });
        } else if (mode === "signup" && !window.formValidate.isStrongPassword(pwd)) {
          window.formValidate.flagInvalid(pwdInput);
          issues.push({ field: pwdInput, msg: "Mot de passe : minimum 8 caractères avec au moins 1 chiffre" });
        }
      }
      if (issues.length > 0) {
        /* Both fields empty is the most common scrub-submit case --
         * keep the nicer "X et Y" phrasing for it. Any other combo
         * (mixed empty/format) falls back to a `·`-joined list. */
        const bothMissing = missingEmail && missingPwd && issues.length === 2 && mode !== "reset-request";
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
        } else if (mode === "signup") {
          await window.sync.signUpWithEmail(email, pwd);
        } else {
          /* reset-request — Firebase doesn't leak whether the email
           * exists (no auth/user-not-found on this endpoint), so we
           * show the same neutral success card regardless. The only
           * errors that bubble up are format / rate-limit / network. */
          await window.sync.sendPasswordReset(email);
          view = "reset-success";
          applyView();
        }
        /* Overlay close on signin/signup handled by onAuthChange. */
      } catch (err) {
        showError(err);
      } finally {
        setBusy(false);
      }
    });

    /* Back-to-login button in the reset-success card. Reuses
     * setOverlayVisible(true)'s reset → signin path. */
    resetBackBtn.addEventListener("click", () => {
      view = "login";
      mode = "signin";
      form.reset();
      applyMode();
      applyView();
      requestAnimationFrame(() => emailInput.focus());
    });

    /* Enter the reset-complete flow: verify the code with Firebase
     * before showing the form so we can (a) reject bad/expired codes
     * upfront and (b) display the target email so the user sees whose
     * password they're resetting. Errors fall back to the signin pane
     * with a contextual message — no point keeping a broken form on
     * screen. */
    async function enterResetComplete(oobCode) {
      view = "reset-complete";
      applyView();
      resetCompleteForm.dataset.oobCode = oobCode;
      resetEmailTarget.textContent = "…";
      hideResetCompleteError();
      try {
        const email = await window.sync.verifyPasswordResetCode(oobCode);
        resetEmailTarget.textContent = email;
      } catch (err) {
        /* Bad code → back to signin with an explanation. The user can
         * request a fresh link from there. */
        view = "login";
        mode = "signin";
        applyMode();
        applyView();
        showError(readableAuthError(err) + " Demande un nouveau lien.");
      }
    }

    function hideResetCompleteError() {
      resetCompleteError.hidden = true;
      resetCompleteError.textContent = "";
      window.formValidate.clearInvalid(resetNewInput);
      window.formValidate.clearInvalid(resetConfirmInput);
    }

    function showResetCompleteError(errOrMessage) {
      resetCompleteError.textContent = typeof errOrMessage === "string"
        ? errOrMessage
        : readableAuthError(errOrMessage);
      resetCompleteError.hidden = false;
    }

    /* Strength meter on the new-password field, mirroring the signup
     * meter — same module, same tuning, just attached to a different
     * input. */
    const resetPwdMeter = buildPasswordMeter();
    resetNewInput.parentElement.parentElement.appendChild(resetPwdMeter.root);
    resetNewInput.addEventListener("input", () => {
      resetPwdMeter.update(resetNewInput.value, { email: resetEmailTarget.textContent });
    });

    /* Voir/Cacher parity with the login form. Each input gets its own
     * toggle since the two fields are independent. */
    function wirePwdToggle(input, toggle) {
      toggle.addEventListener("click", () => {
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        toggle.textContent = showing ? "Voir" : "Cacher";
        toggle.setAttribute("aria-pressed", String(!showing));
      });
    }
    wirePwdToggle(resetNewInput, resetNewToggle);
    wirePwdToggle(resetConfirmInput, resetConfirmToggle);

    window.formValidate.attachAutoClear(resetNewInput);
    window.formValidate.attachAutoClear(resetConfirmInput);

    resetCompleteForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideResetCompleteError();
      const newPwd = resetNewInput.value;
      const confirm = resetConfirmInput.value;
      const oobCode = resetCompleteForm.dataset.oobCode;
      const issues = [];
      if (!newPwd) {
        window.formValidate.flagInvalid(resetNewInput);
        issues.push({ field: resetNewInput, msg: "Choisis un nouveau mot de passe" });
      } else if (!window.formValidate.isStrongPassword(newPwd)) {
        window.formValidate.flagInvalid(resetNewInput);
        issues.push({ field: resetNewInput, msg: "Minimum 8 caractères avec au moins 1 chiffre" });
      }
      if (newPwd && confirm !== newPwd) {
        window.formValidate.flagInvalid(resetConfirmInput);
        issues.push({ field: resetConfirmInput, msg: "Les mots de passe ne correspondent pas" });
      }
      if (issues.length > 0) {
        showResetCompleteError(issues.map((i) => i.msg).join(" · ") + ".");
        issues[0].field.focus();
        return;
      }
      resetCompleteSubmit.disabled = true;
      try {
        await window.sync.confirmPasswordReset(oobCode, newPwd);
        /* Clean the URL so a reload doesn't try to re-verify the
         * (now consumed) code, then route back to signin with a
         * one-shot success message. */
        const cleanUrl = window.location.origin + window.location.pathname;
        history.replaceState(null, "", cleanUrl);
        postResetSuccess = true;
        view = "login";
        mode = "signin";
        resetCompleteForm.reset();
        applyMode();
        applyView();
        requestAnimationFrame(() => emailInput.focus());
      } catch (err) {
        showResetCompleteError(err);
      } finally {
        resetCompleteSubmit.disabled = false;
      }
    });

    /* Capture password-reset deep link params at boot, then drop them
     * from the URL so refreshing doesn't re-trigger the flow with a
     * now-consumed code. Firebase action URLs carry `mode` and
     * `oobCode` query params; we only handle `resetPassword` here —
     * other modes (verifyEmail, recoverEmail) aren't enabled yet. */
    (function captureResetLink() {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mode") === "resetPassword" && params.get("oobCode")) {
        pendingResetCode = params.get("oobCode");
        /* Strip the params from the URL but keep them in
         * pendingResetCode for setOverlayVisible to consume. */
        const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
        history.replaceState(null, "", cleanUrl);
      }
    })();

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
