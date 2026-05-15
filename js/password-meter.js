/* Password strength meter — DOM factory.
 *
 * Builds the visible strength widget that hangs below a password
 * input. Scoring is delegated to `strengthEstimate` (in
 * `js/password-strength.js`); this module owns the rendering and
 * the non-blocking disclaimer. The widget hides itself when the
 * input is empty so the form layout doesn't jump for the most
 * common state ("user opened the form, hasn't typed yet").
 *
 * Load order: AFTER `password-strength.js`, BEFORE every consumer
 * (app-login.js, app-settings.js).
 *
 * Usage:
 *   const meter = buildPasswordMeter();
 *   pwdWrap.after(meter.root);
 *   pwdInput.addEventListener("input", () => {
 *     meter.update(pwdInput.value, { email, displayName });
 *   });
 */

function buildPasswordMeter() {
  const root = document.createElement("div");
  root.className = "pwd-meter";
  root.hidden = true;
  root.setAttribute("data-score", "0");
  /* aria-live polite so screen readers announce strength changes,
   * but only when they happen — not on every keystroke. */
  root.setAttribute("aria-live", "polite");

  const bar = document.createElement("div");
  bar.className = "pwd-meter-bar";
  bar.setAttribute("aria-hidden", "true");
  const segments = [];
  for (let i = 0; i < 5; i++) {
    const seg = document.createElement("span");
    seg.className = "pwd-meter-seg";
    bar.appendChild(seg);
    segments.push(seg);
  }

  const label = document.createElement("div");
  label.className = "pwd-meter-label";

  const hintsList = document.createElement("ul");
  hintsList.className = "pwd-meter-hints";
  hintsList.hidden = true;

  /* The non-blocking disclaimer surfaces only when the password is
   * "Très faible" or "Faible" — it'd be patronising on stronger
   * scores. Copy is deliberate: tells the user we don't block them
   * (per the user-requested philosophy), and nudges instead. */
  const note = document.createElement("p");
  note.className = "pwd-meter-note";
  note.textContent = "Mot de passe faible — l'envoi du formulaire n'est pas bloqué, mais on te recommande quelque chose de plus long ou plus varié.";
  note.hidden = true;

  root.append(bar, label, hintsList, note);

  function update(value, context) {
    if (!value) {
      root.hidden = true;
      return;
    }
    const { score, label: lbl, hints } = strengthEstimate(value, context || {});
    root.hidden = false;
    root.setAttribute("data-score", String(score));
    label.textContent = lbl;

    /* Light segments 0..score inclusive (score 0 = one red segment,
     * score 4 = all five). Background colour is driven by the
     * `[data-score]` attribute on the root so a single CSS rule
     * handles all five states. */
    for (let i = 0; i < segments.length; i++) {
      segments[i].classList.toggle("is-on", i <= score);
    }

    if (hints.length > 0) {
      hintsList.replaceChildren();
      for (const h of hints) {
        const li = document.createElement("li");
        li.textContent = h;
        hintsList.appendChild(li);
      }
      hintsList.hidden = false;
    } else {
      hintsList.hidden = true;
    }

    note.hidden = score > 1;
  }

  return { root, update };
}
