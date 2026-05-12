/* Deck archetype detection — best-effort classification of the deck's
 * overall strategy ("orientation"), built from structural signals
 * over the resolved cards.
 *
 * Each archetype defines a `score(signals)` function that adds points
 * for matching characteristics. The ratio `score / max` becomes the
 * archetype's confidence. The render layer keeps the top entries
 * above a threshold (typically 35–40 %).
 *
 * This is a heuristic, not an oracle: a deck mixing several plans
 * naturally lands on a "Profil mixte" with two or three near-tied
 * archetypes — and that's an honest answer.
 */

function _isLand(card) {
  return /\bland\b/i.test(card.type_line || "");
}

function _isCreature(card) {
  return /\bcreature\b/i.test(card.type_line || "");
}

function _isAura(card) {
  return /\baura\b/i.test(card.type_line || "");
}

function _isEquipment(card) {
  return /\bequipment\b/i.test(card.type_line || "");
}

function _countByOracle(cards, regex) {
  let n = 0;
  for (const c of cards) if (c.oracle_text && regex.test(c.oracle_text)) n++;
  return n;
}

function _averageCmc(cards) {
  let sum = 0, n = 0;
  for (const c of cards) {
    if (_isLand(c)) continue;
    if (typeof c.cmc === "number") { sum += c.cmc; n++; }
  }
  return n === 0 ? 0 : sum / n;
}

function _averagePower(creatures) {
  let sum = 0, n = 0;
  for (const c of creatures) {
    const p = parseInt(c.power, 10);
    if (Number.isFinite(p)) { sum += p; n++; }
  }
  return n === 0 ? 0 : sum / n;
}

function _bigCreaturesCount(creatures) {
  let n = 0;
  for (const c of creatures) {
    const p = parseInt(c.power, 10);
    const t = parseInt(c.toughness, 10);
    if (Number.isFinite(p) && Number.isFinite(t) && p + t >= 10) n++;
  }
  return n;
}

/* Extract every signal we use for archetype scoring in one O(N) pass.
 * Centralised so each archetype rule reads structured data, not raw
 * card arrays — keeps the rules readable. */
