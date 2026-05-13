/* Synchronous theme bootstrap.
 *
 * Reads the user's last-picked theme from localStorage and sets
 * html[data-direction] BEFORE the stylesheets evaluate, so a user
 * with "editorial" saved doesn't briefly flash the "studio" defaults
 * baked into the markup on page load.
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
})();
