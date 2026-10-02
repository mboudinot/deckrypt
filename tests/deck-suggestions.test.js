import { describe, it, expect } from "vitest";
import {
  isCommanderFormat, deckFormatOf,
  countLands, countRamp, countDraw,
  countInteraction, countBoardWipes, averageCmcOfSpells,
  isRampCard, isDrawCard, isInteractionCard, isBoardWipe,
  singletonViolations, colorIdentityIssues,
  commanderLegalityIssues, invalidCommanders, commanderRuleChecks,
  suggestions,
} from "../js/deck-suggestions.js";

const card = (overrides = {}) => ({
  name: "X",
  type_line: "Creature — Human",
  cmc: 1,
  produced_mana: [],
  oracle_text: "",
  ...overrides,
});

const land = (name = "Forest") => card({
  name, type_line: "Basic Land — Forest",
  produced_mana: ["G"],
});

describe("deckFormatOf", () => {
  it("trusts an explicit format on the deck definition", () => {
    expect(deckFormatOf({
      def: { format: "commander" }, commanders: [], deck: [],
    })).toBe("commander");
    expect(deckFormatOf({
      def: { format: "limited" }, commanders: [], deck: [],
    })).toBe("limited");
  });

  it("ignores unknown explicit format values (falls through to size)", () => {
    const r = {
      def: { format: "Modern" /* bogus */ },
      commanders: Array.from({ length: 1 }, () => ({})),
      deck: Array.from({ length: 99 }, () => ({})),
    };
    expect(deckFormatOf(r)).toBe("commander"); // 100-card → commander
  });

  it("size-based fallback: 90–110 cards is Commander", () => {
    const r = { commanders: [], deck: Array.from({ length: 100 }, () => ({})) };
    expect(deckFormatOf(r)).toBe("commander");
  });

  it("size-based fallback: 40–70 cards is limited", () => {
    expect(deckFormatOf({ commanders: [], deck: Array.from({ length: 40 }, () => ({})) }))
      .toBe("limited");
    expect(deckFormatOf({ commanders: [], deck: Array.from({ length: 60 }, () => ({})) }))
      .toBe("limited");
  });

  it("returns 'unknown' for sizes outside any known band", () => {
    expect(deckFormatOf({ commanders: [], deck: Array.from({ length: 5 }, () => ({})) }))
      .toBe("unknown");
    expect(deckFormatOf({ commanders: [], deck: Array.from({ length: 200 }, () => ({})) }))
      .toBe("unknown");
  });

  it("returns 'unknown' for null / empty input", () => {
    expect(deckFormatOf(null)).toBe("unknown");
    expect(deckFormatOf({})).toBe("unknown");
  });
});

describe("suggestions respects explicit format", () => {
  it("a 100-card deck flagged as 'limited' gets info-only suggestions", () => {
    const cards = Array.from({ length: 99 }, () => ({
      name: "X", cmc: 0, type_line: "Creature",
    }));
    const out = suggestions({
      def: { format: "limited" },
      commanders: [], deck: cards,
    });
    // Without explicit format the size would say Commander, so all
    // counters would have targets. With explicit limited, they're info-only.
    expect(out.every((s) => s.status === "info")).toBe(true);
    expect(out.every((s) => s.target === null)).toBe(true);
  });
});

describe("isCommanderFormat", () => {
  it("treats 90–110 cards as Commander", () => {
    expect(isCommanderFormat(Array.from({ length: 100 }, () => card()))).toBe(true);
    expect(isCommanderFormat(Array.from({ length: 90 }, () => card()))).toBe(true);
    expect(isCommanderFormat(Array.from({ length: 110 }, () => card()))).toBe(true);
  });
  it("everything else is non-Commander", () => {
    expect(isCommanderFormat(Array.from({ length: 60 }, () => card()))).toBe(false);
    expect(isCommanderFormat(Array.from({ length: 89 }, () => card()))).toBe(false);
    expect(isCommanderFormat(Array.from({ length: 200 }, () => card()))).toBe(false);
  });
});

describe("countLands", () => {
  it("counts cards whose type_line mentions Land", () => {
    const cards = [
      card({ type_line: "Basic Land — Forest" }),
      card({ type_line: "Land — Island Swamp" }),
      card({ type_line: "Creature — Bird" }),
      card({ type_line: "Artifact" }),
    ];
    expect(countLands(cards)).toBe(2);
  });
});

