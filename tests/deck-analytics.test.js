import { describe, it, expect } from "vitest";
import {
  manaCurve, cardTypeBreakdown, primaryTypeOf, isLandCard,
  manaSources, creatureSubtypes, subtypesOf,
  extractTokenIds, dedupeByOracle, gameChangers, bracketEstimate,
  detectThemes,
} from "../js/deck-analytics.js";

const card = (overrides = {}) => ({
  name: "X", cmc: 0, type_line: "Creature — Human",
  produced_mana: [], all_parts: undefined, game_changer: false,
  ...overrides,
});

describe("primaryTypeOf", () => {
  it("returns Land for any card whose type_line mentions Land", () => {
    expect(primaryTypeOf({ type_line: "Basic Land — Forest" })).toBe("Land");
    expect(primaryTypeOf({ type_line: "Land — Island Swamp" })).toBe("Land");
  });
  it("Creature wins over Artifact for hybrid types", () => {
    expect(primaryTypeOf({ type_line: "Artifact Creature — Golem" })).toBe("Creature");
  });
  it("identifies each primary type", () => {
    for (const [tl, expected] of [
      ["Instant", "Instant"],
      ["Sorcery", "Sorcery"],
      ["Enchantment — Aura", "Enchantment"],
      ["Planeswalker — Bolas", "Planeswalker"],
      ["Battle — Siege", "Battle"],
      ["Artifact", "Artifact"],
    ]) {
      expect(primaryTypeOf({ type_line: tl })).toBe(expected);
    }
  });
  it("returns null for unknown / missing type_line", () => {
    expect(primaryTypeOf({ type_line: "" })).toBeNull();
    expect(primaryTypeOf({})).toBeNull();
  });
});

describe("manaCurve", () => {
  it("counts spells by floored CMC, lands excluded", () => {
    const deck = [
      card({ cmc: 0 }),
      card({ cmc: 1 }), card({ cmc: 1 }),
      card({ cmc: 2 }),
      card({ cmc: 3.5 }),     // Floored to 3
      card({ cmc: 7 }),
      card({ cmc: 10 }),
      card({ type_line: "Basic Land — Forest", cmc: 0 }), // excluded
    ];
    expect(manaCurve(deck)).toEqual({
      0: 1, 1: 2, 2: 1, 3: 1, 4: 0, 5: 0, 6: 0, "7+": 2,
    });
  });
  it("treats missing cmc as 0", () => {
    expect(manaCurve([card({ cmc: undefined })])).toMatchObject({ 0: 1 });
  });
});

describe("cardTypeBreakdown", () => {
  it("buckets each card under its primary type", () => {
    const deck = [
      card({ type_line: "Creature — Bird" }),
      card({ type_line: "Creature — Wizard" }),
      card({ type_line: "Artifact" }),
      card({ type_line: "Sorcery" }),
      card({ type_line: "Basic Land — Forest" }),
      card({ type_line: "Basic Land — Plains" }),
      card({ type_line: "Land" }),
    ];
    const out = cardTypeBreakdown(deck);
    expect(out.Creature).toBe(2);
    expect(out.Artifact).toBe(1);
    expect(out.Sorcery).toBe(1);
    expect(out.Land).toBe(3);
    expect(out.Enchantment).toBe(0);
  });
});

describe("manaSources", () => {
  it("counts producers per colour, deduplicating same-card multi-symbols", () => {
    const deck = [
      card({ produced_mana: ["G"] }),                     // Forest
      card({ produced_mana: ["W", "U"] }),                // Hallowed Fountain
      card({ produced_mana: ["W", "U", "B", "R", "G"] }), // Command Tower
      card({ produced_mana: ["C"] }),                     // Sol Ring
    ];
    expect(manaSources(deck)).toEqual({
      W: 2, U: 2, B: 1, R: 1, G: 2, C: 1,
    });
  });
  it("ignores cards with no produced_mana", () => {
    expect(manaSources([card({ produced_mana: [] }), card({})]))
      .toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
  });
  it("ignores unknown mana symbols (S for snow, X, etc.)", () => {
    expect(manaSources([card({ produced_mana: ["S", "X", "G"] })]))
      .toMatchObject({ G: 1, W: 0 });
  });
});

