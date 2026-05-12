/* Mana-base analysis: per-color sources from lands, per-color
 * symbol requirements from spell costs, plus counts of multicolor
 * lands and fetch / land-tutor lands.
 *
 * The per-color verdict is Karsten-based (mtg.cardsphere.com / 2021
 * update). For each colour the deck actually uses, we find the
 * single spell with the heaviest casting demand (pips at CMC) and
 * check the deck has enough sources to cast IT on curve. Summing
 * total symbols across the deck — the previous heuristic — was
 * wrong: you never pay 70 black pips at once, you pay the cost of
 * one spell, and your bottleneck is the worst one. */

const COLORS = ["W", "U", "B", "R", "G"];

function _isLand(card) {
  return /\bland\b/i.test(card.type_line || "");
}

/* Parse a Scryfall mana_cost ("{2}{W}{W}{R/G}") into per-color
 * symbol counts. Hybrid mana ({W/U}) counts toward BOTH halves —
 * the spell *can* be paid with either, so a deck running it puts
 * pressure on both color bases. Phyrexian mana ({W/P}) is treated
 * as a coloured cost too (we ignore the life-payment alternative
 * for analysis purposes). Generic / X / colourless symbols are
 * skipped. */
function parseManaCost(cost) {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  if (!cost || typeof cost !== "string") return out;
  const symbols = cost.match(/\{[^}]+\}/g) || [];
  for (const sym of symbols) {
    const inner = sym.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(inner)) continue;             // generic mana {2}
    if (inner === "X" || inner === "Y" || inner === "Z") continue;
    if (inner === "C") continue;                   // colourless
    if (inner === "S") continue;                   // snow
    const parts = inner.split("/");
    for (const p of parts) {
      if (p === "P") continue;                     // phyrexian marker
      if (out.hasOwnProperty(p)) out[p]++;
    }
  }
  return out;
}

/* Sum of per-colour symbols across every non-land card's mana_cost. */
function colorRequirements(deck) {
  const total = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of deck) {
    if (_isLand(card)) continue;
    const cost = parseManaCost(card.mana_cost || "");
    for (const c of COLORS) total[c] += cost[c];
  }
  return total;
}

/* Per-colour land sources. A land producing two colours counts +1
 * for each colour (Hallowed Fountain → +1 W, +1 U). Same-colour
 * duplicates within a single card's produced_mana are deduped (rare
 * but defensive — Scryfall has cleaned this up but not always). */
function manaSourcesByColor(deck) {
  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const card of deck) {
    if (!_isLand(card)) continue;
    const produced = Array.isArray(card.produced_mana) ? card.produced_mana : [];
    const seen = new Set();
    for (const c of produced) {
      if (sources.hasOwnProperty(c) && !seen.has(c)) {
        sources[c]++;
        seen.add(c);
      }
    }
  }
  return sources;
}

function isMulticolorLand(card) {
  if (!_isLand(card)) return false;
  const produced = (card.produced_mana || []).filter((c) => COLORS.includes(c));
  return new Set(produced).size >= 2;
}

/* Fetch / land-tutor lands: produce no mana directly, but their
 * activated ability puts another land onto the battlefield. Covers
 * Polluted Delta, Misty Rainforest, Evolving Wilds, Terramorphic
 * Expanse, Prismatic Vista, Fabled Passage… */
function isFetchLand(card) {
  if (!_isLand(card)) return false;
  const text = card.oracle_text || "";
  if (!/search your library/i.test(text)) return false;
  if (!/\bbattlefield\b/i.test(text)) return false;
  // Either explicitly searches for a "land" or names basic-land types.
  if (/\bland\b/i.test(text)) return true;
  if (/\b(forest|island|swamp|mountain|plains)\b/i.test(text)) return true;
  return false;
}

function countMulticolorLands(deck) {
  let n = 0;
  for (const card of deck) if (isMulticolorLand(card)) n++;
  return n;
}

function countFetchLands(deck) {
  let n = 0;
  for (const card of deck) if (isFetchLand(card)) n++;
  return n;
}

/* "Slow" lands: those that enter tapped with no unconditional way to
 * come in untapped. Shocklands (`unless you pay`), check lands
 * (`unless you control`) and reveal lands count as fast — they have
 * playable lines on T1/T2 if conditions are met. Pure taplands
 * (Guildgates, bouncelands, tribal lands) are slow. */
function isSlowLand(card) {
  if (!_isLand(card)) return false;
  const text = card.oracle_text || "";
  if (!/enters (the battlefield )?tapped/i.test(text)) return false;
  // Anything that allows an untapped entry under some condition →
  // treat as fast. Covers shocks, checks, fast lands, reveal lands.
  if (/unless you (control|reveal|pay)/i.test(text)) return false;
  if (/may pay (\d+ )?(life|mana)/i.test(text)) return false;
  return true;
}

/* Utility lands: any non-mana ability beyond producing mana.
 * Excludes fetch lands (they have their own counter). Patterns are
 * permissive — better to include the occasional dual that also draws
 * a card than to miss obvious utilities (Bojuka Bog, Strip Mine,
 * Reliquary Tower, Maze of Ith, Cabal Coffers, etc.). */
