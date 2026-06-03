/* Goldfish simulator: shuffle, draw 7, then for `numTurns` turns play
 * one land + cast greedily. Returns a turn-by-turn history for the
 * "single run" timeline and exposes `runSimulations` for aggregate
 * stats across N goldfish runs.
 *
 * Approximations the model makes (these get surfaced in the UI):
 *   - No mulligans. We report `% mains gardables` (2-5 lands) instead.
 *   - No combat, no opponent — pure goldfish.
 *   - Mana rocks tap T-entry; mana dorks tap T-entry+1 (summon sickness).
 *   - On-cast / ETB effects are NOT resolved: impulse draws, extra land
 *     drops, treasure tokens, cascade, free spells… all ignored.
 *   - Generic mana is filled greedily from any unused source. Per-spell
 *     mana assignment is most-restricted-first — exact for any case a
 *     normal EDH deck will hit at 7 turns deep.
 *   - Commander is cast as soon as affordable, with 0 tax (no recasts,
 *     no death simulated).
 *   - Card categorisation (rock / dork / ramp / draw) is regex-based
 *     on type_line + oracle_text; see _is* helpers.
 */

const SIM_COLORS = ["W", "U", "B", "R", "G"];
const BASIC_COLOR = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };

/* Per-card memoisation. The same card object is passed across all N
 * runs of `runSimulations`, so we pay regex + parse once per card,
 * not once per cast attempt. WeakMap keeps the cache GC-friendly. */
const _catCache = new WeakMap();
const _costCache = new Map();        // string-keyed: many cards share "{2}{G}"
const _sourceCache = new WeakMap();

function _isLand(card) {
  return /\bland\b/i.test(card.type_line || "");
}
function _isArtifact(card) {
  return /\bartifact\b/i.test(card.type_line || "");
}
function _isCreature(card) {
  return /\bcreature\b/i.test(card.type_line || "");
}

function _producesMana(card) {
  return Array.isArray(card.produced_mana) && card.produced_mana.length > 0;
}

/* Per-tap mana output. Parses the first "Add {X}{Y}…" run in oracle
 * text. Falls back to 1 if we can't read it — Sol Ring stays correct
 * (oracle "Add {C}{C}" → 2), Llanowar Elves stays correct (1), Mind
 * Stone (1). The whole point is to not undercount Sol Ring. */
function _producedAmount(card) {
  const text = card.oracle_text || "";
  const m = text.match(/Add ((?:\{[^}]+\})+)/i);
  if (m) return (m[1].match(/\{[^}]+\}/g) || []).length;
  if (/Add three mana/i.test(text)) return 3;
  if (/Add two mana/i.test(text)) return 2;
  return 1;
}

function _isRock(card) {
  if (_isLand(card)) return false;
  if (!_isArtifact(card)) return false;
  if (_isCreature(card)) return false;
  if (!_producesMana(card)) return false;
  return (card.cmc ?? 99) <= 4;
}
/* Aura that targets a creature — illegal to cast without a creature
 * on the battlefield. Detected via type_line ("Aura") + oracle text
 * ("Enchant creature"). Other Aura sub-targets (player, land, etc.)
 * don't trip this check. */
function _isCreatureAura(card) {
  if (!/\bAura\b/i.test(card.type_line || "")) return false;
  return /Enchant creature/i.test(card.oracle_text || "");
}
function _isDork(card) {
  if (_isLand(card)) return false;
  if (!_isCreature(card)) return false;
  if (!_producesMana(card)) return false;
  return (card.cmc ?? 99) <= 3;
}
function _isRampSpell(card) {
  if (_isLand(card) || _isRock(card) || _isDork(card)) return false;
  if ((card.cmc ?? 99) > 5) return false;
  return /search your library for (a|up to (two|three)) (basic )?land/i.test(card.oracle_text || "");
}
function _isDrawSpell(card) {
  if (_isLand(card)) return false;
  if ((card.cmc ?? 99) > 6) return false;
  return /draw (a|two|three|four|five) cards?/i.test(card.oracle_text || "");
}

/* For a permanent that taps for mana, returns the source descriptor
 * used by the mana-assignment algo. `colors` is the set of colors it
 * can produce one tap; `amount` is how much mana it makes per tap.
 * Memoised per card object — same descriptor reused across all runs. */