describe("isRampCard", () => {
  it("flags non-land permanents that produce mana (mana rocks)", () => {
    expect(isRampCard(card({
      name: "Sol Ring", type_line: "Artifact",
      produced_mana: ["C"],
    }))).toBe(true);
  });

  it("flags mana dorks", () => {
    expect(isRampCard(card({
      name: "Llanowar Elves",
      type_line: "Creature — Elf Druid",
      produced_mana: ["G"],
    }))).toBe(true);
  });

  it("flags land tutors via oracle text (Cultivate-style)", () => {
    expect(isRampCard(card({
      name: "Cultivate",
      type_line: "Sorcery",
      oracle_text: "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
    }))).toBe(true);
  });

  it("doesn't count a land tutor that only goes to hand", () => {
    expect(isRampCard(card({
      name: "Lay of the Land", type_line: "Sorcery",
      oracle_text: "Search your library for a basic land card, reveal it, put it into your hand, then shuffle.",
    }))).toBe(false);
  });

  it("doesn't count a spell // land MDFC as ramp (its mana is the land side's)", () => {
    expect(isRampCard(card({
      name: "Sea Gate Restoration", layout: "modal_dfc", type_line: "Sorcery // Land",
      produced_mana: ["U"],
    }))).toBe(false);
  });

  it("flags Three-Visits-style fetches that name basic types but not 'land'", () => {
    expect(isRampCard(card({
      name: "Three Visits",
      type_line: "Sorcery",
      oracle_text: "Search your library for a Forest or Plains card and put it onto the battlefield.",
    }))).toBe(true);
  });

  it("does not flag plain creatures with no mana production", () => {
    expect(isRampCard(card({
      name: "Bear", type_line: "Creature — Bear",
    }))).toBe(false);
  });

  it("does not count actual lands as ramp", () => {
    expect(isRampCard(land())).toBe(false);
  });
});

describe("isDrawCard", () => {
  it("flags 'draw a card'", () => {
    expect(isDrawCard(card({ oracle_text: "When ~ enters, draw a card." })).valueOf()).toBe(true);
  });
  it("flags 'draws X cards' for any quantifier", () => {
    expect(isDrawCard(card({ oracle_text: "Target player draws three cards." }))).toBe(true);
    expect(isDrawCard(card({ oracle_text: "You draw two cards." }))).toBe(true);
  });
  it("does not flag cards with no oracle text", () => {
    expect(isDrawCard(card({ oracle_text: "" }))).toBe(false);
  });
  it("does not count lands", () => {
    expect(isDrawCard(land())).toBe(false);
  });
});

describe("isInteractionCard", () => {
  it("flags single-target removal", () => {
    expect(isInteractionCard(card({ oracle_text: "Destroy target creature." }))).toBe(true);
    expect(isInteractionCard(card({ oracle_text: "Exile target permanent." }))).toBe(true);
  });
  it("flags counterspells", () => {
    expect(isInteractionCard(card({ oracle_text: "Counter target spell." }))).toBe(true);
  });
  it("flags bounce (return target to hand)", () => {
    expect(isInteractionCard(card({
      oracle_text: "Return target creature to its owner's hand.",
    }))).toBe(true);
  });
  it("does NOT flag board wipes (they have their own counter)", () => {
    expect(isInteractionCard(card({
      oracle_text: "Destroy all creatures.",
    }))).toBe(false);
  });
  it("does not flag random non-interaction cards", () => {
    expect(isInteractionCard(card({ oracle_text: "Draw two cards." }))).toBe(false);
  });

  it.each([
    ["Lightning Bolt", "Lightning Bolt deals 3 damage to any target."],
    ["Dismember", "Target creature gets -5/-5 until end of turn."],
    ["Rabid Bite", "Target creature you control deals damage equal to its power to target creature you don't control."],
    ["Prey Upon", "Target creature you control fights target creature you don't control."],
    ["Diabolic Edict", "Target player sacrifices a creature of their choice."],
    ["Accursed Marauder", "When this creature enters, each player sacrifices a nontoken creature of their choice."],
    ["Control Magic", "Enchant creature\nYou control enchanted creature."],
    ["Condemn", "Put target attacking creature on the bottom of its owner's library. Its controller gains life equal to its toughness."],
    ["Chaos Warp", "The owner of target permanent shuffles it into their library, then reveals the top card of their library."],
    ["Naturalize", "Destroy target artifact or enchantment."],
    ["Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power."],
  ])("flags %s", (_name, text) => {
    expect(isInteractionCard(card({ oracle_text: text }))).toBe(true);
  });

  it.each([
    ["Ephemerate (self-blink)", "Exile target creature you control, then return it to the battlefield under its owner's control."],
    ["graveyard hate", "Exile target card from a graveyard."],
    ["self-bounce", "Return target creature you control to its owner's hand."],
    ["Act of Treason (temporary steal)", "Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn."],
    ["1-damage ping", "Deals 1 damage to any target."],
    ["sacrifice as a cost", "As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards."],
  ])("doesn't flag %s", (_name, text) => {
    expect(isInteractionCard(card({ oracle_text: text }))).toBe(false);
  });

  it("keeps a real answer even when an earlier clause targets your own stuff", () => {
    expect(isInteractionCard(card({
      oracle_text: "Exile target creature you control. Exile target creature an opponent controls.",
    }))).toBe(true);
  });
});

