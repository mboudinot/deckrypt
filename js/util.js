/* Tiny helpers shared across the UI layer.
 * Pure functions only — anything DOM-coupled belongs in app.js. */

/* French pluralisation that follows the dominant "+s" rule. Covers
 * the common nouns/adjectives we display (carte, terrain, commandant,
 * permanent, restant, …) without dragging in a full i18n dependency.
 * Doesn't try to handle irregulars like "cheval/chevaux" — none in use. */
function pluralFr(n, word) {
  return `${n} ${word}${n > 1 ? "s" : ""}`;
}

/* Deck-picker order: by colour count (colourless first), then name.
 * Unknown colours (`colorsById` → null) next, format-libre decks last. */
function sortDecksByColors(decks, colorsById) {
  const rank = (d) => {
    if (d.format === "limited") return 7;
    const colors = colorsById.get(d.id);
    return colors ? colors.length : 6;
  };
  return [...decks].sort((a, b) =>
    rank(a) - rank(b) || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { pluralFr, sortDecksByColors };
}