function _cardSource(card) {
  if (_sourceCache.has(card)) return _sourceCache.get(card);
  let colors = (card.produced_mana || []).filter((c) => SIM_COLORS.includes(c) || c === "C");
  if (colors.length === 0 && _isLand(card)) {
    const m = (card.type_line || "").match(/Plains|Island|Swamp|Mountain|Forest/);
    if (m) colors = [BASIC_COLOR[m[0]]];
  }
  const out = colors.length === 0 ? null : { colors, amount: _producedAmount(card) };
  _sourceCache.set(card, out);
  return out;
}

/* Slow tapland (Guildgate, bounceland, tribal land) — enters tapped
 * with no unconditional untap clause. Can't tap on T-entry. Aligned
 * with deck-mana-base.js#isSlowLand but doesn't depend on it. */
function _isSlowTap(card) {
  const text = card.oracle_text || "";
  if (!/enters (the battlefield )?tapped/i.test(text)) return false;
  if (/unless you (control|reveal|pay)/i.test(text)) return false;
  if (/may pay (\d+ )?(life|mana)/i.test(text)) return false;
  return true;
}

/* Parse a mana cost like "{2}{W}{W}{B/R}" into per-color pip counts
 * + generic amount + hybrid list (each hybrid is the set of colors
 * that pip can be paid with). Cached by string — many cards in a
 * deck share the same cost. */
function _parseCost(cost) {
  if (_costCache.has(cost)) return _costCache.get(cost);
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0, hybrid: [] };
  if (!cost) { _costCache.set(cost, out); return out; }
  const syms = cost.match(/\{[^}]+\}/g) || [];
  for (const sym of syms) {
    const inner = sym.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(inner)) { out.generic += parseInt(inner, 10); continue; }
    if (inner === "X" || inner === "Y" || inner === "Z") continue;
    if (inner === "C") { out.C++; continue; }
    if (inner === "S") { out.generic++; continue; }
    const parts = inner.split("/").filter((p) => p !== "P");
    if (parts.length === 1) {
      const c = parts[0];
      if (out[c] !== undefined && c !== "generic" && c !== "hybrid") out[c]++;
      else out.generic++;
    } else if (parts.length > 1) {
      out.hybrid.push(parts);
    }
  }
  _costCache.set(cost, out);
  return out;
}

function _expandUnits(sources) {
  const units = [];
  for (const s of sources) {
    for (let i = 0; i < s.amount; i++) units.push({ colors: new Set(s.colors), used: false });
  }
  return units;
}

/* Try to cast `cost` against the given sources. If possible, marks
 * the consumed units as `used:true` and returns true. Otherwise
 * leaves units untouched and returns false.
 *
 * Strategy: assign the most-restricted requirements first (e.g. a
 * "must be U" pip before generic), picking the most-restricted
 * available source unit (a basic Island before a 5C-fixer). For the
 * deck sizes we ever see in 7 turns (<= 15 sources, <= 5 pips per
 * spell), greedy is optimal. */
function _attemptCast(cost, units) {
  const parsed = _parseCost(cost);
  const reqs = [];
  for (const c of SIM_COLORS) for (let i = 0; i < parsed[c]; i++) reqs.push(new Set([c]));
  for (let i = 0; i < parsed.C; i++) reqs.push(new Set(["C"]));
  for (const h of parsed.hybrid) reqs.push(new Set(h));
  reqs.sort((a, b) => a.size - b.size);

  const free = units.map((u, i) => ({ u, i })).filter(({ u }) => !u.used);
  free.sort((a, b) => a.u.colors.size - b.u.colors.size);
  const consumed = new Set();
  const usedIdx = [];
  for (const req of reqs) {
    const pick = free.find(({ u, i }) =>
      !consumed.has(i) && [...req].some((c) => u.colors.has(c)));
    if (!pick) return false;
    consumed.add(pick.i);
    usedIdx.push(pick.i);
  }
  let generic = parsed.generic;
  for (const { i } of free) {
    if (generic <= 0) break;
    if (consumed.has(i)) continue;
    consumed.add(i);
    usedIdx.push(i);
    generic--;
  }
  if (generic > 0) return false;
  for (const i of usedIdx) units[i].used = true;
  return true;
}

