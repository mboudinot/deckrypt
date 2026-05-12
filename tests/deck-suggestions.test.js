import { describe, it, expect } from "vitest";
import {
  isCommanderFormat, deckFormatOf,
  countLands, countRamp, countDraw,
  countInteraction, countBoardWipes, averageCmcOfSpells,
  isRampCard, isDrawCard, isInteractionCard, isBoardWipe,
  singletonViolations, colorIdentityIssues,
  commanderLegalityIssues, invalidCommanders,
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
      oracle_text: "Search your library for up to two basic land cards…",
    }))).toBe(true);
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
