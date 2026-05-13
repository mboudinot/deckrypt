/* Form validation primitives shared across every form in the app.
 *
 * Scope: per-field visual + a11y state. Aggregate messages
 * (which field failed, what to say) stay in each form's controller
 * because the message surface differs by form -- login has a
 * dedicated error box, import uses setStatus, paste-add uses flash.
 *
 * Set the invalid state with `flagInvalid`, clear it with
 * `clearInvalid`. Both touch the .is-invalid class (CSS hook) AND
 * the aria-invalid attribute (screen-reader hook) -- never set one
 * without the other.
 *
 * `attachAutoClear` is the everyday wiring: once a field is flagged,
 * it should self-clear the moment the user engages with it -- no
 * reason to keep the red border around once they're typing in the
 * field. Idempotent so callers can re-wire on re-init without
 * accumulating listeners.
 */

function flagInvalid(input) {
  if (!input) return;
  input.classList.add("is-invalid");
  input.setAttribute("aria-invalid", "true");
}

function clearInvalid(input) {
  if (!input) return;
  input.classList.remove("is-invalid");
  input.removeAttribute("aria-invalid");
}

/* Returns true if the input has a meaningful value. Centralises the
 * type-dispatch so each caller doesn't reinvent "what counts as empty"
 * for numbers, checkboxes, etc. */
function isFilled(input) {
  if (!input) return false;
  if (input.type === "checkbox" || input.type === "radio") return input.checked;
  if (input.type === "number") {
    const n = input.valueAsNumber;
    return input.value !== "" && Number.isFinite(n);
  }
  return String(input.value || "").trim().length > 0;
}

/* Email shape check — `local@host.tld` with a 2+ char TLD. Tight
 * enough to catch obvious typos (missing @, no dot, "user@gmail"),
 * loose enough not to reject valid addresses with unicode in the
 * local-part or unusual TLDs. Real validation still happens
 * server-side (Firebase returns auth/invalid-email anyway) — this
 * is purely about saving the user a useless round-trip. */
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());
}

/* Strong-enough password rule for signup. We're not trying to enforce
 * heavy entropy here -- 8 chars + at least one digit catches the
 * "password" / "abcdefgh" class of obviously weak picks while still
 * being friendly to memorable passphrases. Firebase will additionally
 * reject anything Auth considers weak (`auth/weak-password`). The hint
 * shown under the password field on signup mirrors this rule. */
function isStrongPassword(pwd) {
  const s = String(pwd || "");
  return s.length >= 8 && /\d/.test(s);
}

function attachAutoClear(input) {
  if (!input) return;
  /* Guard against double-wiring -- the manage view, for instance,
   * re-renders on every deck change, but the input element itself
   * persists, so we don't want N listeners stacking up. */
  if (input.dataset.fvAutoClear === "1") return;
  input.dataset.fvAutoClear = "1";
  const handler = () => clearInvalid(input);
  input.addEventListener("input", handler);
  input.addEventListener("change", handler);
}

if (typeof window !== "undefined") {
  window.formValidate = { flagInvalid, clearInvalid, isFilled, isValidEmail, isStrongPassword, attachAutoClear };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { flagInvalid, clearInvalid, isFilled, isValidEmail, isStrongPassword, attachAutoClear };
}