function _canCast(cost, units) {
  // Read-only check: clone the unit array's used flags, try, restore.
  const snapshot = units.map((u) => u.used);
  const ok = _attemptCast(cost, units);
  for (let i = 0; i < units.length; i++) units[i].used = snapshot[i];
  return ok;
}

function _seededRng(seed) {
  // Mulberry32 — small, fast, good distribution for our N <= 1000 runs.
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Per-color pip total across the non-land deck. Drives the land-pick
 * heuristic: prefer a land that produces a color we're light on. */
function _aggPips(deck) {
  const tot = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of deck) {
    if (_isLand(c)) continue;
    const cost = _parseCost(c.mana_cost || "");
    for (const k of SIM_COLORS) tot[k] += cost[k];
  }
  return tot;
}

/* Pip-demand score, ignoring tapped status. Used as a tiebreak when
 * two candidates allow the same cast. */
function _landColorScore(card, neededPips) {
  let s = 0;
  for (const c of (card.produced_mana || [])) {
    if (neededPips[c] > 0) s += neededPips[c];
  }
  return s;
}

/* Snapshot of the battlefield's available mana sources at the start of
 * turn `t` — slow taplands fresh from this turn are skipped, dorks that
 * entered this turn are summon-sick. Used both during land-pick (before
 * the new land is added) and during the cast loop. */
function _battlefieldSources(battlefield, t) {
  const sources = [];
  for (const p of battlefield) {
    if (p.type === "land") {
      if (p.enteredTurn === t && _isSlowTap(p.card)) continue;
      const src = _cardSource(p.card);
      if (src) sources.push(src);
    } else if (p.type === "rock") {
      const src = _cardSource(p.card);
      if (src) sources.push(src);
    } else if (p.type === "dork") {
      if (p.enteredTurn === t) continue;
      const src = _cardSource(p.card);
      if (src) sources.push(src);
    }
  }
  return sources;
}

/* Land-pick policy: try to drop slow taplands first so the future
 * mana base is online for free turns, BUT only when no untapped land
 * in hand would unlock a cast this turn that the tapped one wouldn't.
 *
 * Algorithm: for each candidate land, simulate "what's the best spell
 * I could cast right now if I dropped this one". Sort by (best cast
 * priority desc, slow-tap first, color-score desc, hand index). */
function _pickLand(hand, battlefield, t, neededPips, commandZone, hasCreatureOnBoard) {
  const landIdxs = [];
  for (let i = 0; i < hand.length; i++) {
    if (_isLand(hand[i])) landIdxs.push(i);
  }
  if (landIdxs.length === 0) return -1;
  if (landIdxs.length === 1) return landIdxs[0];

  const baseSources = _battlefieldSources(battlefield, t);
  const spells = hand.filter((c) => !_isLand(c));
  const cmdrCost = commandZone.map((c) => c.mana_cost || "");

  const evals = landIdxs.map((i) => {
    const card = hand[i];
    const slow = _isSlowTap(card);
    const sources = baseSources.slice();
    if (!slow) {
      const src = _cardSource(card);
      if (src) sources.push(src);
    }
    const units = _expandUnits(sources);
    let castValue = 0;
    for (const s of spells) {
      // Auras with no legal target don't count toward "this land unlocks
      // something" — keeps the policy from picking an untapped land just
      // to cast an aura that would fizzle.
      if (_isCreatureAura(s) && !hasCreatureOnBoard) continue;
      if (_canCast(s.mana_cost || "", units)) {
        const v = _priority(s, t);
        if (v > castValue) castValue = v;
      }
    }
    for (const cost of cmdrCost) {
      // Commander always beats any hand spell — it's the deck's
      // single most important play.
      if (_canCast(cost, units)) { castValue = Math.max(castValue, 100000); }
    }
    return { idx: i, slow, castValue, colorScore: _landColorScore(card, neededPips) };
  });

  evals.sort((a, b) => {
    if (b.castValue !== a.castValue) return b.castValue - a.castValue;
    if (a.slow !== b.slow) return a.slow ? -1 : 1;
    if (b.colorScore !== a.colorScore) return b.colorScore - a.colorScore;
    return a.idx - b.idx;
  });
  return evals[0].idx;
}

