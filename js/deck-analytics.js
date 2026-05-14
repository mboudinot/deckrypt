/* Pure analytics over a resolved deck (Scryfall card objects).
 *
 * Input shape (each `card`):
 *   { name, cmc, type_line, colors, color_identity, produced_mana,
 *     game_changer, all_parts: [{id, component, name, type_line, uri}] }
 *
 * All functions are O(N) over the deck and don't hit the network.
 * Token fetch (the network bit) lives in app.js — analytics just
 * extracts the IDs to fetch.
 */

const PRIMARY_TYPES = [
  "Creature", "Artifact", "Enchantment", "Instant",
  "Sorcery", "Planeswalker", "Battle", "Land",
];

/* Mana-value curve. Lands are excluded (they have cmc=0 but skew the
 * shape). Anything 7+ is bucketed into "7+". */
function manaCurve(deck) {
  const buckets = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, "7+": 0 };
  for (const c of deck) {
    if (isLandCard(c)) continue;
    const cmc = typeof c.cmc === "number" ? Math.floor(c.cmc) : 0;
    const key = cmc >= 7 ? "7+" : String(cmc);
    buckets[key]++;
  }
  return buckets;
}

/* Count cards by primary type (Land, Creature, Artifact …). A card
 * carrying multiple types (e.g. "Artifact Creature") is counted once
 * under the most-specific category — Creature wins over Artifact,
 * Land wins over everything (a basic land in the graveyard is still
 * "land"). Order chosen empirically for deck-building usefulness. */
function cardTypeBreakdown(deck) {
  const counts = Object.fromEntries(PRIMARY_TYPES.map((t) => [t, 0]));
  for (const c of deck) {
    const t = primaryTypeOf(c);
    if (t) counts[t]++;
  }
  return counts;
}

function primaryTypeOf(card) {
  const tl = (card.type_line || "").toLowerCase();
  if (!tl) return null;
  if (tl.includes("land")) return "Land";
  if (tl.includes("creature")) return "Creature";
  if (tl.includes("planeswalker")) return "Planeswalker";
  if (tl.includes("battle")) return "Battle";
  if (tl.includes("instant")) return "Instant";
  if (tl.includes("sorcery")) return "Sorcery";
  if (tl.includes("enchantment")) return "Enchantment";
  if (tl.includes("artifact")) return "Artifact";
  return null;
}

/* Mirrors `isLand` in scryfall.js. Duplicated on purpose so each
 * pure module is independently testable without importing the whole
 * Scryfall layer. The cost is two ~one-liner functions; the gain is
 * that tests don't need a stub for any companion module. */
function isLandCard(card) {
  return primaryTypeOf(card) === "Land";
}

/* Top-N creature subtypes ("Human", "Wizard", "Goblin", …). Returns
 * an ordered list [{ subtype, count }] sorted by count desc, name asc
 * on ties. The tail is collapsed into a single "Autres" bucket so the
 * UI doesn't have to know about the long tail. */
function creatureSubtypes(deck, topN = 8) {
  const counts = new Map();
  for (const c of deck) {
    if (primaryTypeOf(c) !== "Creature") continue;
    for (const t of subtypesOf(c)) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, topN).map(([subtype, count]) => ({ subtype, count }));
  const tail = sorted.slice(topN).reduce((n, [, c]) => n + c, 0);
  if (tail > 0) top.push({ subtype: "Autres", count: tail });
  return top;
}

/* Subtype tokens come after the em-dash in type_line:
 *   "Legendary Creature — Human Wizard"  →  ["Human", "Wizard"]
 * Both em-dash (—, U+2014) and ASCII (--) are accepted defensively. */
function subtypesOf(card) {
  const tl = card.type_line || "";
  const m = tl.split(/—|--/);
  if (m.length < 2) return [];
  return m[1].trim().split(/\s+/).filter(Boolean);
}

/* Unique token Scryfall IDs referenced by any card in the deck via
 * the `all_parts` array (component === "token"). Returns an array,
 * not a Set, so callers can iterate deterministically. */