describe("creatureSubtypes", () => {
  it("collects subtypes from creatures only", () => {
    const deck = [
      card({ type_line: "Creature — Human Wizard" }),
      card({ type_line: "Creature — Human Cleric" }),
      card({ type_line: "Creature — Goblin" }),
      card({ type_line: "Sorcery" }),                  // ignored
    ];
    const out = creatureSubtypes(deck);
    const map = Object.fromEntries(out.map((e) => [e.subtype, e.count]));
    expect(map.Human).toBe(2);
    expect(map.Wizard).toBe(1);
    expect(map.Cleric).toBe(1);
    expect(map.Goblin).toBe(1);
  });
  it("sorts by count desc, alpha asc on ties", () => {
    const deck = [
      card({ type_line: "Creature — Wizard" }),
      card({ type_line: "Creature — Wizard" }),
      card({ type_line: "Creature — Cleric" }),
      card({ type_line: "Creature — Bard" }),
    ];
    const out = creatureSubtypes(deck).map((e) => e.subtype);
    expect(out).toEqual(["Wizard", "Bard", "Cleric"]);
  });
  it("collapses the long tail into 'Autres'", () => {
    const deck = [];
    for (const t of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
      deck.push(card({ type_line: `Creature — ${t}` }));
    }
    const out = creatureSubtypes(deck, 3);
    expect(out.map((e) => e.subtype)).toEqual(["A", "B", "C", "Autres"]);
    expect(out[3].count).toBe(7);
  });
  it("handles ASCII '--' as a fallback for the em-dash separator", () => {
    expect(subtypesOf({ type_line: "Creature -- Human Wizard" }))
      .toEqual(["Human", "Wizard"]);
  });
});

describe("extractTokenIds", () => {
  const part = (component, id, name) => ({
    object: "related_card", component, id, name, type_line: "Token Creature",
  });

  it("collects unique token IDs across the deck", () => {
    const deck = [
      card({ all_parts: [part("token", "abc", "Goblin")] }),
      card({ all_parts: [part("token", "abc", "Goblin")] }), // dup
      card({ all_parts: [part("token", "def", "Treasure")] }),
    ];
    expect(extractTokenIds(deck).sort()).toEqual(["abc", "def"]);
  });
  it("ignores non-token related cards (combo_piece, meld_part)", () => {
    const deck = [
      card({ all_parts: [
        part("combo_piece", "x", "Krenko"),
        part("token", "y", "Goblin"),
        part("meld_part", "z", "Brisela A"),
      ]}),
    ];
    expect(extractTokenIds(deck)).toEqual(["y"]);
  });
  it("handles cards with no all_parts gracefully", () => {
    expect(extractTokenIds([card({}), card({ all_parts: null })])).toEqual([]);
  });
});

describe("dedupeByOracle", () => {
  it("collapses cards sharing oracle_id, keeps the first", () => {
    const a = { name: "Zombie", oracle_id: "z1", id: "p1", set: "cmd" };
    const b = { name: "Zombie", oracle_id: "z1", id: "p2", set: "lea" };
    const c = { name: "Goblin", oracle_id: "g1", id: "p3" };
    expect(dedupeByOracle([a, b, c])).toEqual([a, c]);
  });

  it("keeps cards with distinct oracle_ids even when names match", () => {
    // Two different "Spirit" tokens (different power/toughness across
    // sets) have distinct oracle_ids and should NOT be merged.
    const a = { name: "Spirit", oracle_id: "spirit-1-1-flying", id: "p1" };
    const b = { name: "Spirit", oracle_id: "spirit-2-2", id: "p2" };
    expect(dedupeByOracle([a, b])).toHaveLength(2);
  });

  it("falls back to id when oracle_id is missing", () => {
    const a = { name: "X", id: "i1" };
    const b = { name: "X", id: "i1" };
    expect(dedupeByOracle([a, b])).toHaveLength(1);
  });

  it("falls back to name when both oracle_id and id are missing", () => {
    expect(dedupeByOracle([{ name: "X" }, { name: "X" }, { name: "Y" }]))
      .toHaveLength(2);
  });

  it("ignores entries with no usable identity (defensive)", () => {
    expect(dedupeByOracle([{}])).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeByOracle([])).toEqual([]);
  });
});