describe("isBoardWipe", () => {
  it("flags 'destroy all creatures'", () => {
    expect(isBoardWipe(card({ oracle_text: "Destroy all creatures." }))).toBe(true);
  });
  it("flags 'exile all permanents'", () => {
    expect(isBoardWipe(card({ oracle_text: "Exile all permanents." }))).toBe(true);
  });
  it("flags 'destroy each creature'", () => {
    expect(isBoardWipe(card({ oracle_text: "Destroy each creature." }))).toBe(true);
  });
  it("flags mass -X/-X effects", () => {
    expect(isBoardWipe(card({
      oracle_text: "All creatures get -3/-3 until end of turn.",
    }))).toBe(true);
  });
  it("doesn't flag single-target removal", () => {
    expect(isBoardWipe(card({ oracle_text: "Destroy target creature." }))).toBe(false);
  });

  it("reads every face of a multi-face card (omen / adventure)", () => {
    // Scavenger Regent // Exude Toxin — no top-level oracle_text.
    const regent = card({
      oracle_text: undefined,
      type_line: "Creature — Dragon // Sorcery — Omen",
      card_faces: [
        { oracle_text: "Flying\nWard—Discard a card." },
        { oracle_text: "Each non-Dragon creature gets -X/-X until end of turn. (Then shuffle this card into its owner's library.)" },
      ],
    });
    expect(isBoardWipe(regent)).toBe(true);
  });

  it.each([
    ["Toxic Deluge", "As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn."],
    ["Crux of Fate", "Choose one —\n• Destroy all Dragon creatures.\n• Destroy all non-Dragon creatures."],
    ["Settle the Wreckage", "Exile all attacking creatures target player controls. That player may search their library for that many basic land cards."],
    ["Blasphemous Act", "This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature."],
    ["Anger of the Gods", "Anger of the Gods deals 3 damage to each creature. If a creature dealt damage this way would die this turn, exile it instead."],
    ["Earthquake", "Earthquake deals X damage to each creature without flying and each player."],
    ["Evacuation", "Return all creatures to their owners' hands."],
    ["Aetherize", "Return all attacking creatures to their owner's hand."],
    ["All Is Dust", "Each player sacrifices all permanents they control that are one or more colors."],
    ["Massacre Wurm", "When this creature enters, creatures your opponents control get -2/-2 until end of turn."],
    ["Cyclonic Rift", "Return target nonland permanent you don't control to its owner's hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change \"target\" in its text to \"each.\")"],
  ])("flags %s", (_name, text) => {
    expect(isBoardWipe(card({ oracle_text: text }))).toBe(true);
  });

  it.each([
    ["1-damage ping", "When this creature enters, it deals 1 damage to each other creature with flying your opponents control."],
    ["graveyard hate", "Exile all creature cards from all graveyards."],
    ["non-lethal shrink", "Creatures your opponents control get -1/-0 until end of turn."],
    ["artifact-only sweeper", "Destroy all artifacts."],
    ["anthem", "All creatures you control get +1/+1."],
    ["1-damage overload", "Electrickery deals 1 damage to target creature you don't control.\nOverload {1}{R}"],
  ])("doesn't flag %s", (_name, text) => {
    expect(isBoardWipe(card({ oracle_text: text }))).toBe(false);
  });
});

