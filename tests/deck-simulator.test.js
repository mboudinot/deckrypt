import { describe, it, expect } from "vitest";
import {
  _parseCost, _attemptCast, _canCast, _expandUnits,
  _isRock, _isDork, _isRampSpell, _isDrawSpell, _isSlowTap, _isCreatureAura,
  _cardSource, _producedAmount, _categorize,
  _seededRng,
  simulateGame, runSimulations,
} from "../js/deck-simulator.js";

const card = (overrides = {}) => ({
  name: "X", type_line: "Creature — Bear", mana_cost: "", cmc: 0,
  produced_mana: [], oracle_text: "", colors: [], color_identity: [],
  ...overrides,
});

const land = (produced, type = "Basic Land — Forest", text = "") =>
  card({ type_line: type, produced_mana: produced, oracle_text: text, cmc: 0 });

describe("_parseCost", () => {
  it("counts generic + colored pips", () => {
    expect(_parseCost("{2}{W}{W}")).toMatchObject({ W: 2, generic: 2 });
    expect(_parseCost("{R}{R}{R}")).toMatchObject({ R: 3, generic: 0 });
  });
  it("treats colourless {C} as its own bucket", () => {
    expect(_parseCost("{C}{C}{C}")).toMatchObject({ C: 3, generic: 0 });
  });
  it("hybrid is its own list", () => {
    const p = _parseCost("{W/U}{W/U}");
    expect(p.W).toBe(0); expect(p.U).toBe(0);
    expect(p.hybrid).toHaveLength(2);
    expect(p.hybrid[0]).toEqual(["W", "U"]);
  });
  it("phyrexian counts as the colored half", () => {
    expect(_parseCost("{W/P}")).toMatchObject({ W: 1, generic: 0 });
  });
  it("ignores X / snow as generic", () => {
    expect(_parseCost("{X}{S}{2}")).toMatchObject({ generic: 3 });
  });
});

describe("_canCast / _attemptCast", () => {
  const sources = (...arr) => _expandUnits(arr);
  const G = { colors: ["G"], amount: 1 };
  const W = { colors: ["W"], amount: 1 };
  const U = { colors: ["U"], amount: 1 };
  const WU = { colors: ["W", "U"], amount: 1 };
  const ANY5 = { colors: ["W", "U", "B", "R", "G"], amount: 1 };
  const C2 = { colors: ["C"], amount: 2 };  // Sol Ring

  it("mono-color spell pays with a basic", () => {
    expect(_canCast("{G}", sources(G))).toBe(true);
  });
  it("fails when not enough mana", () => {
    expect(_canCast("{2}{G}", sources(G, G))).toBe(false);
  });
  it("two-color spell needs both colors", () => {
    expect(_canCast("{W}{U}", sources(W, W))).toBe(false);
    expect(_canCast("{W}{U}", sources(W, U))).toBe(true);
  });
  it("dual land can pay either color", () => {
    expect(_canCast("{W}{U}", sources(WU, W))).toBe(true);
    expect(_canCast("{W}{U}", sources(WU, WU))).toBe(true);
  });
  it("prefers restricted source for colored pip (greedy correctness)", () => {
    // {W} cost with [WU, W]: must NOT spend the WU on this W if W exists.
    // But for one cast it doesn't matter — exercise the bigger case:
    // {W}{U} with [W, WU, U] must pass.
    expect(_canCast("{W}{U}", sources(W, WU, U))).toBe(true);
  });
  it("Sol Ring's 2 colorless taps for {C}{C} or 2 generic", () => {
    expect(_canCast("{C}{C}", sources(C2))).toBe(true);
    expect(_canCast("{2}", sources(C2))).toBe(true);
    // Pays a Karn-style cost {C}{C}{C} with Sol Ring + 1 basic that doesn't produce C
    expect(_canCast("{C}{C}{C}", sources(C2, G))).toBe(false);
  });
  it("hybrid pip takes any of its colors", () => {
    expect(_canCast("{W/U}", sources(W))).toBe(true);
    expect(_canCast("{W/U}", sources(U))).toBe(true);
    expect(_canCast("{W/U}", sources(G))).toBe(false);
  });
  it("5C-fixer pays a 5C cost", () => {
    expect(_canCast("{W}{U}{B}{R}{G}", sources(ANY5, ANY5, ANY5, ANY5, ANY5))).toBe(true);
  });
  it("_canCast does not mark units used (no side effect)", () => {
    const units = sources(W, U);
    _canCast("{W}{U}", units);
    expect(units.every((u) => !u.used)).toBe(true);
  });
  it("_attemptCast marks units used on success", () => {
    const units = sources(W, U);
    const ok = _attemptCast("{W}", units);
    expect(ok).toBe(true);
    expect(units.filter((u) => u.used)).toHaveLength(1);
  });
  it("_attemptCast leaves units untouched on failure", () => {
    const units = sources(W);
    const ok = _attemptCast("{U}", units);
    expect(ok).toBe(false);
    expect(units.every((u) => !u.used)).toBe(true);
  });
});