/* Higher = cast earlier. Rocks/dorks beat ramp spells beat draw beats
 * everything else. Inside "everything else" the highest CMC wins —
 * generally the better play (you're not getting another chance to
 * cast a 6-drop if you save it for next turn). */
function _priority(card, turn) {
  const cat = _categorize(card);
  if (cat === "rock" && turn <= 4) return 1000 + (5 - (card.cmc ?? 0));
  if (cat === "dork" && turn <= 3) return 900 + (4 - (card.cmc ?? 0));
  if (cat === "ramp") return 800 + (5 - (card.cmc ?? 0));
  if (cat === "draw") return 700;
  return (card.cmc ?? 0);
}

function _categorize(card) {
  if (_catCache.has(card)) return _catCache.get(card);
  let cat;
  if (_isLand(card)) cat = "land";
  else if (_isRock(card)) cat = "rock";
  else if (_isDork(card)) cat = "dork";
  else if (_isRampSpell(card)) cat = "ramp";
  else if (_isDrawSpell(card)) cat = "draw";
  else if (_isCreature(card)) cat = "creature";
  else cat = "spell";
  _catCache.set(card, cat);
  return cat;
}

function simulateGame(deckCards, commanders = [], opts = {}) {
  const { seed = Math.floor(Math.random() * 0xFFFFFFFF), onPlay = true, numTurns = 7 } = opts;
  const rng = _seededRng(seed);
  const neededPips = _aggPips(deckCards);
  const library = _shuffle(deckCards.slice(), rng);
  const hand = library.splice(0, 7);
  const openingHand = hand.slice();
  const lands = hand.filter(_isLand).length;
  const keepable = lands >= 2 && lands <= 5;

  /* Battlefield items keep their enteredTurn so summon-sick dorks and
   * fresh slow taplands can skip the mana pool on entry. */
  const battlefield = [];
  const commandZone = commanders.slice();
  const turns = [];
  let commanderCastTurn = null;
  let firstFiveCmcTurn = null;
  let stuckTurns = 0;

  for (let t = 1; t <= numTurns; t++) {
    /* Draw step. T1 on the play skips the draw — every other turn
     * draws one card, including T1 on the draw. */
    let drew = null;
    if (t > 1 || !onPlay) {
      drew = library.shift() || null;
      if (drew) hand.push(drew);
    }

    /* Land drop. One per turn, no fetch-cracking simulated. The land
     * policy needs to know whether a creature is currently in play to
     * avoid "unlocking" an aura that has no legal target. */
    let playedLand = null;
    const hasCreaturePreLand = battlefield.some((p) => _isCreature(p.card));
    const landIdx = _pickLand(hand, battlefield, t, neededPips, commandZone, hasCreaturePreLand);
    if (landIdx !== -1) {
      playedLand = hand.splice(landIdx, 1)[0];
      battlefield.push({ card: playedLand, type: "land", enteredTurn: t });
    }

    /* Recompute the mana pool every turn from scratch — cheap and
     * keeps the "what's tapped" bookkeeping inside this loop. */
    const sources = _battlefieldSources(battlefield, t);
    const totalMana = sources.reduce((s, x) => s + x.amount, 0);
    const units = _expandUnits(sources);
    const cast = [];

    /* Commander first if affordable — most decks want it asap and
     * skipping it makes T4-T7 numbers wildly pessimistic. */
    for (let ci = commandZone.length - 1; ci >= 0; ci--) {
      const c = commandZone[ci];
      if (_attemptCast(c.mana_cost || "", units)) {
        commandZone.splice(ci, 1);
        battlefield.push({ card: c, type: "creature", enteredTurn: t, fromCommand: true });
        cast.push({ card: c, fromCommand: true });
        if (commanderCastTurn === null) commanderCastTurn = t;
      }
    }

    /* Cast spells from hand in priority order until we can't. The
     * creature-on-board check is re-evaluated each iteration: casting
     * a creature this turn unlocks aura casts that were skipped on
     * earlier iterations of the same turn. */
    while (true) {
      const hasCreatureNow = battlefield.some((p) => _isCreature(p.card));
      const playable = [];
      for (const c of hand) {
        if (_isLand(c)) continue;
        if (_isCreatureAura(c) && !hasCreatureNow) continue;
        if (_canCast(c.mana_cost || "", units)) playable.push(c);
      }
      if (playable.length === 0) break;
      playable.sort((a, b) => _priority(b, t) - _priority(a, t));
      const pick = playable[0];
      if (!_attemptCast(pick.mana_cost || "", units)) break;
      hand.splice(hand.indexOf(pick), 1);
      const pickCat = _categorize(pick);
      const type = pickCat === "rock" ? "rock"
        : pickCat === "dork" ? "dork"
        : _isCreature(pick) ? "creature"
        : "other";
      battlefield.push({ card: pick, type, enteredTurn: t });
      /* Rocks have no summon sickness for tap abilities — Sol Ring cast
       * on T1 produces 2 mana on T1. Dorks are creatures, sick the turn
       * they enter. */
      if (pickCat === "rock") {
        const src = _cardSource(pick);
        if (src) for (let i = 0; i < src.amount; i++) {
          units.push({ colors: new Set(src.colors), used: false });
        }
      }
      cast.push({ card: pick, fromCommand: false });
      if ((pick.cmc ?? 0) >= 5 && firstFiveCmcTurn === null) firstFiveCmcTurn = t;
    }

    if (cast.length === 0 && hand.some((c) => !_isLand(c))) stuckTurns++;

    turns.push({ turn: t, drew, playedLand, cast, manaTotal: totalMana });
  }

  return {
    seed,
    onPlay,
    openingHand,
    keepable,
    turns,
    battlefield,
    hand: hand.slice(),
    libraryLeft: library.length,
    commanderCastTurn,
    firstFiveCmcTurn,
    stuckTurns,
  };
}