function extractTokenIds(deck) {
  const seen = new Set();
  for (const c of deck) {
    const parts = Array.isArray(c.all_parts) ? c.all_parts : [];
    for (const p of parts) {
      if (p.component === "token" && p.id) seen.add(p.id);
    }
  }
  return [...seen];
}

/* Collapse cards that share the same `oracle_id`. Different printings
 * of the same token have distinct Scryfall `id`s but a shared
 * `oracle_id` — without this dedup the tokens panel would show e.g.
 * "Zombie" three times when the deck references three different
 * printings. Falls back to `id` then `name` for the rare card without
 * an oracle_id (defensive — real Scryfall always provides one). */
function dedupeByOracle(cards) {
  const seen = new Map();
  for (const c of cards) {
    const key = c.oracle_id || c.id || c.name;
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

/* Heuristic theme detection. Each rule has a `match(card)` predicate
 * and a minimum count. Wherever Scryfall exposes structured data
 * (`card.keywords` — the official keyword-ability list) we use it
 * over regex matches against `oracle_text`: keywords are the actual
 * abilities the card HAS, not just the words it mentions. That fixes
 * the long-standing false-positive class of "Plummet: destroy target
 * creature with flying" getting counted as evasion. Where Scryfall
 * doesn't expose a structured signal (sacrifice, graveyard, tokens,
 * +1/+1 counters as a theme), the regex is the only option.
 *
 * Themes don't replace synergy detection (that needs an LLM or a
 * curated combo database) — they give the user a descriptive snapshot
 * of what the deck *does*. */

const LIFEGAIN_KEYWORDS = new Set([
  "lifelink",
]);

const DISCARD_KEYWORDS = new Set([
  // Madness cares directly about discarding to cast for an alt cost;
  // Hellbent rewards an empty hand and pushes the deck toward discard.
  "madness", "hellbent",
]);

const EVASION_KEYWORDS = new Set([
  // Pure evasion (creature can't be blocked by certain blockers).
  "flying", "menace", "skulk", "shadow", "fear", "intimidate",
  "horsemanship",
  // Damage-through-blockers — not strictly evasion but the user
  // historically expected it grouped in here, and it pushes damage
  // past chump blockers the same way.
  "trample",
]);

/* Keywords whose mechanic involves +1/+1 counters. Modular, Devour
 * etc. all enter or trigger with +1/+1 counters; if a card has any
 * of these in its keywords array, the deck is dabbling in counters.
 * The regex on `oracle_text` already catches the same cards via
 * their reminder text — these keyword checks are belt-and-suspenders
 * in case Scryfall ships a card with the structured keyword but
 * stripped reminder text. */
const PLUS1_KEYWORDS = new Set([
  "modular", "adapt", "bolster", "devour", "evolve", "outlast",
  "fabricate", "renown", "support", "training", "mentor", "graft",
]);

/* Keywords that signal a spell-matters / cast-trigger payoff.
 * Prowess scales with non-creature spells; Magecraft triggers on
 * instant/sorcery casts; Storm copies based on prior casts. */
const SPELLSLINGER_KEYWORDS = new Set([
  "prowess", "magecraft", "storm",
]);

function hasAnyKeyword(card, set) {
  const ks = Array.isArray(card.keywords) ? card.keywords : [];
  for (const k of ks) {
    if (typeof k === "string" && set.has(k.toLowerCase())) return true;
  }
  return false;
}

const THEME_RULES = [
  {
    key: "graveyard", label: "Cimetière",
    // Anything that touches the graveyard zone. Mill is its own verb
    // in modern Magic ("Mill 3."); count it separately so milling
    // strategies without explicit "graveyard" mention still register.
    match: (c) => /\bgraveyard\b|\bmills?\b/i.test(c.oracle_text || ""),
    minCount: 6,
  },
  {
    key: "tokens", label: "Production de jetons",
    // The earlier {0,40} char window missed long token templates
    // ("create a tapped 2/2 black Zombie creature token with…").
    // Bumped to {0,120} which covers every standard token template
    // without catching unrelated sentences (oracle_text is rules
    // text only — no flavor — so ". " ends one clause cleanly).
    match: (c) => /\bcreate\b[^.]{0,120}\btokens?\b/i.test(c.oracle_text || "")
      || /\bpopulate\b/i.test(c.oracle_text || ""),
    minCount: 4,
  },
  {
    key: "counters", label: "Compteurs +1/+1",
    match: (c) => hasAnyKeyword(c, PLUS1_KEYWORDS)
      || /\+1\/\+1 counters?\b/i.test(c.oracle_text || ""),
    minCount: 5,
  },
  {
    key: "sacrifice", label: "Sacrifice (aristocrats)",
    // Expanded determiners (each / all / your) and object types
    // (land / enchantment / nonland / nontoken) catch sac-everything
    // boardwipes and "sacrifice a land: …" engines.
    match: (c) => /\bsacrifices?\s+(a|an|another|two|three|each|all|your|target)\s+(creature|permanent|artifact|land|enchantment|nonland|nontoken)/i
      .test(c.oracle_text || ""),
    minCount: 4,
  },
  {
    key: "spellslinger", label: "Sortilèges & instants",
    match: (c) => hasAnyKeyword(c, SPELLSLINGER_KEYWORDS)
      || /\b(instant|sorcery) (spell|card)\b|whenever you cast (an? )?(instant|sorcery)/i
        .test(c.oracle_text || ""),
    minCount: 5,
  },
  {
    key: "evasion", label: "Créatures évasives",
    match: (c) => {
      if (hasAnyKeyword(c, EVASION_KEYWORDS)) return true;
      // "Can't be blocked" is a static ability, not a keyword. Only
      // count creatures here — equipment that GRANTS unblockability
      // ("equipped creature can't be blocked") shouldn't tip the deck
      // toward evasion theme since the granted ability is a separate
      // axis. Plummet-style removal ("destroy target creature with
      // flying") never has Flying in its own keywords, so the
      // keyword path is immune to that false positive.
      if (primaryTypeOf(c) !== "Creature") return false;
      return /\bcan[’']t be blocked\b/i.test(c.oracle_text || "");
    },
    minCount: 8,
  },
  {
    key: "combat-triggers", label: "Triggers de dégâts de combat",
    match: (c) => /deals combat damage to a player/i.test(c.oracle_text || ""),
    minCount: 4,
  },
  {
    key: "lifegain", label: "Gain de vie",
    /* Lifelink keyword covers granting cards. The regex catches every
     * "X gain(s) N life" phrasing (including "you gain life" without
     * a number) — and intentionally NOT "lose life" / "pay life",
     * which are a separate axis (life-as-resource decks). */
    match: (c) => hasAnyKeyword(c, LIFEGAIN_KEYWORDS)
      || /\bgains?\s+(\w+\s+)?life\b/i.test(c.oracle_text || ""),
    minCount: 5,
  },
  {
    key: "card-draw", label: "Pioche",
    /* "Draws? <0-3 words> cards?" catches "draw a card", "draws three
     * cards", "draws that many cards". Threshold is high (8) because
     * every deck has some draw — flagging the theme means draw is a
     * focus, not just present. */
    match: (c) => /\bdraws?\b[^.]{0,30}\bcards?\b/i.test(c.oracle_text || ""),
    minCount: 8,
  },
  {
    key: "discard", label: "Défausse",
    /* "Discard" is uncommon enough in oracle text that any mention
     * implies the card cares about it (no flavor text in oracle_text
     * to dilute the signal). Madness/Hellbent keywords double-check
     * for stripped-reminder edge cases. */
    match: (c) => hasAnyKeyword(c, DISCARD_KEYWORDS)
      || /\bdiscards?\b/i.test(c.oracle_text || ""),
    minCount: 4,
  },
  {
    key: "ramp", label: "Ramp / accélération",
    /* Three signatures, all derivable from structured data when
     * possible:
     *   1. Non-land permanent that produces mana — `produced_mana`
     *      array is non-empty on Scryfall data (Sol Ring, Birds).
     *   2. Land tutors — "search your library for ... land" /
     *      "search your library for a Forest" etc.
     *   3. Treasure tokens — instant ramp via tap-and-sacrifice.
     * Threshold 8 filters out the obligatory Sol Ring + Arcane
     * Signet duo and only flags decks actually committed to ramp. */
    match: (c) => {
      const isLand = primaryTypeOf(c) === "Land";
      if (!isLand && Array.isArray(c.produced_mana) && c.produced_mana.length > 0) {
        return true;
      }
      const text = c.oracle_text || "";
      if (/search your library for[^.]*\bland\b/i.test(text)) return true;
      if (/search your library for[^.]*\b(forest|island|swamp|mountain|plains|basic)\b/i.test(text)) return true;
      if (/\btreasure tokens?\b/i.test(text)) return true;
      return false;
    },
    minCount: 8,
  },
];

/* Deduplicate matching cards by `name` so a 4-of doesn't show up
 * four times in the theme grid. Card objects are kept by first-seen
 * order — stable, matches the deck's iteration. */
function _dedupeByName(cards) {
  const seen = new Set();
  const out = [];
  for (const c of cards) {
    if (!c.name || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
  }
  return out;
}

function detectThemes(deck) {
  const out = [];
  for (const rule of THEME_RULES) {
    const matches = [];
    for (const c of deck) {
      if (rule.match(c)) matches.push(c);
    }
    // The threshold counts each copy (4× Counterspell = 4 toward the
    // spellslinger threshold) — that reflects how much the theme
    // *runs* in the deck. The card grid below uses the deduped list
    // so a 4-of doesn't tile four times.
    if (matches.length >= rule.minCount) {
      out.push({
        key: rule.key, label: rule.label,
        count: matches.length,
        cards: _dedupeByName(matches),
      });
    }
  }
  // Tribal: dominant creature subtype representing ≥40% of creatures.
  // The 8-creature minimum filters out tiny test decks.
  const subs = creatureSubtypes(deck, 1);
  const creatures = deck.filter((c) => primaryTypeOf(c) === "Creature");
  const totalCreatures = creatures.length;
  if (subs[0] && subs[0].subtype !== "Autres" && totalCreatures >= 8) {
    const ratio = subs[0].count / totalCreatures;
    if (ratio >= 0.4) {
      const dominant = subs[0].subtype;
      const matching = creatures.filter((c) => subtypesOf(c).includes(dominant));
      out.push({
        key: "tribal",
        label: `Tribal ${dominant}`,
        count: subs[0].count,
        cards: _dedupeByName(matching),
      });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

/* Cards on the official Game Changers list (Scryfall flag). */
function gameChangers(deck) {
  return deck.filter((c) => c.game_changer === true);
}

/* Best-effort Commander Bracket estimate. Scryfall only exposes the
 * `game_changer` boolean; mass-land-destruction / extra turns /
 * tutors / two-card combos aren't tagged, so we can't fully classify.
 * We give a *lower bound* on the bracket the deck belongs to. */
function bracketEstimate(deck) {
  const gcCount = gameChangers(deck).length;
  let minBracket, label;
  if (gcCount === 0) {
    minBracket = 1; label = "Exhibition / Core (à valider à la main)";
  } else if (gcCount <= 3) {
    minBracket = 3; label = "Upgraded";
  } else if (gcCount <= 7) {
    minBracket = 4; label = "Optimisé";
  } else {
    minBracket = 4; label = "Optimisé / cEDH";
  }
  return {
    gameChangerCount: gcCount,
    minBracket,
    label,
    note:
      "Estimation basée uniquement sur la liste officielle des Game Changers. " +
      "Scryfall n'expose pas les autres critères (mass land destruction, tours " +
      "supplémentaires, tuteurs efficaces, combos infinis) — à vérifier à la main.",
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PRIMARY_TYPES,
    manaCurve, cardTypeBreakdown, primaryTypeOf, isLandCard,
    creatureSubtypes, subtypesOf,
    extractTokenIds, dedupeByOracle, gameChangers, bracketEstimate,
    detectThemes, THEME_RULES,
  };
}
