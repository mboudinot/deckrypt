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

// Browser: global from card-text.js. Node (vitest): no shared scope.
if (typeof oracleText === "undefined" && typeof require === "function") {
  globalThis.oracleText = require("./card-text.js").oracleText;
}

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
  const text = oracleText(card);
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
  const text = oracleText(card);
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

/* Mass removal, counted apart from targeted interaction. Scope is
 * creatures / permanents / nonland: artifact- or enchantment-only
 * sweepers are hate pieces, not resets. Pings (1 damage, -X/-1) excluded. */
const _MASS_SUBJECT =
  String.raw`(?:all|each)\s+(?:[\w-]+\s+){0,2}?(?:creatures?|permanents?|nonland)(?!\s+(?:permanent\s+)?cards?)`;
const _LETHAL_N = String.raw`(?:X|[2-9]|\d{2,})`;
const _BOARD_WIPE_PATTERNS = [
  new RegExp(String.raw`\b(?:destroy|exile)\s+${_MASS_SUBJECT}`, "i"),
  new RegExp(String.raw`\b${_MASS_SUBJECT}[^.]*?\bgets?\s+-(?:\d+|X)\/-${_LETHAL_N}\b`, "i"),
  new RegExp(String.raw`\bcreatures your opponents control get -(?:\d+|X)\/-${_LETHAL_N}\b`, "i"),
  new RegExp(String.raw`\bdeals ${_LETHAL_N} damage to each (?:other )?(?:[\w-]+ )?creature`, "i"),
  /\bdeals damage equal to [^.]*? to each (?:other )?(?:[\w-]+ )?creature/i,
  new RegExp(String.raw`\breturn\s+${_MASS_SUBJECT}[^.]*?\bto\s+(?:its|their)\s+owner(?:['’]s|s['’])\s+hands?`, "i"),
  /\beach (?:player|opponent) sacrifices all (?:creatures|permanents|nonland)/i,
];
const _OVERLOAD_REMOVAL = new RegExp(String.raw`\b(?:destroy|exile|return) target (?:creature|nonland permanent|permanent)|\bdeals ${_LETHAL_N} damage to target creature`, "i");

function isBoardWipe(card) {
  if (_isLand(card)) return false;
  const t = oracleText(card);
  if (!t) return false;
  if (_BOARD_WIPE_PATTERNS.some((re) => re.test(t))) return true;
  if (/\bOverload\b/.test(t) && _OVERLOAD_REMOVAL.test(t)) return true;
  return false;
}

/* Single-target interaction, board wipes excluded (own counter). Each
 * pattern captures what follows "target" so blink / self-bounce ("…you
 * control") and graveyard hate ("target card") can be rejected. */
const _TARGET = String.raw`(?:up to (?:one|two|three|X) )?(?:other |another )?target`;
const _TARGETED_INTERACTION_PATTERNS = [
  new RegExp(String.raw`\b(?:destroy|exile|counter) ${_TARGET} ([^.;,\n]*)`, "gi"),
  new RegExp(String.raw`\breturn ${_TARGET} ([^.;,\n]*?) to (?:its|their) owner(?:['’]s|s['’]) hands?`, "gi"),
  new RegExp(String.raw`\bput ${_TARGET} ([^.;,\n]*?) on (?:the )?(?:top|bottom) of its owner['’]s library`, "gi"),
  new RegExp(String.raw`\bowner of ${_TARGET} ([^.;,\n]*?) shuffles it into`, "gi"),
  new RegExp(String.raw`\bdeals ${_LETHAL_N} damage to (?:any target()|${_TARGET} ([^.;,\n]*))`, "gi"),
  new RegExp(String.raw`\bdamage equal to [^.]*? to (?:any target()|${_TARGET} ([^.;,\n]*))`, "gi"),
  new RegExp(String.raw`\bfights? ${_TARGET} ([^.;,\n]*)`, "gi"),
  new RegExp(String.raw`\b${_TARGET} ([^.;,\n]*?)\bgets? -(?:\d+|X)\/-${_LETHAL_N}\b`, "gi"),
];
const _NOT_AN_ANSWER = /\byou control\b|\bcards?\b|\bgraveyard\b/i;
const _EDICT =
  /\b(?:target (?:player|opponent)|each opponent|each player) sacrifices (?:a|an|one|two|three|X) (?:[\w-]+ )?(?:creature|permanent|planeswalker|artifact|enchantment)/i;
const _CONTROL_STEAL = /\bgain control of target (?![^.]*until end of turn)|\byou control enchanted (?:creature|permanent|artifact|planeswalker)/i;