/* Aggregate N goldfish runs. Each run uses its own seed (seed + i) so
 * the result is reproducible from the base seed. Tracks the metrics
 * that matter for tuning a deck: mulligan rate, when the commander
 * lands, when the first big spell hits, and how often a turn whiffs. */
function runSimulations(deckCards, commanders = [], n = 500, opts = {}) {
  const baseSeed = opts.seed ?? Math.floor(Math.random() * 0xFFFFFFFF);
  let keepable = 0;
  let commanderCast = 0;
  let commanderCastSum = 0;
  let bigSpell = 0;
  let bigSpellSum = 0;
  let stuckSum = 0;
  const spellsByT = [0, 0, 0, 0, 0, 0, 0, 0];        // index 1..7
  const manaByT = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const run = simulateGame(deckCards, commanders, { ...opts, seed: baseSeed + i });
    if (run.keepable) keepable++;
    if (run.commanderCastTurn !== null) {
      commanderCast++;
      commanderCastSum += run.commanderCastTurn;
    }
    if (run.firstFiveCmcTurn !== null) {
      bigSpell++;
      bigSpellSum += run.firstFiveCmcTurn;
    }
    stuckSum += run.stuckTurns;
    let cumSpells = 0;
    for (const t of run.turns) {
      cumSpells += t.cast.filter((c) => !c.fromCommand).length;
      spellsByT[t.turn] += cumSpells;
      manaByT[t.turn] += t.manaTotal;
    }
  }
  return {
    runs: n,
    keepablePct: n > 0 ? keepable / n : 0,
    commanderCastPct: n > 0 ? commanderCast / n : 0,
    commanderAvgTurn: commanderCast > 0 ? commanderCastSum / commanderCast : null,
    bigSpellPct: n > 0 ? bigSpell / n : 0,
    bigSpellAvgTurn: bigSpell > 0 ? bigSpellSum / bigSpell : null,
    avgStuckTurns: n > 0 ? stuckSum / n : 0,
    avgSpellsByTurn: spellsByT.map((s) => n > 0 ? s / n : 0),
    avgManaByTurn: manaByT.map((m) => n > 0 ? m / n : 0),
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SIM_COLORS,
    _parseCost: _parseCost,
    _attemptCast, _canCast, _expandUnits,
    _isRock, _isDork, _isRampSpell, _isDrawSpell, _isSlowTap, _isCreatureAura,
    _cardSource, _producedAmount, _categorize,
    _seededRng, _shuffle,
    simulateGame, runSimulations,
  };
}