describe("card categorisation", () => {
  it("identifies a mana rock (Sol Ring)", () => {
    const c = card({
      type_line: "Artifact", cmc: 1,
      produced_mana: ["C"], oracle_text: "{T}: Add {C}{C}.",
    });
    expect(_isRock(c)).toBe(true);
    expect(_categorize(c)).toBe("rock");
  });
  it("identifies a mana dork (Llanowar Elves)", () => {
    const c = card({
      type_line: "Creature — Elf Druid", cmc: 1,
      produced_mana: ["G"], oracle_text: "{T}: Add {G}.",
    });
    expect(_isDork(c)).toBe(true);
    expect(_categorize(c)).toBe("dork");
  });
  it("does not mark a 5-mana creature-with-mana as a dork", () => {
    const c = card({
      type_line: "Creature — Beast", cmc: 5,
      produced_mana: ["G"], oracle_text: "{T}: Add {G}.",
    });
    expect(_isDork(c)).toBe(false);
  });
  it("identifies a ramp spell (Rampant Growth)", () => {
    const c = card({
      type_line: "Sorcery", cmc: 2,
      oracle_text: "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
    });
    expect(_isRampSpell(c)).toBe(true);
    expect(_categorize(c)).toBe("ramp");
  });
  it("identifies a draw spell (Harmonize)", () => {
    const c = card({
      type_line: "Sorcery", cmc: 4,
      oracle_text: "Draw three cards.",
    });
    expect(_isDrawSpell(c)).toBe(true);
    expect(_categorize(c)).toBe("draw");
  });
  it("identifies creature auras (Rancor) but not other auras", () => {
    const rancor = card({
      type_line: "Enchantment — Aura", cmc: 1, mana_cost: "{G}",
      oracle_text: "Enchant creature\nEnchanted creature gets +2/+0 and has trample.",
    });
    const spectraSlope = card({
      type_line: "Enchantment — Aura", cmc: 2,
      oracle_text: "Enchant land\nEnchanted land has '{T}: Add one mana of any color.'",
    });
    expect(_isCreatureAura(rancor)).toBe(true);
    expect(_isCreatureAura(spectraSlope)).toBe(false);
  });
  it("detects slow taplands but not shocks", () => {
    const slow = card({
      type_line: "Land", oracle_text: "Selesnya Guildgate enters tapped. {T}: Add {G} or {W}.",
    });
    const shock = card({
      type_line: "Land — Forest Plains",
      oracle_text: "As Temple Garden enters, you may pay 2 life. If you don't, it enters tapped.",
    });
    expect(_isSlowTap(slow)).toBe(true);
    expect(_isSlowTap(shock)).toBe(false);
  });
});

describe("_producedAmount", () => {
  it("Sol Ring = 2", () => {
    const c = card({ oracle_text: "{T}: Add {C}{C}." });
    expect(_producedAmount(c)).toBe(2);
  });
  it("default = 1", () => {
    expect(_producedAmount(card({ oracle_text: "{T}: Add {G}." }))).toBe(1);
    expect(_producedAmount(card({ oracle_text: "" }))).toBe(1);
  });
  it("'Add three mana' fallback works", () => {
    expect(_producedAmount(card({ oracle_text: "Add three mana of any color." }))).toBe(3);
  });
});