describe("gameChangers", () => {
  it("returns only cards flagged game_changer: true", () => {
    const deck = [
      card({ name: "Sol Ring" }),
      card({ name: "Smothering Tithe", game_changer: true }),
      card({ name: "Mana Drain", game_changer: true }),
      card({ name: "Forest" }),
    ];
    const out = gameChangers(deck).map((c) => c.name);
    expect(out).toEqual(["Smothering Tithe", "Mana Drain"]);
  });
  it("treats absent flag as false", () => {
    expect(gameChangers([card({ name: "X" })])).toEqual([]);
  });
});

describe("bracketEstimate", () => {
  const gc = (name) => card({ name, game_changer: true });

  it("0 game-changers → minBracket 1 (Exhibition / Core)", () => {
    const out = bracketEstimate([card({}), card({})]);
    expect(out.gameChangerCount).toBe(0);
    expect(out.minBracket).toBe(1);
    expect(out.label).toMatch(/Exhibition/);
  });

  it("1–3 game-changers → minBracket 3 (Upgraded)", () => {
    const out = bracketEstimate([gc("A"), gc("B"), gc("C"), card({})]);
    expect(out.gameChangerCount).toBe(3);
    expect(out.minBracket).toBe(3);
    expect(out.label).toMatch(/Upgraded/);
  });

  it("4–7 game-changers → minBracket 4 (Optimisé)", () => {
    const deck = ["A","B","C","D","E"].map(gc);
    const out = bracketEstimate(deck);
    expect(out.minBracket).toBe(4);
    expect(out.label).toMatch(/Optimisé/);
  });

  it("8+ game-changers → minBracket 4 (Optimisé / cEDH range)", () => {
    const deck = ["A","B","C","D","E","F","G","H","I"].map(gc);
    const out = bracketEstimate(deck);
    expect(out.minBracket).toBe(4);
    expect(out.label).toMatch(/cEDH/);
  });

  it("always carries the methodology disclaimer", () => {
    expect(bracketEstimate([]).note).toMatch(/mass land destruction/i);
  });
});

describe("isLandCard", () => {
  it("matches Land in type_line", () => {
    expect(isLandCard({ type_line: "Basic Land — Forest" })).toBe(true);
  });
  it("returns false for non-lands", () => {
    expect(isLandCard({ type_line: "Creature — Bird" })).toBe(false);
    expect(isLandCard({})).toBe(false);
  });
});

