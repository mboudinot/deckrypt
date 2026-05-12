/* Heuristic deck-improvement suggestions over a resolved deck.
 *
 * The targets come from EDH community wisdom (EDHRec, CMDR Decks
 * etc.): a "balanced" Commander deck typically runs 35–40 lands,
 * 8–12 ramp pieces and 8–12 card-draw spells. They aren't laws — a
 * combo deck willingly skips ramp, a creature-flood deck skips
 * dedicated draw — so the panel reads as advice, not an audit.
 *
 * Detection is text-based and best-effort: there's no flag on
 * Scryfall cards that says "this is ramp", so we look at structural
 * fields (`produced_mana`, `type_line`) and `oracle_text` patterns.
 */

const COMMANDER_TARGETS = {
  lands:       { min: 35,  max: 40,  ideal: "35–40"   },
  ramp:        { min: 8,   max: 12,  ideal: "8–12"    },
  draw:        { min: 8,   max: 12,  ideal: "8–12"    },
  interaction: { min: 8,   max: 14,  ideal: "8–14"    },
  wipes:       { min: 2,   max: 5,   ideal: "2–5"     },
  avgCmc:      { min: 2.5, max: 3.5, ideal: "2.5–3.5" },
};

/* Basic land names (English + Snow-Covered). Used by the singleton
 * check — basics are the one exception to "no duplicates" in EDH. */
const BASIC_LAND_NAMES = new Set([
  "Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes",
  "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp",
  "Snow-Covered Mountain", "Snow-Covered Forest", "Snow-Covered Wastes",
]);

function _isLand(card) {
  const tl = (card.type_line || "").toLowerCase();
  return tl.includes("land");
}

function isCommanderFormat(fullDeck) {
  const n = fullDeck.length;
  return n >= 90 && n <= 110;
}

/* Resolve a deck's format. Priority:
 *   1. Explicit `def.format` on the resolved deck (set by the Manage
 *      view's format selector).
 *   2. Size-based fallback for decks that predate the `format` field
 *      — 90–110 cards is read as Commander, 40–70 as limited.
 * Returns "commander" | "limited" | "unknown". */
function deckFormatOf(resolved) {
  if (!resolved) return "unknown";
  const explicit = resolved.def && resolved.def.format;
  if (explicit === "commander" || explicit === "limited") return explicit;
  const total = (resolved.commanders?.length || 0) + (resolved.deck?.length || 0);
  if (total >= 90 && total <= 110) return "commander";
  if (total >= 40 && total <= 70) return "limited";
  return "unknown";
}


function countLands(cards) {
  let n = 0;
  for (const c of cards) if (_isLand(c)) n++;
  return n;
}

/* "Ramp" = anything that nets you mana faster than a basic land drop:
 *   - non-land permanents producing mana (Sol Ring, Signet, Llanowar
 *     Elves, mana dorks…)
 *   - sorceries / instants that fetch a land to the battlefield
 *     (Cultivate, Rampant Growth, Three Visits, Farseek…)
 * The oracle-text regex is permissive on purpose — better to include
 * the occasional false positive than miss obvious ramp pieces. */
function isRampCard(card) {
  if (_isLand(card)) return false;
  if (Array.isArray(card.produced_mana) && card.produced_mana.length > 0) return true;
  const text = card.oracle_text || "";
  if (/search your library[^.]*\bland\b/i.test(text)) return true;
  // "Forest or Plains" / "two basic land cards" style — covers Three
  // Visits, Nature's Lore, etc. without requiring "basic" verbatim.
  if (/search your library[^.]*\b(forest|island|swamp|mountain|plains)\b/i.test(text)) {
    return true;
  }
  return false;
}

function countRamp(cards) {
  let n = 0;
  for (const c of cards) if (isRampCard(c)) n++;
  return n;
}

/* A card draws if its oracle text says so. Catches:
 *   "draw a card", "draws a card",
 *   "draw two cards", "draw three cards",
 *   "draws cards equal to …",
 *   "Investigate" → not (specific keyword)
 * False positives include "discard X, draw Y" cycling effects, which
 * is fine — they ARE a form of card filtering. */
function isDrawCard(card) {
  if (_isLand(card)) return false;
  const text = card.oracle_text || "";
  if (!text) return false;
  if (/\bdraws? a card\b/i.test(text)) return true;
  if (/\bdraws? \w+ cards?\b/i.test(text)) return true;
  return false;
}

function countDraw(cards) {
  let n = 0;
  for (const c of cards) if (isDrawCard(c)) n++;
  return n;
}