describe("averageCmcOfSpells", () => {
  it("averages CMC across non-lands only", () => {
    const cards = [
      card({ cmc: 2 }), card({ cmc: 4 }),
      card({ cmc: 0, type_line: "Basic Land — Forest" }), // excluded
    ];
    expect(averageCmcOfSpells(cards)).toBe(3);
  });
  it("returns 0 when there are no spells", () => {
    expect(averageCmcOfSpells([land(), land()])).toBe(0);
  });
});

describe("singletonViolations", () => {
  it("flags any non-basic card present more than once", () => {
    const deck = [
      card({ name: "Sol Ring" }),
      card({ name: "Sol Ring" }),
      card({ name: "Counterspell" }),
      card({ name: "Forest", type_line: "Basic Land — Forest" }),
      card({ name: "Forest", type_line: "Basic Land — Forest" }),
    ];
    const out = singletonViolations(deck);
    expect(out).toEqual([{ name: "Sol Ring", qty: 2 }]);
  });
  it("ignores Snow-Covered basics", () => {
    const deck = Array.from({ length: 10 }, () => card({
      name: "Snow-Covered Forest", type_line: "Basic Snow Land — Forest",
    }));
    expect(singletonViolations(deck)).toEqual([]);
  });
});

describe("colorIdentityIssues", () => {
  it("flags cards whose color_identity falls outside the commander's", () => {
    const resolved = {
      commanders: [{ name: "Cmdr", color_identity: ["U", "G"] }],
      deck: [
        { name: "Counterspell", color_identity: ["U"] },
        { name: "Lightning Bolt", color_identity: ["R"] },          // off
        { name: "Llanowar Elves", color_identity: ["G"] },
        { name: "Wrath of God", color_identity: ["W"] },            // off
      ],
    };
    expect(colorIdentityIssues(resolved).sort()).toEqual(["Lightning Bolt", "Wrath of God"]);
  });

  it("returns [] when every card matches the commander identity", () => {
    expect(colorIdentityIssues({
      commanders: [{ color_identity: ["U", "B"] }],
      deck: [{ color_identity: ["U"] }, { color_identity: ["B"] }, { color_identity: [] }],
    })).toEqual([]);
  });

  it("returns [] when the deck has no commander", () => {
    expect(colorIdentityIssues({ commanders: [], deck: [] })).toEqual([]);
  });

  it("dedupes off-color cards by name (one entry per name)", () => {
    const resolved = {
      commanders: [{ color_identity: ["U"] }],
      deck: [
        { name: "Lightning Bolt", color_identity: ["R"] },
        { name: "Lightning Bolt", color_identity: ["R"] },
      ],
    };
    expect(colorIdentityIssues(resolved)).toEqual(["Lightning Bolt"]);
  });
});

describe("commanderLegalityIssues", () => {
  it("collects cards flagged 'banned' in card.legalities.commander", () => {
    const deck = [
      { name: "Sol Ring", legalities: { commander: "legal" } },
      { name: "Mana Crypt", legalities: { commander: "banned" } },
      { name: "Worldly Tutor", legalities: { commander: "banned" } },
      { name: "Lightning Bolt", legalities: { commander: "legal" } },
    ];
    const out = commanderLegalityIssues(deck);
    expect(out.banned.sort()).toEqual(["Mana Crypt", "Worldly Tutor"]);
    expect(out.notLegal).toEqual([]);
  });

  it("separates 'not_legal' cards from banned ones", () => {
    const deck = [
      { name: "Shahrazad", legalities: { commander: "banned" } },
      { name: "Conspiracy Card", legalities: { commander: "not_legal" } },
      { name: "Silver Border Card", legalities: { commander: "not_legal" } },
    ];
    const out = commanderLegalityIssues(deck);
    expect(out.banned).toEqual(["Shahrazad"]);
    expect(out.notLegal.sort()).toEqual(["Conspiracy Card", "Silver Border Card"]);
  });

  it("treats cards without legalities data as legal (defensive default)", () => {
    const deck = [{ name: "Foo" }, { name: "Bar", legalities: {} }];
    const out = commanderLegalityIssues(deck);
    expect(out.banned).toEqual([]);
    expect(out.notLegal).toEqual([]);
  });

  it("dedupes by name so a 4-of banned card doesn't list four times", () => {
    const deck = [
      { name: "Mana Crypt", legalities: { commander: "banned" } },
      { name: "Mana Crypt", legalities: { commander: "banned" } },
      { name: "Mana Crypt", legalities: { commander: "banned" } },
    ];
    expect(commanderLegalityIssues(deck).banned).toEqual(["Mana Crypt"]);
  });
});