describe("detectThemes", () => {
  const oracle = (text, extras = {}) => card({ oracle_text: text, ...extras });

  it("detects a graveyard theme above its threshold", () => {
    const deck = Array.from({ length: 6 }, (_, i) =>
      oracle(`Return ${i} target creature card from your graveyard to your hand.`));
    const themes = detectThemes(deck);
    expect(themes.find((t) => t.key === "graveyard")).toMatchObject({ count: 6 });
  });

  it("detects token production", () => {
    const deck = Array.from({ length: 5 }, () =>
      oracle("Create a 1/1 white Soldier creature token."));
    expect(detectThemes(deck).find((t) => t.key === "tokens")).toMatchObject({ count: 5 });
  });

  it("detects +1/+1 counter theme", () => {
    const deck = Array.from({ length: 6 }, () =>
      oracle("Put a +1/+1 counter on target creature."));
    expect(detectThemes(deck).find((t) => t.key === "counters")).toMatchObject({ count: 6 });
  });

  it("detects sacrifice / aristocrats theme", () => {
    const deck = Array.from({ length: 5 }, () =>
      oracle("Sacrifice a creature: draw a card."));
    expect(detectThemes(deck).find((t) => t.key === "sacrifice")).toMatchObject({ count: 5 });
  });

  it("detects spellslinger theme", () => {
    const deck = Array.from({ length: 6 }, () =>
      oracle("Whenever you cast an instant or sorcery spell, draw a card."));
    expect(detectThemes(deck).find((t) => t.key === "spellslinger")).toBeDefined();
  });

  it("detects evasion theme", () => {
    const deck = Array.from({ length: 9 }, () =>
      oracle("This creature can't be blocked."));
    expect(detectThemes(deck).find((t) => t.key === "evasion")).toMatchObject({ count: 9 });
  });

  it("detects combat-damage triggers", () => {
    const deck = Array.from({ length: 5 }, () =>
      oracle("Whenever this deals combat damage to a player, draw a card."));
    expect(detectThemes(deck).find((t) => t.key === "combat-triggers")).toBeDefined();
  });

  it("flags tribal when ≥40% of creatures share a subtype (8+ creatures)", () => {
    const deck = [
      ...Array.from({ length: 5 }, () => card({ type_line: "Creature — Goblin" })),
      ...Array.from({ length: 5 }, () => card({ type_line: "Creature — Bear" })),
    ];
    const themes = detectThemes(deck);
    const tribal = themes.find((t) => t.key === "tribal");
    expect(tribal).toBeDefined();
    expect(tribal.label).toMatch(/Goblin|Bear/);
  });

  it("does NOT flag tribal when no subtype dominates", () => {
    const deck = [
      ...Array.from({ length: 3 }, () => card({ type_line: "Creature — Goblin" })),
      ...Array.from({ length: 3 }, () => card({ type_line: "Creature — Bear" })),
      ...Array.from({ length: 3 }, () => card({ type_line: "Creature — Wizard" })),
    ];
    expect(detectThemes(deck).find((t) => t.key === "tribal")).toBeUndefined();
  });

  it("does NOT flag tribal under the 8-creature minimum", () => {
    const deck = Array.from({ length: 5 }, () => card({ type_line: "Creature — Goblin" }));
    expect(detectThemes(deck).find((t) => t.key === "tribal")).toBeUndefined();
  });

  it("themes are sorted by count descending", () => {
    const deck = [
      ...Array.from({ length: 8 }, () => oracle("This creature can't be blocked.")),
      ...Array.from({ length: 6 }, () => oracle("Return target card from your graveyard.")),
    ];
    const out = detectThemes(deck);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].count >= out[i].count).toBe(true);
  });

  it("returns [] for a deck with no detectable themes", () => {
    expect(detectThemes([card({ oracle_text: "Vanilla 2/2 with no abilities." })])).toEqual([]);
  });

  // ----- Reliability migration to card.keywords -----

  it("evasion: counts cards with Flying in card.keywords", () => {
    const deck = Array.from({ length: 8 }, () =>
      card({ type_line: "Creature — Bird", keywords: ["Flying"], oracle_text: "" }));
    expect(detectThemes(deck).find((t) => t.key === "evasion")).toMatchObject({ count: 8 });
  });

  it("evasion: counts mixed keyword set (Menace, Trample, Shadow)", () => {
    const deck = [
      ...Array.from({ length: 3 }, () => card({ type_line: "Creature — Orc", keywords: ["Menace"] })),
      ...Array.from({ length: 3 }, () => card({ type_line: "Creature — Beast", keywords: ["Trample"] })),
      ...Array.from({ length: 2 }, () => card({ type_line: "Creature — Spirit", keywords: ["Shadow"] })),
    ];
    expect(detectThemes(deck).find((t) => t.key === "evasion")).toMatchObject({ count: 8 });
  });

  it("evasion: regression — does NOT count anti-evasion removal", () => {
    /* Plummet ("Destroy target creature with flying") has Flying in
     * its oracle_text but NOT in its own keywords. The old text-only
     * heuristic would over-count cards like this. */
    const deck = Array.from({ length: 8 }, () => card({
      type_line: "Instant",
      keywords: [],
      oracle_text: "Destroy target creature with flying.",
    }));
    expect(detectThemes(deck).find((t) => t.key === "evasion")).toBeUndefined();
  });

  it("evasion: regression — does NOT count equipment that grants flying", () => {
    /* Cyclone Sire-style equipment: oracle_text mentions flying but
     * the equipment itself doesn't have Flying. */
    const deck = Array.from({ length: 8 }, () => card({
      type_line: "Artifact — Equipment",
      keywords: [],
      oracle_text: "Equipped creature has flying. Equip {2}.",
    }));
    expect(detectThemes(deck).find((t) => t.key === "evasion")).toBeUndefined();
  });

  it("evasion: 'can't be blocked' counts only on creatures", () => {
    /* The text-only fallback is gated on type — equipment granting
     * unblockability is not the deck's evasion theme. */
    const creatures = Array.from({ length: 8 }, () => oracle("This creature can't be blocked."));
    expect(detectThemes(creatures).find((t) => t.key === "evasion")).toMatchObject({ count: 8 });

    const equipments = Array.from({ length: 8 }, () => card({
      type_line: "Artifact — Equipment",
      oracle_text: "Equipped creature can't be blocked.",
    }));
    expect(detectThemes(equipments).find((t) => t.key === "evasion")).toBeUndefined();
  });

  it("spellslinger: counts cards with Prowess in card.keywords", () => {
    const deck = Array.from({ length: 6 }, () =>
      card({ type_line: "Creature — Monk", keywords: ["Prowess"], oracle_text: "" }));
    expect(detectThemes(deck).find((t) => t.key === "spellslinger")).toBeDefined();
  });

  it("spellslinger: keyword path catches Magecraft / Storm", () => {
    const deck = [
      ...Array.from({ length: 3 }, () => card({ keywords: ["Magecraft"], oracle_text: "" })),
      ...Array.from({ length: 3 }, () => card({ keywords: ["Storm"], oracle_text: "" })),
    ];
    expect(detectThemes(deck).find((t) => t.key === "spellslinger")).toMatchObject({ count: 6 });
  });

  it("counters: keyword path catches Modular without explicit '+1/+1 counter' text", () => {
    /* Defensive: if Scryfall ever ships a card with the Modular
     * keyword but reminder text stripped, the keyword check still
     * fires it into the counters theme. */
    const deck = Array.from({ length: 6 }, () =>
      card({ type_line: "Artifact Creature — Construct", keywords: ["Modular"], oracle_text: "" }));
    expect(detectThemes(deck).find((t) => t.key === "counters")).toMatchObject({ count: 6 });
  });

  // ----- Improved regex coverage -----

  it("graveyard: catches mill verbs ('Mill three.')", () => {
    const deck = Array.from({ length: 6 }, () => oracle("Mill three cards."));
    expect(detectThemes(deck).find((t) => t.key === "graveyard")).toMatchObject({ count: 6 });
  });

  it("tokens: catches long token templates (>40 char descriptor)", () => {
    /* The previous {0,40} window missed templates this long. The
     * widened window covers everything Scryfall actually prints. */
    const deck = Array.from({ length: 4 }, () => oracle(
      "Create a tapped 2/2 black Zombie creature token with menace and lifelink.",
    ));
    expect(detectThemes(deck).find((t) => t.key === "tokens")).toMatchObject({ count: 4 });
  });

  // ----- Lifegain -----

  it("lifegain: detects Lifelink keyword cards", () => {
    const deck = Array.from({ length: 5 }, () =>
      card({ type_line: "Creature — Cat", keywords: ["Lifelink"], oracle_text: "" }));
    expect(detectThemes(deck).find((t) => t.key === "lifegain")).toMatchObject({ count: 5 });
  });

  it("lifegain: detects 'gain N life' / 'gains life' phrasing", () => {
    const deck = [
      oracle("You gain 2 life."),
      oracle("Whenever a creature you control deals damage, you gain 1 life."),
      oracle("Target player gains 4 life."),
      oracle("You gain life equal to its toughness."),
      oracle("Whenever you gain life, draw a card."),
    ];
    expect(detectThemes(deck).find((t) => t.key === "lifegain")).toMatchObject({ count: 5 });
  });

  it("lifegain: does NOT count 'pay N life' or 'lose life'", () => {
    const deck = Array.from({ length: 5 }, () => oracle("As an additional cost, pay 2 life."));
    expect(detectThemes(deck).find((t) => t.key === "lifegain")).toBeUndefined();
  });

  // ----- Card draw -----

  it("card-draw: detects 'draw a card', 'draws N cards', 'draws that many cards'", () => {
    const deck = [
      oracle("Draw a card."),
      oracle("Draw three cards."),
      oracle("Target player draws X cards."),
      oracle("You draw that many cards."),
      oracle("Whenever this attacks, you draw a card."),
      oracle("Draw two cards, then discard one."),
      oracle("Each opponent draws a card."),
      oracle("Draws a card whenever a creature dies."),
    ];
    expect(detectThemes(deck).find((t) => t.key === "card-draw")).toMatchObject({ count: 8 });
  });

  it("card-draw: respects the high threshold (8 — every deck has some draw)", () => {
    // 5 draw cards in a deck don't make it a draw-themed deck.
    const deck = Array.from({ length: 5 }, () => oracle("Draw a card."));
    expect(detectThemes(deck).find((t) => t.key === "card-draw")).toBeUndefined();
  });

  // ----- Discard -----

  it("discard: detects 'discard a card' / 'discards N cards'", () => {
    const deck = [
      oracle("Target player discards a card."),
      oracle("Discard your hand, then draw seven cards."),
      oracle("Each opponent discards two cards."),
      oracle("Discard a card: this gains +1/+1 until end of turn."),
    ];
    expect(detectThemes(deck).find((t) => t.key === "discard")).toMatchObject({ count: 4 });
  });

  it("discard: detects Madness and Hellbent keywords", () => {
    const deck = [
      ...Array.from({ length: 2 }, () => card({ keywords: ["Madness"], oracle_text: "" })),
      ...Array.from({ length: 2 }, () => card({ keywords: ["Hellbent"], oracle_text: "" })),
    ];
    expect(detectThemes(deck).find((t) => t.key === "discard")).toMatchObject({ count: 4 });
  });

  // ----- Ramp -----

  it("ramp: detects non-land cards with produced_mana", () => {
    const deck = [
      card({ name: "Sol Ring", type_line: "Artifact", produced_mana: ["C"], oracle_text: "" }),
      card({ name: "Birds of Paradise", type_line: "Creature — Bird", produced_mana: ["W","U","B","R","G"], oracle_text: "" }),
      card({ name: "Llanowar Elves", type_line: "Creature — Elf Druid", produced_mana: ["G"], oracle_text: "" }),
      card({ name: "Arcane Signet", type_line: "Artifact", produced_mana: ["C"], oracle_text: "" }),
      card({ name: "Talisman", type_line: "Artifact", produced_mana: ["B","G"], oracle_text: "" }),
      card({ name: "Sylvan Caryatid", type_line: "Creature — Plant", produced_mana: ["W","U","B","R","G"], oracle_text: "" }),
      card({ name: "Mana Vault", type_line: "Artifact", produced_mana: ["C"], oracle_text: "" }),
      card({ name: "Selesnya Signet", type_line: "Artifact", produced_mana: ["W","G"], oracle_text: "" }),
    ];
    expect(detectThemes(deck).find((t) => t.key === "ramp")).toMatchObject({ count: 8 });
  });

  it("ramp: detects land-tutor / basic-search effects", () => {
    const deck = Array.from({ length: 8 }, () => oracle(
      "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
    ));
    expect(detectThemes(deck).find((t) => t.key === "ramp")).toMatchObject({ count: 8 });
  });

  it("ramp: detects Forest-search (Wood Elves-style)", () => {
    const deck = Array.from({ length: 8 }, () => oracle(
      "Search your library for a Forest card, put it onto the battlefield, then shuffle.",
    ));
    expect(detectThemes(deck).find((t) => t.key === "ramp")).toMatchObject({ count: 8 });
  });

  it("ramp: detects Treasure-token producers", () => {
    const deck = Array.from({ length: 8 }, () => oracle(
      "Create three Treasure tokens.",
    ));
    expect(detectThemes(deck).find((t) => t.key === "ramp")).toMatchObject({ count: 8 });
  });

  it("ramp: regression — basic lands themselves are NOT counted as ramp", () => {
    /* A basic land has produced_mana but is a Land — must be excluded
     * or every EDH deck flags ramp with 36+ basics. */
    const deck = Array.from({ length: 10 }, () => card({
      name: "Forest", type_line: "Basic Land — Forest",
      produced_mana: ["G"], oracle_text: "",
    }));
    expect(detectThemes(deck).find((t) => t.key === "ramp")).toBeUndefined();
  });

  it("ramp: respects the high threshold (under 8 doesn't flag the theme)", () => {
    const deck = Array.from({ length: 5 }, () =>
      card({ type_line: "Artifact", produced_mana: ["C"], oracle_text: "" }));
    expect(detectThemes(deck).find((t) => t.key === "ramp")).toBeUndefined();
  });

  it("sacrifice: catches 'sacrifice each' and 'sacrifice all'", () => {
    const deck = [
      oracle("Each player sacrifices each creature they control."),
      oracle("Sacrifice all artifacts."),
      oracle("Sacrifice another creature: draw a card."),
      oracle("As an additional cost, sacrifice a land."),
    ];
    expect(detectThemes(deck).find((t) => t.key === "sacrifice")).toMatchObject({ count: 4 });
  });
});
