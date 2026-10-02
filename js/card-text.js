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

/* Does the card make YOU draw cards? Read sentence by sentence: a
 * "draw(s) … card(s)" counts unless an opponent draws, it's a restriction
 * ("can't draw"), a replacement ("would draw") or a trigger condition. */
const _DRAW_RE = /\bdraws?\b/gi;
const _OPPONENT_DRAWER = /\b(?:opponents?|its controller|defending player)\b/i;
const _NOT_A_DRAW = /\b(?:can['’]t|cannot|would|don['’]t|doesn['’]t)\s+$/i;
const _CONDITION_START = /^\s*(?:when|whenever|if|as long as)\b/i;

function drawsCards(card) {
  for (const sentence of oracleText(card).split(/[.;\n•]/)) {
    for (const m of sentence.matchAll(_DRAW_RE)) {
      const before = sentence.slice(0, m.index);
      const after = sentence.slice(m.index + m[0].length).split(",")[0];
      if (!/\bcards?\b/i.test(after)) continue;
      if (_NOT_A_DRAW.test(before)) continue;
      if (!/[,:]/.test(before) && _CONDITION_START.test(before)) continue;
      const subject = before.split(/[,:]/).pop();
      if (_OPPONENT_DRAWER.test(subject) && !/\byou\b/i.test(subject)) continue;
      return true;
    }
  }
  return false;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { oracleText, drawsCards };
}
