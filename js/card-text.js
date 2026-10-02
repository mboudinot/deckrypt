/* Multi-face layouts (adventure / omen, MDFC, transform, split) have no
 * top-level `oracle_text` on Scryfall — it lives in `card_faces[]`.
 * Every oracle-text heuristic goes through here so those aren't blanked. */
function oracleText(card) {
  if (!card) return "";
  if (card.oracle_text) return card.oracle_text;
  if (!Array.isArray(card.card_faces)) return "";
  return card.card_faces
    .map((f) => f && f.oracle_text)
    .filter(Boolean)
    .join("\n");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { oracleText };
}