describe("_cardSource", () => {
  it("infers basic land color from type_line when produced_mana is empty", () => {
    const c = land([], "Basic Land — Mountain");
    expect(_cardSource(c)).toEqual({ colors: ["R"], amount: 1 });
  });
});

describe("_seededRng", () => {
  it("is deterministic for the same seed", () => {
    const a = _seededRng(42);
    const b = _seededRng(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});

/* End-to-end goldfish runs on a tiny synthetic deck. The deck has 3
 * basic forests, 4 cheap creatures, 1 ramp, 1 big creature so we can
 * assert turn-by-turn behaviour deterministically. */
function tinyDeck() {
  const forest = land(["G"], "Basic Land — Forest");
  const elves = card({
    name: "Llanowar Elves", type_line: "Creature — Elf Druid", cmc: 1,
    mana_cost: "{G}", produced_mana: ["G"], oracle_text: "{T}: Add {G}.",
  });
  const bear = card({
    name: "Grizzly Bears", type_line: "Creature — Bear", cmc: 2, mana_cost: "{1}{G}",
  });
  const harmonize = card({
    name: "Harmonize", type_line: "Sorcery", cmc: 4, mana_cost: "{2}{G}{G}",
    oracle_text: "Draw three cards.",
  });
  return [
    forest, forest, forest, forest, forest, forest,    // 6 forests
    elves, elves, bear, bear, harmonize,
  ];
}

describe("simulateGame", () => {
  it("same seed produces same run", () => {
    const d = tinyDeck();
    const a = simulateGame(d, [], { seed: 1234, onPlay: true });
    const b = simulateGame(d, [], { seed: 1234, onPlay: true });
    expect(a.turns.map((t) => t.playedLand?.name)).toEqual(b.turns.map((t) => t.playedLand?.name));
    expect(a.turns.map((t) => t.cast.length)).toEqual(b.turns.map((t) => t.cast.length));
  });
  it("does not draw on T1 when on the play", () => {
    const d = tinyDeck();
    const run = simulateGame(d, [], { seed: 1, onPlay: true });
    expect(run.turns[0].drew).toBeNull();
  });
  it("draws on T1 when on the draw", () => {
    const d = tinyDeck();
    const run = simulateGame(d, [], { seed: 1, onPlay: false });
    expect(run.turns[0].drew).not.toBeNull();
  });
  it("plays one land per turn when one is in hand", () => {
    // With 6 forests and a 7-card hand + 6 draws, we have plenty of lands.
    // We can't guarantee a land every single turn, but at least 4 turns
    // out of 7 should have a land drop on a sane deck. Loose assertion.
    const run = simulateGame(tinyDeck(), [], { seed: 999, onPlay: true });
    const lands = run.turns.filter((t) => t.playedLand).length;
    expect(lands).toBeGreaterThanOrEqual(4);
  });
  it("does not allow a freshly-played dork to tap on its entry turn", () => {
    // T1: forest in play, cast elves#1 with the forest. The freshly-cast
    // elves is summon-sick and must NOT tap to help cast elves#2 on the
    // same turn (otherwise we'd "free-cast" the second elves).
    const forest = land(["G"]);
    const elves = card({
      name: "LE", type_line: "Creature — Elf", cmc: 1, mana_cost: "{G}",
      produced_mana: ["G"], oracle_text: "{T}: Add {G}.",
    });
    const filler = card({ name: "Filler", type_line: "Sorcery", cmc: 9, mana_cost: "{9}" });
    const deck = [forest, elves, elves, filler, filler, filler, filler, filler, filler, filler];
    let castTwoElves = 0;
    let castOneElves = 0;
    for (let seed = 1; seed < 80; seed++) {
      const run = simulateGame(deck, [], { seed, onPlay: true });
      const t1elves = run.turns[0].cast.filter((c) => c.card.name === "LE").length;
      if (t1elves === 2) castTwoElves++;
      if (t1elves === 1) castOneElves++;
    }
    expect(castTwoElves).toBe(0);  // dork sickness should always prevent the 2nd
    expect(castOneElves).toBeGreaterThan(0);  // and at least sometimes one fires
  });

  it("allows a freshly-cast Sol Ring to tap for mana the same turn", () => {
    // Sol Ring is an artifact — no summon sickness. T1 with 0 lands and
    // Sol Ring in hand, you can't cast it (no mana). But cast it any
    // turn it should add 2 to the pool that same turn.
    const forest = land(["G"]);
    const solRing = card({
      name: "Sol Ring", type_line: "Artifact", cmc: 1, mana_cost: "{1}",
      produced_mana: ["C"], oracle_text: "{T}: Add {C}{C}.",
    });
    const bear = card({
      name: "Bear", type_line: "Creature — Bear", cmc: 2, mana_cost: "{1}{G}",
    });
    const filler = card({ name: "F", type_line: "Sorcery", cmc: 9, mana_cost: "{9}" });
    const deck = [forest, forest, solRing, bear, filler, filler, filler, filler, filler, filler];
    let bothCast = 0;
    for (let seed = 1; seed < 60; seed++) {
      const run = simulateGame(deck, [], { seed, onPlay: true });
      // Look for the turn where Sol Ring was cast and check if a bear
      // also fired the same turn — proves the freshly-cast rock is
      // contributing mana immediately.
      for (const t of run.turns) {
        const ring = t.cast.some((c) => c.card.name === "Sol Ring");
        const bearCast = t.cast.some((c) => c.card.name === "Bear");
        if (ring && bearCast) bothCast++;
      }
    }
    expect(bothCast).toBeGreaterThan(0);
  });
  it("casts the commander as soon as affordable", () => {
    const forest = land(["G"]);
    const cmdr = card({
      name: "Cmdr", type_line: "Legendary Creature — Druid",
      cmc: 3, mana_cost: "{1}{G}{G}",
    });
    const filler = card({ name: "F", type_line: "Sorcery", cmc: 9, mana_cost: "{9}" });
    const deck = Array(10).fill(forest).concat(Array(10).fill(filler));
    const run = simulateGame(deck, [cmdr], { seed: 7, onPlay: true });
    expect(run.commanderCastTurn).not.toBeNull();
    expect(run.commanderCastTurn).toBeLessThanOrEqual(4);
  });
});

describe("creature-aura rule", () => {
  it("does not cast a creature aura when no creature is in play", () => {
    const forest = land(["G"]);
    const rancor = card({
      name: "Rancor", type_line: "Enchantment — Aura", cmc: 1, mana_cost: "{G}",
      oracle_text: "Enchant creature\nEnchanted creature gets +2/+0.",
    });
    const filler = card({ name: "F", type_line: "Sorcery", cmc: 9, mana_cost: "{9}" });
    const deck = [forest, forest, forest, rancor, rancor, filler, filler, filler, filler, filler];
    let castWithoutCreature = 0;
    for (let seed = 1; seed < 60; seed++) {
      const run = simulateGame(deck, [], { seed, onPlay: true });
      for (const turn of run.turns) {
        const ranOk = turn.cast.some((c) => c.card.name === "Rancor");
        if (!ranOk) continue;
        // Was a creature on the battlefield at the start of this turn?
        // We rebuild by walking earlier turns — much cheaper to just
        // assert "Rancor cast" + final battlefield has at least one
        // non-land non-rock non-dork-rock card, since the test deck has
        // no creatures. Anything other than 0 casts of Rancor = a bug.
        castWithoutCreature++;
      }
    }
    expect(castWithoutCreature).toBe(0);
  });
  it("does cast the aura once a creature lands", () => {
    const forest = land(["G"]);
    const rancor = card({
      name: "Rancor", type_line: "Enchantment — Aura", cmc: 1, mana_cost: "{G}",
      oracle_text: "Enchant creature\nEnchanted creature gets +2/+0.",
    });
    const bear = card({
      name: "Bear", type_line: "Creature — Bear", cmc: 1, mana_cost: "{G}",
    });
    const deck = [forest, forest, forest, rancor, rancor, bear, bear, bear, bear, bear];
    let castWithCreature = 0;
    for (let seed = 1; seed < 40; seed++) {
      const run = simulateGame(deck, [], { seed, onPlay: true });
      if (run.turns.some((t) => t.cast.some((c) => c.card.name === "Rancor"))) {
        castWithCreature++;
      }
    }
    expect(castWithCreature).toBeGreaterThan(0);
  });
});

describe("land-pick policy: tapped first", () => {
  it("plays the slow-tap land first when no spell is held back by it", () => {
    const guildgate = card({
      name: "Selesnya Guildgate", type_line: "Land — Gate",
      produced_mana: ["G", "W"],
      oracle_text: "Selesnya Guildgate enters tapped. {T}: Add {G} or {W}.",
    });
    const forest = land(["G"], "Basic Land — Forest");
    /* Hand has both a Guildgate and a Forest, plus a single 2-cmc bear
     * that can wait until T2 to land. On T1 we can't cast it either
     * way (no T1 mana from the gate, only 1 from a Forest if played
     * untapped). The policy should pick the Guildgate so the Forest is
     * left for T2 where it untaps and enables the Bear. */
    const bear = card({
      name: "Bear", type_line: "Creature — Bear", cmc: 2, mana_cost: "{1}{G}",
    });
    const filler = card({ name: "F", type_line: "Sorcery", cmc: 9, mana_cost: "{9}" });
    let t1Guildgate = 0;
    for (let seed = 1; seed < 50; seed++) {
      // Force a hand that contains both lands + a 2-cmc spell.
      // We construct a tiny deck that essentially always starts with
      // these three cards in the opening hand.
      const deck = [guildgate, forest, bear, filler, filler, filler, filler];
      const run = simulateGame(deck, [], { seed, onPlay: true });
      if (run.turns[0].playedLand?.name === "Selesnya Guildgate") t1Guildgate++;
    }
    expect(t1Guildgate).toBeGreaterThan(0);
  });
  it("plays the untapped land first when it unlocks a same-turn cast", () => {
    /* T1: hand has Guildgate, Forest, Elves. Playing the Forest taps
     * for {G} and lets us cast Elves now. Playing the Guildgate gives
     * us zero mana this turn and we'd lose the tempo. Policy must
     * pick the Forest. */
    const guildgate = card({
      name: "Selesnya Guildgate", type_line: "Land — Gate",
      produced_mana: ["G", "W"],
      oracle_text: "Selesnya Guildgate enters tapped. {T}: Add {G} or {W}.",
    });
    const forest = card({
      name: "Forest", type_line: "Basic Land — Forest", produced_mana: ["G"], cmc: 0,
    });
    const elves = card({
      name: "Llanowar Elves", type_line: "Creature — Elf Druid", cmc: 1,
      mana_cost: "{G}", produced_mana: ["G"], oracle_text: "{T}: Add {G}.",
    });
    let t1Forest = 0;
    for (let seed = 1; seed < 50; seed++) {
      const deck = [guildgate, forest, elves];
      // Pad to 7+ cards with high-cmc fillers so they don't compete for T1.
      const filler = card({ name: "F", type_line: "Sorcery", cmc: 9, mana_cost: "{9}" });
      const padded = deck.concat(Array(10).fill(filler));
      const run = simulateGame(padded, [], { seed, onPlay: true });
      if (run.turns[0].playedLand?.name === "Forest") t1Forest++;
    }
    expect(t1Forest).toBeGreaterThan(0);
  });
});

describe("runSimulations", () => {
  it("returns stat shape", () => {
    const stats = runSimulations(tinyDeck(), [], 50, { seed: 5 });
    expect(stats.runs).toBe(50);
    expect(stats.keepablePct).toBeGreaterThanOrEqual(0);
    expect(stats.keepablePct).toBeLessThanOrEqual(1);
    expect(stats.avgSpellsByTurn).toHaveLength(8);  // indices 0..7
    expect(stats.avgManaByTurn).toHaveLength(8);
  });
  it("commanderAvgTurn is null when no commander is given", () => {
    const stats = runSimulations(tinyDeck(), [], 20, { seed: 11 });
    expect(stats.commanderAvgTurn).toBeNull();
    expect(stats.commanderCastPct).toBe(0);
  });
});
