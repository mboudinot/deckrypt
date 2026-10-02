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

/* A card's type is its front face's: "Instant // Land" is an instant.
 * The back of a modal DFC is only a land the player MAY play instead. */
const _faceTypes = (card) => (card.type_line || "").split(" // ");

function frontTypeLine(card) {
  return _faceTypes(card)[0];
}

function isLandCard(card) {
  return /\bland\b/i.test(frontTypeLine(card));
}

/* Spell // land modal DFC (Sea Gate Restoration): a spell that can be a
 * land drop. Transform backs (Ixalan flip lands) don't count. */
function isMdfcLand(card) {
  return card.layout === "modal_dfc" && !isLandCard(card)
    && _faceTypes(card).slice(1).some((t) => /\bland\b/i.test(t));
}

/* Land drops: lands plus spell // land MDFCs — how deckbuilders count
 * a mana base. */
function isLandDrop(card) {
  return isLandCard(card) || isMdfcLand(card);
}

const _BASIC_TYPES = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
const _COUNT_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3 };

/* What a land-search card fetches: how many lands, to the battlefield
 * (tapped or not) and/or to hand, and which lands qualify. null when
 * the card doesn't search for lands. Memoised per card. */
const _landSearchCache = new WeakMap();
function landSearch(card) {
  if (_landSearchCache.has(card)) return _landSearchCache.get(card);
  const text = oracleText(card);
  const m = text.match(/search your library for (?:up to )?(a|an|one|two|three)\b([^.]*)/i);
  let out = null;
  if (m && /\b(?:lands?|plains|islands?|swamps?|mountains?|forests?)\b/i.test(m[2])) {
    const count = _COUNT_WORDS[m[1].toLowerCase()];
    const basicOnly = /\bbasic\b/i.test(m[2]);
    const types = _BASIC_TYPES.filter((ty) => new RegExp(`\\b${ty}`, "i").test(m[2]));
    const toBattlefield = /onto the battlefield/i.test(text)
      ? (/the other into your hand/i.test(text) ? 1 : count) : 0;
    const toHand = /the other into your hand/i.test(text) ? 1
      : toBattlefield === 0 && /into your hand/i.test(text) ? count : 0;
    out = {
      toBattlefield, toHand,
      tapped: /onto the battlefield tapped/i.test(text),
      matches: (land) => isLandCard(land)
        && (!basicOnly || /\bbasic\b/i.test(land.type_line || ""))
        && (types.length === 0 || types.some((ty) => (land.type_line || "").includes(ty))),
    };
  }
  _landSearchCache.set(card, out);
  return out;
}

/* Ramp = taps for mana without being a land drop, or puts a land onto
 * the battlefield (Cultivate, Wood Elves). Land tutors to hand don't
 * accelerate; an MDFC's mana comes from its land side, not ramp. */
function isRampCard(card) {
  if (isLandDrop(card)) return false;
  if (Array.isArray(card.produced_mana) && card.produced_mana.length > 0) return true;
  return (landSearch(card)?.toBattlefield ?? 0) > 0;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { oracleText, drawsCards, frontTypeLine, isLandCard, isMdfcLand, isLandDrop, landSearch, isRampCard };
}