function archetypeSignals(deck) {
  const nonLands = deck.filter((c) => !_isLand(c));
  const creatures = deck.filter(_isCreature);
  const auras = deck.filter(_isAura);
  const equipment = deck.filter(_isEquipment);

  return {
    nonLandCount: nonLands.length,
    creatureCount: creatures.length,
    creatureRatio: nonLands.length === 0 ? 0 : creatures.length / nonLands.length,
    avgCmc: _averageCmc(deck),
    avgCreaturePower: _averagePower(creatures),
    bigCreatures: _bigCreaturesCount(creatures),

    auraCount: auras.length,
    equipmentCount: equipment.length,
    voltronPieces: auras.length + equipment.length,

    counterspells: _countByOracle(deck, /counter target (spell|ability)/i),
    removal: _countByOracle(deck, /(destroy|exile) target/i),
    boardWipes: _countByOracle(deck, /(destroy|exile) all (creatures?|permanents?|nonland)/i),
    bounce: _countByOracle(deck, /return target.*to (its|their) owner['’]s hand/i),
    cardDraw: _countByOracle(deck, /\bdraws? (a|\w+) cards?\b/i),
    ramp: _countByOracle(deck, /search your library[^.]*\bland\b/i)
        + nonLands.filter((c) => Array.isArray(c.produced_mana) && c.produced_mana.length > 0).length,

    // Tutors that are NOT land tutors (a "for a card" / "for a <type> card" pattern).
    tutors: _countByOracle(deck, /search your library for a(n)?\s+(creature|instant|sorcery|enchantment|artifact|planeswalker|card)\b/i),

    sacrificeOutlets: _countByOracle(deck, /\bsacrifice (a|an|another)\s+(creature|permanent|artifact)\b/i),
    reanimation: _countByOracle(deck, /return.*from.*graveyard.*to (the )?battlefield/i),
    discard: _countByOracle(deck, /\bdiscard (a|your hand|two|three)\b/i),
    tokens: _countByOracle(deck, /\bcreate [^.]{0,40}\btokens?\b/i),
    plus1Counters: _countByOracle(deck, /\+1\/\+1 counter/i),
    evasion: _countByOracle(deck, /\b(can[’']t be blocked|flying|menace|skulk|shadow|trample)\b/i),
    spellsMatter: _countByOracle(deck, /whenever you cast (an? )?(instant|sorcery)/i),
  };
}

/* Each archetype carries a max score (sum of all bonuses it could
 * award). Confidence = score / max, clamped to [0, 1]. */
const ARCHETYPE_RULES = [
  {
    key: "aggro", label: "Aggro / Tempo",
    score: (s) => {
      let p = 0;
      if (s.avgCmc < 2.5) p += 3;
      if (s.avgCmc < 2.0) p += 1;
      if (s.creatureRatio > 0.4) p += 2;
      if (s.evasion >= 8) p += 2;
      if (s.avgCreaturePower > 0 && s.avgCreaturePower <= 2.5) p += 1;
      if (s.boardWipes <= 1) p += 1;
      return p;
    },
    max: 10,
  },
  {
    key: "control", label: "Contrôle",
    score: (s) => {
      let p = 0;
      if (s.counterspells >= 5) p += 3;
      if (s.removal >= 8) p += 2;
      if (s.boardWipes >= 3) p += 2;
      if (s.cardDraw >= 10) p += 2;
      if (s.creatureCount < 18) p += 1;
      return p;
    },
    max: 10,
  },
  {
    key: "combo", label: "Combo",
    score: (s) => {
      let p = 0;
      if (s.tutors >= 5) p += 4;
      if (s.tutors >= 8) p += 2;
      if (s.cardDraw >= 12) p += 2;
      if (s.creatureCount < 18) p += 1;
      if (s.ramp >= 12) p += 1;
      return p;
    },
    max: 10,
  },
  {
    key: "midrange", label: "Midrange",
    score: (s) => {
      let p = 0;
      if (s.avgCmc >= 2.5 && s.avgCmc <= 3.5) p += 2;
      if (s.creatureCount >= 20 && s.creatureCount <= 30) p += 2;
      if (s.removal >= 6 && s.removal <= 12) p += 1;
      if (s.ramp >= 8 && s.ramp <= 14) p += 1;
      if (s.cardDraw >= 6 && s.cardDraw <= 12) p += 1;
      return p;
    },
    max: 7,
  },
  {
    key: "voltron", label: "Voltron",
    score: (s) => {
      let p = 0;
      if (s.voltronPieces >= 10) p += 4;
      if (s.voltronPieces >= 15) p += 2;
      if (s.creatureCount < 20) p += 2;
      if (s.evasion >= 6) p += 1;
      return p;
    },
    max: 9,
  },
  {
    key: "aristocrats", label: "Aristocrats",
    score: (s) => {
      let p = 0;
      if (s.sacrificeOutlets >= 3) p += 3;
      if (s.tokens >= 5) p += 2;
      if (s.reanimation >= 3) p += 2;
      if (s.creatureCount >= 20) p += 1;
      return p;
    },
    max: 8,
  },
  {
    key: "reanimator", label: "Réanimator",
    score: (s) => {
      let p = 0;
      if (s.reanimation >= 4) p += 3;
      if (s.discard >= 4) p += 2;
      if (s.bigCreatures >= 5) p += 2;
      if (s.tutors >= 4) p += 1;
      return p;
    },
    max: 8,
  },
];

/* Top archetypes for the deck. Each entry:
 *   { key, label, score, max, confidence (0–1) }
 * The minConfidence threshold (0.35) is conservative — if no archetype
 * crosses it, the render layer can show "Profil mixte". */
function detectArchetypes(resolved, { minConfidence = 0.35 } = {}) {
  if (!resolved) return [];
  const fullDeck = [...(resolved.commanders || []), ...(resolved.deck || [])];
  if (fullDeck.length === 0) return [];

  const sig = archetypeSignals(fullDeck);
  return ARCHETYPE_RULES
    .map((r) => {
      const score = r.score(sig);
      return {
        key: r.key,
        label: r.label,
        score,
        max: r.max,
        confidence: Math.min(1, score / r.max),
      };
    })
    .filter((a) => a.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ARCHETYPE_RULES,
    archetypeSignals,
    detectArchetypes,
  };
}
