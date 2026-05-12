import { describe, it, expect } from "vitest";
import {
  parseManaCost, colorRequirements, manaSourcesByColor,
  isMulticolorLand, isFetchLand, isSlowLand, isUtilityLand,
  countMulticolorLands, countFetchLands, countSlowLands, countUtilityLands,
  sourcesNeededFor, fixingVerdicts, analyzeManaBase,
} from "../js/deck-mana-base.js";

const card = (overrides = {}) => ({
  name: "X",
  type_line: "Creature — Bear",
  mana_cost: "",
  produced_mana: [],
  oracle_text: "",
  ...overrides,
});

const land = (produced, text = "", typeLine = "Basic Land — Forest") =>
  card({ type_line: typeLine, produced_mana: produced, oracle_text: text });

describe("parseManaCost", () => {
  it("counts simple coloured pips", () => {
    expect(parseManaCost("{W}")).toMatchObject({ W: 1, U: 0, B: 0, R: 0, G: 0 });
    expect(parseManaCost("{2}{W}{W}{R}")).toMatchObject({ W: 2, R: 1 });
  });

  it("ignores generic / X / colourless / snow symbols", () => {
    expect(parseManaCost("{X}{2}{C}{S}")).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0 });
  });

  it("counts hybrid mana toward both halves", () => {
    expect(parseManaCost("{W/U}")).toMatchObject({ W: 1, U: 1 });
    expect(parseManaCost("{W/B}{B/R}")).toMatchObject({ W: 1, B: 2, R: 1 });
  });

  it("treats Phyrexian symbols as the underlying coloured cost", () => {
    expect(parseManaCost("{W/P}{B/P}")).toMatchObject({ W: 1, B: 1 });
  });

  it("returns zeros for empty / missing input", () => {
    expect(parseManaCost("")).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0 });
    expect(parseManaCost(null)).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0 });
  });
});

describe("colorRequirements", () => {
  it("aggregates per-colour symbols across non-land cards", () => {
    const deck = [
      card({ mana_cost: "{W}{W}{U}" }),
      card({ mana_cost: "{2}{B}" }),
      card({ mana_cost: "{R/G}" }),
      land(["G"]), // ignored
    ];
    expect(colorRequirements(deck)).toEqual({
      W: 2, U: 1, B: 1, R: 1, G: 1,
    });
  });
});

describe("manaSourcesByColor", () => {
  it("counts +1 per produced colour, deduped per card", () => {
    const deck = [
      land(["G"]),                       // Forest
      land(["W", "U"]),                  // Hallowed Fountain
      land(["W", "U", "B", "R", "G"]),   // Command Tower
      land(["C"]),                       // Wastes
    ];
    expect(manaSourcesByColor(deck)).toEqual({
      W: 2, U: 2, B: 1, R: 1, G: 2, C: 1,
    });
  });

  it("ignores non-land cards even if they have produced_mana (mana rocks)", () => {
    const deck = [
      card({
        type_line: "Artifact",
        produced_mana: ["C"],
      }),
    ];
    expect(manaSourcesByColor(deck)).toEqual({
      W: 0, U: 0, B: 0, R: 0, G: 0, C: 0,
    });
  });
});

describe("isMulticolorLand", () => {
  it("flags lands producing 2+ colours (duals, triomes, shocklands)", () => {
    expect(isMulticolorLand(land(["W", "U"]))).toBe(true);
    expect(isMulticolorLand(land(["W", "U", "B"]))).toBe(true);
  });

  it("doesn't flag mono-coloured or colourless lands", () => {
    expect(isMulticolorLand(land(["W"]))).toBe(false);
    expect(isMulticolorLand(land(["C"]))).toBe(false);
    expect(isMulticolorLand(land(["W", "C"]))).toBe(false); // C doesn't count
  });
});

