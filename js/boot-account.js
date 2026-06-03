/* Synchronous pre-paint prim of the account button.
 *
 * Reads the account snapshot (written by sync.js on every auth
 * transition + on displayName change) and renders the authed shape —
 * avatar with initial + display name + chevron — before the browser
 * paints. Without this the pill paints in a fixed-width skeleton
 * (`.has-session-hint .account.account-anon`) and JS later swaps in
 * the real content; for short names like "Cyntaël" that left ~60px
 * of empty whitespace inside the pill, and removing the fixed width
 * would just trade the wasted space for a width-jump flash on F5.
 * Cached priming sizes the pill to its actual content from frame 1.
 *
 * Placement: NON-DEFER <script src> in the body, immediately after
 * the #btn-account element so the DOM node exists when we run AND
 * the browser hasn't painted yet (parsing still incomplete past this
 * point). CSP forbids inline scripts, hence a dedicated file.
 *
 * Fallback when no snapshot is cached (first-time signin, cleared
 * cache): the markup default (`.account-anon` with "Connexion" text)
 * is shown; the existing `.has-session-hint` skeleton still applies
 * if the session hint is set; refreshAccountButton overwrites once
 * Firebase resolves. A single content-width jump on first-ever auth
 * is accepted — it never happens again on subsequent reloads. */
(function () {
  let snapshot = null;
  try {
    const raw = localStorage.getItem("mtg-hand-sim:account-snapshot-v1");
    if (raw) snapshot = JSON.parse(raw);
  } catch (e) { /* localStorage blocked or stale JSON — fall through */ }
  if (!snapshot || !snapshot.name) return;
  const btn = document.getElementById("btn-account");
  if (!btn) return;

  btn.classList.remove("account-anon");
  btn.classList.add("account-authed");
  btn.replaceChildren();

  const avatar = document.createElement("span");
  avatar.className = "account-avatar";
  avatar.textContent = snapshot.initial || "?";

  const name = document.createElement("span");
  name.className = "account-name";
  name.id = "account-label";
  name.textContent = snapshot.name;

  /* SVG built via createElementNS rather than innerHTML — keeps the
   * project's "zero innerHTML" invariant intact (security audit
   * §XSS, May 2026). Same visual as refreshAccountButton's chevron. */
  const chev = document.createElement("span");
  chev.className = "account-chev";
  chev.setAttribute("aria-hidden", "true");
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "11");
  svg.setAttribute("height", "11");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const polyline = document.createElementNS(svgNS, "polyline");
  polyline.setAttribute("points", "6 9 12 15 18 9");
  svg.appendChild(polyline);
  chev.appendChild(svg);

  btn.appendChild(avatar);
  btn.appendChild(name);
  btn.appendChild(chev);
})();