/* Mass removal: "destroy/exile all creatures/permanents/nonland" or
 * a mass -X/-X. Counted separately from single-target interaction so
 * the user sees both numbers (a deck can be heavy on board wipes but
 * light on targeted answers). */
function isBoardWipe(card) {
  if (_isLand(card)) return false;
  const t = card.oracle_text || "";
  if (/destroy all (creatures?|permanents?|nonland)/i.test(t)) return true;
  if (/exile all (creatures?|permanents?|nonland)/i.test(t)) return true;
  if (/destroy each (creature|permanent)/i.test(t)) return true;
  if (/exile each (creature|permanent)/i.test(t)) return true;
  if (/all (creatures?|permanents?) get -\d+\/-\d+/i.test(t)) return true;
  return false;
}

/* Single-target interaction: removal, counterspells, bounce. We
 * intentionally exclude board wipes (they have their own counter)
 * and "tap target" (rarely a real answer). */
function isInteractionCard(card) {
  if (_isLand(card)) return false;
  if (isBoardWipe(card)) return false;
  const t = card.oracle_text || "";
  if (/destroy target/i.test(t)) return true;
  if (/exile target/i.test(t)) return true;
  if (/counter target/i.test(t)) return true;
  if (/return target.*to (its|their) owner['’]s hand/i.test(t)) return true;
  return false;
}

function countBoardWipes(cards) {
  let n = 0;
  for (const c of cards) if (isBoardWipe(c)) n++;
  return n;
}

function countInteraction(cards) {
  let n = 0;
  for (const c of cards) if (isInteractionCard(c)) n++;
  return n;
}

/* Average CMC across non-land cards. Lands are excluded because they
 * pull the average toward 0 and obscure the actual curve weight of
 * the playable spells. */
function averageCmcOfSpells(cards) {
  let sum = 0, n = 0;
  for (const c of cards) {
    if (_isLand(c)) continue;
    if (typeof c.cmc === "number") {
      sum += c.cmc;
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/* Singleton rule (Commander format): every non-basic card must
 * appear at most once. Returns an array of { name, qty } violations. */
function singletonViolations(deck) {
  const counts = new Map();
  for (const c of deck) {
    if (BASIC_LAND_NAMES.has(c.name)) continue;
    counts.set(c.name, (counts.get(c.name) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([_, n]) => n > 1)
    .map(([name, qty]) => ({ name, qty }));
}

/* Color-identity rule (Commander format): each card's color_identity
 * must be a subset of the union of the commanders' identities.
 * Returns an array of card names that violate. */
function colorIdentityIssues(resolved) {
  if (!resolved || !resolved.commanders.length) return [];
  const allowed = new Set();
  for (const cmd of resolved.commanders) {
    if (Array.isArray(cmd.color_identity)) {
      for (const c of cmd.color_identity) allowed.add(c);
    }
  }
  const offColor = new Set();
  for (const c of resolved.deck) {
    if (!Array.isArray(c.color_identity)) continue;
    for (const color of c.color_identity) {
      if (!allowed.has(color)) {
        offColor.add(c.name);
        break;
      }
    }
  }
  return [...offColor];
}

/* Commander legality: returns the names of cards whose
 * `legalities.commander` is `banned` or `not_legal`. Splits the two
 * since a banned card is a different stigma than a not-legal one
 * (banned cards were once legal — the player may have a stale list).
 * Cards without a `legalities` field (test fixtures, partial data)
 * are treated as legal — defensive default. */
function commanderLegalityIssues(fullDeck) {
  const banned = [];
  const notLegal = [];
  const seen = new Set();
  for (const c of fullDeck) {
    if (!c || !c.name || seen.has(c.name)) continue;
    seen.add(c.name);
    const status = c.legalities && c.legalities.commander;
    if (status === "banned") banned.push(c.name);
    else if (status === "not_legal") notLegal.push(c.name);
  }
  return { banned, notLegal };
}

/* Commander zone validity: each card in the commanders slot must be
 *   - Legendary Creature, OR
 *   - Legendary Planeswalker with "can be your commander" oracle text, OR
 *   - Legendary Background enchantment (Baldur's Gate Choose-a-Bg).
 * Returns the names of commanders that don't qualify. */
function invalidCommanders(resolved) {
  if (!resolved) return [];
  const out = [];
  for (const c of resolved.commanders || []) {
    const t = (c.type_line || "").toLowerCase();
    const isLegendary = t.includes("legendary");
    const isCreature = t.includes("creature");
    const isPlaneswalker = t.includes("planeswalker");
    const isBackground = t.includes("background");
    const hasCommanderClause = /can be your commander/i.test(c.oracle_text || "");
    if (isLegendary && (isCreature
      || (isPlaneswalker && hasCommanderClause)
      || isBackground)) {
      continue;
    }
    out.push(c.name);
  }
  return out;
}

function _assess(current, target) {
  if (current < target.min) return "low";
  if (current > target.max) return "high";
  return "ok";
}

function _build(key, label, current, target, advice) {
  if (!target) {
    return {
      key, label, current,
      target: null,
      status: "info",
      advice: "Format non-Commander — cibles variables, à toi de juger.",
    };
  }
  const status = _assess(current, target);
  return { key, label, current, target: target.ideal, status, advice: advice[status] };
}

/* Public entry point. Returns an array of suggestion objects:
 *   { key, label, current, target, status: "ok"|"low"|"high"|"info", advice } */
function suggestions(resolved) {
  if (!resolved) return [];
  const cards = [...(resolved.commanders || []), ...(resolved.deck || [])];
  if (cards.length === 0) return [];

  // Trust the explicit format on the deck definition if set; fall
  // back to the size heuristic for legacy decks.
  const isEdh = deckFormatOf(resolved) === "commander";
  const out = [];

  out.push(_build("lands", "Terrains", countLands(cards),
    isEdh ? COMMANDER_TARGETS.lands : null,
    {
      low:  "Trop peu — vise 35–40 pour stabiliser tes drops.",
      high: "Beaucoup de terrains ; 35–40 suffit en EDH classique.",
      ok:   "Bon ratio pour un deck Commander.",
    }));

  out.push(_build("ramp", "Accélération de mana", countRamp(cards),
    isEdh ? COMMANDER_TARGETS.ramp : null,
    {
      low:  "Pas assez de ramp (mana rocks, mana dorks, land tutors). Vise 8–12.",
      high: "Beaucoup de ramp ; tu peux le diluer en interaction ou en pioche.",
      ok:   "Ramp dans la fourchette EDH habituelle.",
    }));

  out.push(_build("draw", "Pioche", countDraw(cards),
    isEdh ? COMMANDER_TARGETS.draw : null,
    {
      low:  "Peu de pioche détectée — un EDH a besoin de 8–12 sources de cartes.",
      high: "Beaucoup de pioche, c'est rarement un défaut.",
      ok:   "Pioche dans la fourchette.",
    }));

  out.push(_build("interaction", "Interaction ciblée", countInteraction(cards),
    isEdh ? COMMANDER_TARGETS.interaction : null,
    {
      low:  "Peu de removal / contre-sorts. Vise 8–14 réponses ponctuelles.",
      high: "Beaucoup d'interaction — assure-toi d'avoir aussi des conditions de victoire.",
      ok:   "Bon volume d'interaction ciblée.",
    }));

  out.push(_build("wipes", "Board wipes", countBoardWipes(cards),
    isEdh ? COMMANDER_TARGETS.wipes : null,
    {
      low:  "Aucun reset board — ajoute 2–4 wraths pour les situations désespérées.",
      high: "Beaucoup de wipes ; risque de casser ta propre board sans win con derrière.",
      ok:   "Volume de wraths confortable.",
    }));

  // Average CMC only makes sense if there's a non-trivial number of
  // spells — a 5-card "Test deck" would report nonsense.
  const nonLandCount = cards.filter((c) => !_isLand(c)).length;
  if (isEdh && nonLandCount >= 20) {
    const avg = Math.round(averageCmcOfSpells(cards) * 100) / 100;
    out.push(_build("avg-cmc", "CMC moyenne du deck", avg,
      COMMANDER_TARGETS.avgCmc,
      {
        low:  "Courbe très basse — vérifie que tu as de quoi tenir en fin de partie.",
        high: "Courbe lourde — risque de manquer de tempo. Plus de ramp ou allège.",
        ok:   "Courbe équilibrée pour EDH.",
      }));
  }

  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    COMMANDER_TARGETS, BASIC_LAND_NAMES,
    isCommanderFormat, deckFormatOf,
    countLands, countRamp, countDraw,
    countInteraction, countBoardWipes, averageCmcOfSpells,
    isRampCard, isDrawCard, isInteractionCard, isBoardWipe,
    singletonViolations, colorIdentityIssues,
    commanderLegalityIssues, invalidCommanders,
    suggestions,
  };
}