describe("invalidCommanders", () => {
  it("accepts Legendary Creatures", () => {
    const resolved = {
      commanders: [
        { name: "Atraxa", type_line: "Legendary Creature — Phyrexian Angel Horror" },
        { name: "Edgar Markov", type_line: "Legendary Creature — Vampire Knight" },
      ],
    };
    expect(invalidCommanders(resolved)).toEqual([]);
  });

  it("accepts Legendary Planeswalkers with the 'can be your commander' clause", () => {
    const resolved = {
      commanders: [{
        name: "Daretti, Scrap Savant",
        type_line: "Legendary Planeswalker — Daretti",
        oracle_text: "Daretti, Scrap Savant can be your commander.\n+2: …",
      }],
    };
    expect(invalidCommanders(resolved)).toEqual([]);
  });

  it("rejects Planeswalkers without the commander clause", () => {
    const resolved = {
      commanders: [{
        name: "Jace, the Mind Sculptor",
        type_line: "Legendary Planeswalker — Jace",
        oracle_text: "+2: Look at the top card of target player's library…",
      }],
    };
    expect(invalidCommanders(resolved)).toEqual(["Jace, the Mind Sculptor"]);
  });

  it("rejects non-legendary creatures", () => {
    const resolved = {
      commanders: [{ name: "Grizzly Bears", type_line: "Creature — Bear" }],
    };
    expect(invalidCommanders(resolved)).toEqual(["Grizzly Bears"]);
  });

  it("rejects non-creature, non-planeswalker, non-background legendaries", () => {
    const resolved = {
      commanders: [{ name: "Karn's Bastion", type_line: "Land" }],
    };
    expect(invalidCommanders(resolved)).toEqual(["Karn's Bastion"]);
  });

  it("accepts Background enchantments (Baldur's Gate)", () => {
    const resolved = {
      commanders: [{
        name: "Cultist of the Absolute",
        type_line: "Legendary Enchantment — Background",
      }],
    };
    expect(invalidCommanders(resolved)).toEqual([]);
  });

  it("returns [] when no commanders are declared", () => {
    expect(invalidCommanders({ commanders: [] })).toEqual([]);
  });
});

