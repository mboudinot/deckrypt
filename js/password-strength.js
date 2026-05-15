/* Password strength estimator — non-blocking guidance.
 *
 * Used in two surfaces: the login signup form and the settings
 * password-change form. The score is feedback only; submit always
 * proceeds — the form's own `minlength` is the hard floor, this is
 * the suggestion. Aligned with NIST 800-63B: length-first, no
 * composition rules forced on the user. */

const STRENGTH_LABELS = [
  "Très faible", "Faible", "Moyen", "Fort", "Très fort",
];

/* ~50 most-common passwords likely to be picked. Lowercase for
 * case-insensitive matching. Mix of international leak-list staples
 * + French + app-specific lures. Kept short on purpose — past ~100
 * entries the false-positive risk on legitimate passphrases
 * outweighs the marginal coverage gain. */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "passw0rd",
  "p@ssw0rd", "letmein", "letmein1", "welcome", "welcome1",
  "iloveyou", "admin", "admin123", "administrator", "root", "toor",
  "qwerty", "qwertyui", "qwertyuiop", "asdfghjkl", "zxcvbnm",
  "12345678", "123456789", "1234567890", "0123456789",
  "11111111", "00000000", "12121212", "abcd1234", "abcdefgh",
  "monkey", "dragon", "sunshine", "princess", "football", "baseball",
  "changeme", "default", "master", "shadow", "trustno1",
  "motdepasse", "azerty", "azertyui", "azertyuiop",
  "jetaime", "soleil", "bonjour",
  "deckrypt", "deckrypt123", "magicgathering",
]);

/* Returns { score: 0..4, label, hints[] }.
 * `context` lets the caller penalise passwords that contain the
 * user's email local-part or display name — those are common picks
 * that look strong on paper but fall to a targeted guess. */
function strengthEstimate(pwd, context) {
  const ctx = context || {};
  if (typeof pwd !== "string" || pwd.length === 0) {
    return { score: 0, label: "", hints: [] };
  }

  const hints = [];
  let score = 0;

  const len = pwd.length;
  if (len < 8) {
    hints.push("Trop court : 8 caractères minimum.");
  } else if (len >= 14) score += 3;
  else if (len >= 12) score += 2;
  else if (len >= 10) score += 1;

  const hasLower = /[a-z]/.test(pwd);
  const hasUpper = /[A-Z]/.test(pwd);
  const hasDigit = /\d/.test(pwd);
  const hasSymbol = /[^a-zA-Z0-9]/.test(pwd);
  const variety = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0)
                + (hasDigit ? 1 : 0) + (hasSymbol ? 1 : 0);
  if (len >= 8) score += Math.max(0, variety - 1);

  if (len >= 8 && variety < 2) {
    hints.push("Varie les types : minuscules, majuscules, chiffres, symboles.");
  }

  if (COMMON_PASSWORDS.has(pwd.toLowerCase())) {
    score = 0;
    hints.unshift("Mot de passe trop courant.");
  }

  /* Local-part check requires ≥ 4 chars to avoid false positives on
   * short emails like `ab@example.com` matching any password with
   * "ab" in it. */
  const localPart = ((ctx.email || "").split("@")[0] || "").toLowerCase();
  if (localPart.length >= 4 && pwd.toLowerCase().includes(localPart)) {
    score = Math.min(score, 1);
    hints.push("Évite ton adresse email.");
  }

  const dn = (ctx.displayName || "").toLowerCase().trim();
  if (dn.length >= 4 && pwd.toLowerCase().includes(dn)) {
    score = Math.min(score, 1);
    hints.push("Évite ton pseudo.");
  }

  score = Math.max(0, Math.min(4, score));

  return { score, label: STRENGTH_LABELS[score], hints };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { strengthEstimate, COMMON_PASSWORDS, STRENGTH_LABELS };
}
