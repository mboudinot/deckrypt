/* Tiny helpers shared across the UI layer.
 * Pure functions only — anything DOM-coupled belongs in app.js. */

/* French pluralisation that follows the dominant "+s" rule. Covers
 * the common nouns/adjectives we display (carte, terrain, commandant,
 * permanent, restant, …) without dragging in a full i18n dependency.
 * Doesn't try to handle irregulars like "cheval/chevaux" — none in use. */
function pluralFr(n, word) {
  return `${n} ${word}${n > 1 ? "s" : ""}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { pluralFr };
}