describe("suggestions (Commander)", () => {
  function buildResolved({ lands = 36, rocks = 10, draws = 10, total = 99 } = {}) {
    const out = [];
    for (let i = 0; i < lands; i++) out.push(land(`L${i}`));
    for (let i = 0; i < rocks; i++) {
      out.push(card({
        name: `Rock${i}`, type_line: "Artifact",
        produced_mana: ["C"],
      }));
    }
    for (let i = 0; i < draws; i++) {
      out.push(card({
        name: `Draw${i}`, type_line: "Sorcery",
        oracle_text: "Draw a card.",
      }));
    }
    while (out.length < total) {
      out.push(card({ name: `Filler${out.length}`, type_line: "Creature — Bear" }));
    }
    return { commanders: [card({ name: "Cmdr", type_line: "Legendary Creature" })], deck: out };
  }

  it("a balanced 100-card deck reports all-OK", () => {
    const r = buildResolved({ lands: 36, rocks: 10, draws: 10, total: 99 });
    const out = suggestions(r);
    expect(out.find((s) => s.key === "lands").status).toBe("ok");
    expect(out.find((s) => s.key === "ramp").status).toBe("ok");
    expect(out.find((s) => s.key === "draw").status).toBe("ok");
  });

  it("counts spell // land MDFCs as land drops and says so in the label", () => {
    const r = buildResolved({ lands: 34, rocks: 10, draws: 10 });
    r.deck.push(card({ name: "Sea Gate Restoration", layout: "modal_dfc", type_line: "Sorcery // Land", produced_mana: ["U"] }));
    const lands = suggestions(r).find((s) => s.key === "lands");
    expect(lands.current).toBe(35);
    expect(lands.label).toBe("Terrains (dont 1 MDFC)");
  });

  it("lists the distinct cards behind each count", () => {
    const r = buildResolved({ lands: 0, rocks: 10, draws: 10 });
    r.deck.push(land("Forest"), land("Forest"), land("Island"));
    const lands = suggestions(r).find((s) => s.key === "lands");
    expect(lands.current).toBe(3);
    expect(lands.cards.map((c) => c.name)).toEqual(["Forest", "Island"]);
    expect(suggestions(r).find((s) => s.key === "draw").cards).toHaveLength(10);
  });

  it("has no card list for the average-CMC metric", () => {
    expect(suggestions(buildResolved()).find((s) => s.key === "avg-cmc").cards).toEqual([]);
  });

  it("flags low land count", () => {
    const r = buildResolved({ lands: 28, rocks: 10, draws: 10 });
    expect(suggestions(r).find((s) => s.key === "lands").status).toBe("low");
  });

  it("flags high ramp count", () => {
    const r = buildResolved({ lands: 36, rocks: 18, draws: 10 });
    expect(suggestions(r).find((s) => s.key === "ramp").status).toBe("high");
  });

  it("flags low draw count", () => {
    const r = buildResolved({ lands: 36, rocks: 10, draws: 3 });
    expect(suggestions(r).find((s) => s.key === "draw").status).toBe("low");
  });

  it("returns a status:info row when the deck isn't Commander-sized", () => {
    const r = { commanders: [], deck: Array.from({ length: 60 }, () => card()) };
    const out = suggestions(r);
    expect(out.every((s) => s.status === "info")).toBe(true);
    expect(out.every((s) => s.target === null)).toBe(true);
  });

  it("returns [] for a null / empty resolved input", () => {
    expect(suggestions(null)).toEqual([]);
    expect(suggestions({ commanders: [], deck: [] })).toEqual([]);
  });

  it("each suggestion carries a key, label, current count, status and advice", () => {
    const out = suggestions(buildResolved());
    for (const s of out) {
      expect(typeof s.key).toBe("string");
      expect(typeof s.label).toBe("string");
      expect(typeof s.current).toBe("number");
      expect(["ok", "low", "high", "info"]).toContain(s.status);
      expect(typeof s.advice).toBe("string");
    }
  });
});

describe("commanderRuleChecks", () => {
  const cmdr = { name: "Atraxa", type_line: "Legendary Creature — Angel", color_identity: ["W", "U", "B", "G"] };
  const clean = () => ({
    commanders: [cmdr],
    deck: Array.from({ length: 99 }, () => land("Forest")),
  });
  const byKey = (rules) => Object.fromEntries(rules.map((r) => [r.key, r]));

  it("returns the five rules in a stable order, all ok on a clean 1+99", () => {
    const rules = commanderRuleChecks(clean());
    expect(rules.map((r) => r.key)).toEqual(["count", "commander", "legality", "identity", "singleton"]);
    expect(rules.every((r) => r.severity === "ok")).toBe(true);
  });

  it("flags a deck without any commander as an error", () => {
    const r = clean();
    r.commanders = [];
    r.deck.push(land("Forest"));
    expect(byKey(commanderRuleChecks(r)).commander.severity).toBe("error");
  });

  it("reports the count delta and off-colour cards", () => {
    const r = clean();
    r.deck.pop();
    r.deck.pop();
    r.deck.push(card({ name: "Lightning Bolt", color_identity: ["R"] }));
    const rules = byKey(commanderRuleChecks(r));
    expect(rules.count.detail).toMatch(/1 manquante/);
    expect(rules.identity.severity).toBe("error");
    expect(rules.identity.detail).toMatch(/Lightning Bolt/);
  });

  it("treats non-basic duplicates as a warning, not an error", () => {
    const r = clean();
    r.deck.splice(0, 2, card({ name: "Sol Ring" }), card({ name: "Sol Ring" }));
    expect(byKey(commanderRuleChecks(r)).singleton.severity).toBe("warning");
  });
});