function isUtilityLand(card) {
  if (!_isLand(card)) return false;
  if (isFetchLand(card)) return false;
  const text = card.oracle_text || "";
  // Self-sacrifice for an effect (Strip Mine, Bojuka Bog, etc.)
  if (/sacrifice [^.]*?:/i.test(text)) return true;
  // Anti-graveyard hosers
  if (/exile [^.]*?\bgraveyard\b/i.test(text)) return true;
  // Hand-size effects (Reliquary Tower)
  if (/no maximum hand size/i.test(text)) return true;
  // Combat tricks (Maze of Ith family)
  if (/can[’']t be the target/i.test(text)) return true;
  if (/prevent (all )?(combat )?damage/i.test(text)) return true;
  // Land / permanent destruction (Strip Mine, Wasteland, Tectonic Edge)
  if (/destroy target (land|permanent|nonland|noncreature)/i.test(text)) return true;
  // Draws / card advantage attached to a land (Castle Ardenvale-ish)
  if (/draws? (a|two|three|that many) cards?/i.test(text)) return true;
  // Manlands (becoming a creature on activation)
  if (/becomes? an? \d+\/\d+/i.test(text)) return true;
  return false;
}

function countSlowLands(deck) {
  let n = 0;
  for (const card of deck) if (isSlowLand(card)) n++;
  return n;
}

function countUtilityLands(deck) {
  let n = 0;
  for (const card of deck) if (isUtilityLand(card)) n++;
  return n;
}

/* Frank Karsten's mana-base table for a 99-card EDH deck (2021
 * update). Rows = colored pips in the spell's cost, columns = the
 * turn the spell can first be cast (its CMC, in practice). Cell =
 * minimum same-colour sources for ~90 % "cast on curve" reliability.
 * Numbers drop with CMC because extra draws give extra hits. */
const KARSTEN_99 = {
  1: { 1: 19, 2: 18, 3: 16, 4: 15, 5: 14, 6: 13, 7: 13 },
  2: { 2: 23, 3: 20, 4: 18, 5: 17, 6: 16, 7: 16 },
  3: { 3: 25, 4: 22, 5: 20, 6: 19, 7: 18 },
  4: { 4: 26, 5: 24, 6: 22, 7: 21 },
  5: { 5: 27, 6: 25, 7: 23 },
};

/* How many of a colour's sources you need to cast `pips`-coloured
 * cost at `cmc` mana on-curve, in a deck of `deckSize` cards.
 * `pips` is clamped to 1..5 and CMC to pips..7 (can't cast BB on T1;
 * past T7 you've drawn enough that more turns barely move the
 * probability). Scales linearly with deck size — Karsten's table
 * is calibrated for 99-card EDH, halving for 50-card builds, etc. */
function sourcesNeededFor(pips, cmc, deckSize = 99) {
  if (pips <= 0) return 0;
  const p = Math.min(pips, 5);
  const c = Math.max(p, Math.min(cmc, 7));
  const base = KARSTEN_99[p][c];
  if (deckSize >= 99) return base;
  return Math.round(base * deckSize / 99);
}

/* For each colour the deck actually uses, find the spell that demands
 * the most sources to cast on curve (its "dominant cost") and
 * compare actual sources to Karsten's threshold for that spell.
 * Hybrid pips are counted toward each half (conservative — a
 * {W/U} cost shows pressure on both bases, which over-warns slightly
 * but never under-warns).
 *
 * Returns rows for colours that have demand or sources. Status:
 *   ok   — sources ≥ dominant Karsten threshold
 *   low  — sources < threshold
 *   info — colour has sources but no spell demands it (idle fixing) */
function fixingVerdicts(sources, deck) {
  const usage = {};
  const deckSize = Math.max(deck.length, 1);
  for (const card of deck) {
    if (_isLand(card)) continue;
    const cost = parseManaCost(card.mana_cost || "");
    const cmc = typeof card.cmc === "number" ? card.cmc : 0;
    for (const c of COLORS) {
      const pips = cost[c];
      if (pips === 0) continue;
      const need = sourcesNeededFor(pips, cmc, deckSize);
      const prev = usage[c];
      if (!prev || need > prev.needed) {
        usage[c] = { needed: need, pips, cmc, name: card.name };
      }
    }
  }

  const out = [];
  for (const c of COLORS) {
    const src = sources[c];
    const u = usage[c];
    if (!u && src === 0) continue;
    if (!u) {
      out.push({ color: c, sources: src, needed: 0, status: "info", dominant: null });
      continue;
    }
    const status = src >= u.needed ? "ok" : "low";
    out.push({
      color: c,
      sources: src,
      needed: u.needed,
      status,
      dominant: { name: u.name, pips: u.pips, cmc: u.cmc },
    });
  }
  return out;
}

function analyzeManaBase(deck) {
  const lands = deck.filter(_isLand).length;
  const sources = manaSourcesByColor(deck);
  const requirements = colorRequirements(deck);
  const multicolor = countMulticolorLands(deck);
  const fetches = countFetchLands(deck);
  const slow = countSlowLands(deck);
  const utility = countUtilityLands(deck);
  const perColor = fixingVerdicts(sources, deck);
  return { lands, sources, requirements, multicolor, fetches, slow, utility, perColor };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    COLORS,
    parseManaCost, colorRequirements, manaSourcesByColor,
    isMulticolorLand, isFetchLand, isSlowLand, isUtilityLand,
    countMulticolorLands, countFetchLands, countSlowLands, countUtilityLands,
    sourcesNeededFor, fixingVerdicts, analyzeManaBase,
  };
}