function isInteractionCard(card) {
  if (_isLand(card)) return false;
  if (isBoardWipe(card)) return false;
  const t = oracleText(card);
  if (!t) return false;
  if (_EDICT.test(t) || _CONTROL_STEAL.test(t)) return true;
  return _TARGETED_INTERACTION_PATTERNS.some((re) => {
    for (const m of t.matchAll(re)) {
      const object = m.slice(1).find((g) => g !== undefined) ?? "";
      if (!_NOT_AN_ANSWER.test(object)) return true;
    }
    return false;
  });
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
    const hasCommanderClause = /can be your commander/i.test(oracleText(c));
    if (isLegendary && (isCreature
      || (isPlaneswalker && hasCommanderClause)
      || isBackground)) {
      continue;
    }
    out.push(c.name);
  }
  return out;
}

/* Commander conformity, one { key, label, severity: ok|warning|error,
 * detail } per rule in a stable order. Shared by the analyze legality
 * panel (every row) and the manage alert (failing rows only). */
function commanderRuleChecks(resolved) {
  const pl = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
  const list = (names) => `${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}`;
  const rules = [];
  const commanders = resolved.commanders || [];
  const deck = resolved.deck || [];
  const cmdN = commanders.length;
  const deckN = deck.length;
  const total = cmdN + deckN;

  // 1. Card count: commander(s) + rest of the deck = 100.
  if (total === 100) {
    rules.push({ key: "count", label: "Compte de cartes", severity: "ok",
      detail: `${total} cartes (${pl(cmdN, "commandant")} + ${deckN}).` });
  } else {
    const diff = total - 100;
    rules.push({ key: "count", label: "Compte de cartes", severity: "error",
      detail: diff > 0
        ? `${total} cartes — ${diff} en trop (cible 100).`
        : `${total} cartes — ${-diff} manquante${-diff > 1 ? "s" : ""} (cible 100).` });
  }

  // 2. Commander zone: at least one, each one eligible.
  const badCmds = invalidCommanders(resolved);
  if (cmdN === 0) {
    rules.push({ key: "commander", label: "Commander valide", severity: "error",
      detail: "Aucun commandant déclaré." });
  } else if (badCmds.length === 0) {
    rules.push({ key: "commander", label: "Commander valide", severity: "ok",
      detail: `${pl(cmdN, "commandant")} légendaire${cmdN > 1 ? "s" : ""}.` });
  } else {
    rules.push({ key: "commander", label: "Commander valide", severity: "error",
      detail: `${pl(badCmds.length, "carte")} ne peut pas servir de commandant : ${badCmds.join(", ")}.` });
  }

  // 3. Format legality (banned / not legal, from Scryfall legalities).
  const { banned, notLegal } = commanderLegalityIssues([...commanders, ...deck]);
  if (banned.length === 0 && notLegal.length === 0) {
    rules.push({ key: "legality", label: "Légalité en Commander", severity: "ok",
      detail: "Toutes les cartes sont légales." });
  } else {
    const parts = [];
    if (banned.length > 0) {
      parts.push(`${pl(banned.length, "carte")} bannie${banned.length > 1 ? "s" : ""} : ${list(banned)}`);
    }
    if (notLegal.length > 0) {
      parts.push(`${pl(notLegal.length, "non-légale")} : ${list(notLegal)}`);
    }
    rules.push({ key: "legality", label: "Légalité en Commander", severity: "error",
      detail: parts.join(" · ") });
  }

  // 4. Color identity: every card within the commanders' identity.
  const offColor = colorIdentityIssues(resolved);
  if (offColor.length === 0) {
    rules.push({ key: "identity", label: "Identité de couleur", severity: "ok",
      detail: "Toutes les cartes respectent l'identité du commandant." });
  } else {
    rules.push({ key: "identity", label: "Identité de couleur", severity: "error",
      detail: `${pl(offColor.length, "carte")} hors identité : ${list(offColor)}` });
  }

  // 5. Singleton (basic lands exempt).
  const dups = singletonViolations(deck);
  if (dups.length === 0) {
    rules.push({ key: "singleton", label: "Singleton", severity: "ok",
      detail: "Aucune carte non-basique en double." });
  } else {
    const txt = dups.slice(0, 5).map((d) => `${d.name} ×${d.qty}`).join(", ");
    rules.push({ key: "singleton", label: "Singleton", severity: "warning",
      detail: `${pl(dups.length, "carte non-basique")} en double : ${txt}${dups.length > 5 ? "…" : ""}` });
  }

  return rules;
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
    commanderLegalityIssues, invalidCommanders, commanderRuleChecks,
    suggestions,
  };
}