describe("isFetchLand", () => {
  it("flags 'search your library for a Land card and put it onto the battlefield'", () => {
    const fetch = land([], "{T}, Pay 1 life, Sacrifice ~: Search your library for a Forest or Plains card and put it onto the battlefield.");
    expect(isFetchLand(fetch)).toBe(true);
  });

  it("flags Evolving-Wilds-style fetches that say 'a basic land'", () => {
    const evo = land([], "{T}, Sacrifice ~: Search your library for a basic land card, put it onto the battlefield tapped.");
    expect(isFetchLand(evo)).toBe(true);
  });

  it("does not flag plain basic lands", () => {
    expect(isFetchLand(land(["G"]))).toBe(false);
  });

  it("does not flag spells that fetch lands (those are sorceries, not lands)", () => {
    expect(isFetchLand(card({
      type_line: "Sorcery",
      oracle_text: "Search your library for a basic land card and put it onto the battlefield.",
    }))).toBe(false);
  });
});

describe("isSlowLand", () => {
  it("flags pure taplands (Guildgates, bouncelands)", () => {
    expect(isSlowLand(land(["W", "U"], "~ enters the battlefield tapped."))).toBe(true);
  });

  it("does NOT flag shocklands (untapped if you pay 2 life)", () => {
    expect(isSlowLand(land(["W", "U"],
      "As ~ enters the battlefield, you may pay 2 life. If you don't, ~ enters tapped."
    ))).toBe(false);
  });

  it("does NOT flag check lands (untapped if you control specific basics)", () => {
    expect(isSlowLand(land(["W", "U"],
      "~ enters the battlefield tapped unless you control a Plains or an Island."
    ))).toBe(false);
  });

  it("does NOT flag reveal lands", () => {
    expect(isSlowLand(land(["W", "U"],
      "~ enters the battlefield tapped unless you reveal an Island card from your hand."
    ))).toBe(false);
  });

  it("does NOT flag plain basic lands", () => {
    expect(isSlowLand(land(["G"]))).toBe(false);
  });

  it("does NOT flag non-lands", () => {
    expect(isSlowLand(card({ type_line: "Sorcery", oracle_text: "enters the battlefield tapped" }))).toBe(false);
  });
});

describe("isUtilityLand", () => {
  it("flags Strip Mine / Wasteland (land destruction)", () => {
    expect(isUtilityLand(land([],
      "{T}, Sacrifice ~: Destroy target land."
    ))).toBe(true);
  });

  it("flags Bojuka Bog (graveyard hate)", () => {
    expect(isUtilityLand(land(["B"],
      "~ enters the battlefield tapped. When ~ enters, exile target player's graveyard."
    ))).toBe(true);
  });

  it("flags Reliquary Tower (hand size)", () => {
    expect(isUtilityLand(land(["C"],
      "You have no maximum hand size. {T}: Add {C}."
    ))).toBe(true);
  });

  it("flags Maze of Ith (combat tricks)", () => {
    expect(isUtilityLand(land([],
      "{T}: Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn."
    ))).toBe(true);
  });

  it("flags manlands (Creature lands)", () => {
    expect(isUtilityLand(land(["W"],
      "{W}: ~ becomes a 2/2 Soldier creature with flying until end of turn."
    ))).toBe(true);
  });

  it("doesn't flag plain basic lands", () => {
    expect(isUtilityLand(land(["G"]))).toBe(false);
  });

  it("doesn't flag dual lands with no extra ability", () => {
    expect(isUtilityLand(land(["W", "U"], "{T}: Add {W} or {U}."))).toBe(false);
  });

  it("doesn't flag fetch lands (counted separately)", () => {
    // Real fetch lands always say "put it onto the battlefield" —
    // matching the full fetch-land regex makes them return early
    // from isUtilityLand without triggering the "Sacrifice ~:" rule.
    expect(isUtilityLand(land([],
      "{T}, Pay 1 life, Sacrifice ~: Search your library for a Forest or Plains card, put it onto the battlefield."
    ))).toBe(false);
  });
});

