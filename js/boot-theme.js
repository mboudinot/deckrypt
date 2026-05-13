/* Synchronous boot bootstrap — runs BEFORE the stylesheets evaluate
 * and BEFORE the <body> parses, so we can land two visual decisions
 * without any flash:
 *
 *  1. Theme direction (studio / editorial) — without this the user
 *     would briefly see the wrong palette on every load.
 *  2. Auth gate (html.auth-locked) — without this, an already-signed-
 *     in user would briefly see the login overlay until Firebase
 *     Auth's async persistence layer resolves (50–200ms). We bet on
 *     a localStorage hint: if `has-session-v1` is set, the user is
 *     probably still signed in — show the app shell optimistically.
 *     The auth subscriber re-locks if Firebase later disagrees.
 *
 * Must load via a non-defer <script> in <head> ABOVE the <link>
 * stylesheets. Inline scripts are blocked by the CSP, hence this
 * tiny standalone file. */
(function () {
  try {
    const saved = localStorage.getItem("deckrypt-direction");
    if (saved === "studio" || saved === "editorial") {
      document.documentElement.setAttribute("data-direction", saved);
    }
  } catch (e) {
    /* localStorage disabled (private mode, blocked) — fall through
     * to the markup's hardcoded default (studio). */
  }

  /* Default to locked. The hint is set by sync.js when Firebase Auth
   * confirms a user, and cleared on signOut + on any null transition.
   * No hint = no recent session = show the overlay immediately. */
  let hasSession = false;
  try {
    hasSession = localStorage.getItem("mtg-hand-sim:has-session-v1") === "1";
  } catch (e) { /* fall through to locked */ }
  if (!hasSession) {
    document.documentElement.classList.add("auth-locked");
  }
})();