describe("countSlowLands / countUtilityLands", () => {
  it("counts only the matching lands across a mixed deck", () => {
    const deck = [
      land(["G"]),
      land(["G"]),
      land(["W", "U"], "~ enters the battlefield tapped."),
      land(["B"], "~ enters tapped. When ~ enters, exile target graveyard."),
      land([], "{T}, Sacrifice ~: Destroy target land."),
      card({ type_line: "Sorcery", oracle_text: "Whatever." }),
    ];
    expect(countSlowLands(deck)).toBe(2); // tapland + Bojuka-style
    expect(countUtilityLands(deck)).toBe(2); // Bojuka + Strip Mine
  });
});

describe("analyzeManaBase v2 (slow + utility)", () => {
  it("includes slow and utility counts in the report", () => {
    const deck = [
      land(["G"]),
      land(["W", "U"], "~ enters the battlefield tapped."),
      land([], "{T}, Sacrifice ~: Destroy target land."),
    ];
    const out = analyzeManaBase(deck);
    expect(out.slow).toBe(1);
    expect(out.utility).toBe(1);
  });
});

describe("sourcesNeededFor", () => {
  it("matches Karsten's 99-card table for canonical spots", () => {
    expect(sourcesNeededFor(1, 2)).toBe(18);   // 1B at CMC 2
    expect(sourcesNeededFor(2, 3)).toBe(20);   // BB at CMC 3
    expect(sourcesNeededFor(3, 3)).toBe(25);   // BBB at CMC 3
    expect(sourcesNeededFor(1, 5)).toBe(14);   // 4B at CMC 5
  });

  it("clamps CMC to at least pips (BB on T1 is impossible)", () => {
    expect(sourcesNeededFor(2, 1)).toBe(sourcesNeededFor(2, 2));
    expect(sourcesNeededFor(3, 0)).toBe(sourcesNeededFor(3, 3));
  });

  it("caps CMC at 7 — past that, more turns barely move probability", () => {
    expect(sourcesNeededFor(1, 12)).toBe(sourcesNeededFor(1, 7));
  });

  it("scales linearly for smaller deck sizes", () => {
    // 60-card Standard deck: ~60/99 ≈ 0.61 of the EDH threshold.
    expect(sourcesNeededFor(1, 2, 60)).toBe(Math.round(18 * 60 / 99));
    // 40-card Limited deck.
    expect(sourcesNeededFor(2, 3, 40)).toBe(Math.round(20 * 40 / 99));
  });

  it("returns 0 when there are no coloured pips", () => {
    expect(sourcesNeededFor(0, 5)).toBe(0);
  });
});

describe("fixingVerdicts", () => {
  const pad99 = (deck) => [...deck, ...Array(99 - deck.length).fill(card({}))];

  it("flags 'low' when sources fall short of the dominant-spell threshold", () => {
    // Single BB spell at CMC 3 → Karsten = 20 sources. With 12, low.
    const deck = pad99([card({ mana_cost: "{1}{B}{B}", cmc: 3 })]);
    const out = fixingVerdicts({ W: 0, U: 0, B: 12, R: 0, G: 0, C: 0 }, deck);
    const b = out.find((r) => r.color === "B");
    expect(b.status).toBe("low");
    expect(b.needed).toBe(20);
    expect(b.dominant).toMatchObject({ pips: 2, cmc: 3 });
  });

  it("flags 'ok' once sources meet the dominant-spell threshold", () => {
    const deck = pad99([card({ mana_cost: "{1}{B}{B}", cmc: 3 })]);
    const out = fixingVerdicts({ W: 0, U: 0, B: 21, R: 0, G: 0, C: 0 }, deck);
    expect(out.find((r) => r.color === "B").status).toBe("ok");
  });

  it("picks the worst spell as the threshold — many cheap pips don't move it", () => {
    // A pile of 1B spells at CMC 2 (need 18) plus a single BB at CMC 3
    // (needs 20). The BB drives the threshold, not the cumulative count.
    const deck = pad99([
      ...Array(30).fill(card({ mana_cost: "{1}{B}", cmc: 2 })),
      card({ mana_cost: "{1}{B}{B}", cmc: 3 }),
    ]);
    const out = fixingVerdicts({ W: 0, U: 0, B: 20, R: 0, G: 0, C: 0 }, deck);
    const b = out.find((r) => r.color === "B");
    expect(b.needed).toBe(20);
    expect(b.status).toBe("ok");
  });

  it("regression: a black-symbol-heavy deck with mostly 1B spells stays 'ok' at 20 B sources", () => {
    // Reproduces the Meren-style report: ~70 black pips across many 1B
    // creatures, max pip count = 2 (commander or one BB sacrifice
    // outlet). Under the old ratio (sources/total = 20/70 = 0.29) the
    // panel would flag low; with Karsten, 20 ≥ 18 for max 1B at CMC 2.
    const deck = pad99([
      card({ mana_cost: "{2}{B}{G}", cmc: 4, name: "Meren of Clan Nel Toth" }),
      ...Array(50).fill(card({ mana_cost: "{2}{B}", cmc: 3 })),
      ...Array(10).fill(card({ mana_cost: "{1}{B}", cmc: 2 })),
    ]);
    const out = fixingVerdicts({ W: 0, U: 0, B: 20, R: 0, G: 18, C: 0 }, deck);
    expect(out.find((r) => r.color === "B").status).toBe("ok");
  });

  it("omits colours with no sources and no demand", () => {
    const deck = pad99([card({ mana_cost: "{G}", cmc: 1 })]);
    const out = fixingVerdicts({ W: 0, U: 0, B: 0, R: 0, G: 18, C: 0 }, deck);
    expect(out.map((r) => r.color)).toEqual(["G"]);
  });

  it("emits 'info' for colours with sources but no spells demanding them", () => {
    const deck = pad99([card({ mana_cost: "{G}", cmc: 1 })]);
    const out = fixingVerdicts({ W: 4, U: 0, B: 0, R: 0, G: 18, C: 0 }, deck);
    const w = out.find((r) => r.color === "W");
    expect(w.status).toBe("info");
    expect(w.dominant).toBeNull();
  });

  it("scales thresholds down for smaller decks (40-card limited)", () => {
    // 1B at CMC 2 in a 40-card deck: 18 × 40/99 ≈ 7. With 7 sources, ok.
    const deck = [card({ mana_cost: "{1}{B}", cmc: 2 }), ...Array(39).fill(card({}))];
    const out = fixingVerdicts({ W: 0, U: 0, B: 7, R: 0, G: 0, C: 0 }, deck);
    expect(out.find((r) => r.color === "B").status).toBe("ok");
  });
});

describe("analyzeManaBase", () => {
  it("composes the panel-ready report", () => {
    const deck = [
      land(["G"]), land(["G"]), land(["G"]), land(["G"]),
      land(["W"]), land(["W"]), land(["W"]),
      land(["W", "G"]),                   // Stomping Ground style
      land(["W", "U", "B", "R", "G"]),    // Command Tower
      land([], "Search your library for a basic land card and put it onto the battlefield."), // fetch-equivalent
      card({ mana_cost: "{G}{G}{W}", type_line: "Creature — Druid" }),
      card({ mana_cost: "{1}{W}", type_line: "Creature — Knight" }),
    ];
    const out = analyzeManaBase(deck);
    expect(out.lands).toBe(10);
    expect(out.sources.G).toBe(6);                // 4 forests + 1 dual + Command Tower
    expect(out.sources.W).toBe(5);                // 3 plains + 1 dual + Command Tower
    expect(out.requirements.G).toBe(2);
    expect(out.requirements.W).toBe(2);
    expect(out.multicolor).toBe(2);               // dual + Command Tower
    expect(out.fetches).toBe(1);                  // evolving-wilds-like
    expect(out.perColor.find((r) => r.color === "G").status).toBe("ok");
  });
});
