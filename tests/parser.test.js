import { describe, it, expect } from "vitest";
import {
  parseDecklist,
  MAX_INPUT_LENGTH, MAX_LINES, MAX_QTY_PER_LINE,
  MAX_NAME_LENGTH, MAX_TOTAL_CARDS,
} from "../js/parser.js";

describe("parseDecklist — empty / whitespace input", () => {
  it("returns an empty result for empty string", () => {
    expect(parseDecklist("")).toEqual({
      commanders: [], cards: [], errors: [],
      counts: { commanders: 0, main: 0, sideboard: 0 },
    });
  });
  it("handles null and undefined", () => {
    expect(parseDecklist(null).cards).toEqual([]);
    expect(parseDecklist(undefined).cards).toEqual([]);
  });
  it("ignores whitespace-only lines without errors", () => {
    const r = parseDecklist("   \n\t\n  \n");
    expect(r.cards).toEqual([]);
    expect(r.errors).toEqual([]);
  });
});

describe("parseDecklist — card line formats", () => {
  it("parses a name-only line", () => {
    const r = parseDecklist("1 Sol Ring");
    expect(r.cards).toEqual([{ name: "Sol Ring", qty: 1 }]);
  });

  it("parses name + set + collector", () => {
    const r = parseDecklist("1 Sol Ring (CMD) 259");
    expect(r.cards[0]).toMatchObject({
      name: "Sol Ring", set: "cmd", collector_number: "259", qty: 1,
    });
  });

  // Regression test for fix #4
  it("parses name + set without collector (degrades to name-only)", () => {
    const r = parseDecklist("1 Sol Ring (CMD)");
    expect(r.cards[0].name).toBe("Sol Ring");
    expect(r.cards[0].set).toBeUndefined();
    expect(r.cards[0].collector_number).toBeUndefined();
  });

  it("strips the *F* foil flag", () => {
    const r = parseDecklist("1 Eternal Witness (5DN) 86 *F*");
    expect(r.cards[0]).toMatchObject({
      name: "Eternal Witness", set: "5dn", collector_number: "86",
    });
  });

  it("preserves ★ in the collector number", () => {
    const r = parseDecklist("1 Sheoldred, Whispering One (PNPH) 73★");
    expect(r.cards[0].collector_number).toBe("73★");
  });

  it("preserves EXO-128 style collector numbers", () => {
    const r = parseDecklist("1 Spike Weaver (PLST) EXO-128");
    expect(r.cards[0].collector_number).toBe("EXO-128");
  });

  it("keeps // inside split-card names", () => {
    const r = parseDecklist("1 Never // Return (AKH) 212");
    expect(r.cards[0].name).toBe("Never // Return");
  });

  it("keeps commas in legendary-creature names", () => {
    const r = parseDecklist("1 Edric, Spymaster of Trest");
    expect(r.cards[0].name).toBe("Edric, Spymaster of Trest");
  });

  it("handles apostrophes and hyphens in names", () => {
    const r = parseDecklist("1 Wayfarer's Bauble\n1 Cold-Eyed Selkie");
    expect(r.cards.map((c) => c.name)).toEqual([
      "Wayfarer's Bauble", "Cold-Eyed Selkie",
    ]);
  });

  it("preserves quantity > 1", () => {
    const r = parseDecklist("8 Forest (UNH) 140");
    expect(r.cards[0]).toMatchObject({ name: "Forest", qty: 8 });
    expect(r.counts.main).toBe(8);
  });

  it("normalizes set codes to lowercase", () => {
    const r = parseDecklist("1 Sol Ring (CMD) 259");
    expect(r.cards[0].set).toBe("cmd");
  });

  it("preserves collector-number case (e.g. EXO-128)", () => {
    const r = parseDecklist("1 Spike Weaver (PLST) EXO-128");
    expect(r.cards[0].collector_number).toBe("EXO-128");
  });
});

describe("parseDecklist — sections", () => {
  it("// COMMANDER followed by blank line returns to main", () => {
    const r = parseDecklist(`// COMMANDER
1 Meren of Clan Nel Toth (C15) 49

1 Sol Ring (CMD) 259`);
    expect(r.commanders).toHaveLength(1);
    expect(r.commanders[0].name).toBe("Meren of Clan Nel Toth");
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].name).toBe("Sol Ring");
  });

  it("supports standalone 'Commander' header", () => {
    const r = parseDecklist(`Commander
1 Meren of Clan Nel Toth

1 Sol Ring`);
    expect(r.commanders).toHaveLength(1);
    expect(r.cards).toHaveLength(1);
  });

  it("ignores sideboard cards but counts them", () => {
    const r = parseDecklist(`1 Sol Ring

// SIDEBOARD
1 Force of Will`);
    expect(r.cards).toHaveLength(1);
    expect(r.counts.sideboard).toBe(1);
  });

  it("expands quantity > 1 in commanders section", () => {
    const r = parseDecklist(`// COMMANDER
2 Some Card`);
    expect(r.commanders).toHaveLength(2);
    expect(r.counts.commanders).toBe(2);
  });

  it("handles multiple // COMMANDER blocks", () => {
    const r = parseDecklist(`// COMMANDER
1 Cmdr One

1 Card 1

// COMMANDER
1 Cmdr Two`);
    expect(r.commanders.map((c) => c.name)).toEqual(["Cmdr One", "Cmdr Two"]);
    expect(r.cards.map((c) => c.name)).toEqual(["Card 1"]);
  });

  it("strips punctuation from // headers (// commander:)", () => {
    const r = parseDecklist(`// commander:
1 Some Card

1 Other`);
    expect(r.commanders).toHaveLength(1);
    expect(r.cards).toHaveLength(1);
  });
});

describe("parseDecklist — error handling", () => {
  it("collects unparsable lines in errors and continues parsing", () => {
    const r = parseDecklist("garbage line\n1 Sol Ring");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("garbage line");
    expect(r.cards).toHaveLength(1);
  });

  it("strips a leading BOM", () => {
    const r = parseDecklist("﻿1 Sol Ring");
    expect(r.cards).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
  });

  it("handles \\r\\n line endings", () => {
    const r = parseDecklist("1 Sol Ring\r\n1 Forest");
    expect(r.cards).toHaveLength(2);
  });
});

describe("parseDecklist — DoS hardening (limits)", () => {
  it("rejects input longer than MAX_INPUT_LENGTH (fatal)", () => {
    const huge = "1 Sol Ring\n".repeat(20_000); // ~220KB
    const r = parseDecklist(huge);
    expect(r.cards).toEqual([]);
    expect(r.commanders).toEqual([]);
    expect(r.errors[0]).toMatch(/trop longue/i);
  });

  it("rejects more than MAX_LINES lines (fatal)", () => {
    // Build text under the byte limit but over the line limit.
    const text = "x\n".repeat(MAX_LINES + 100);
    const r = parseDecklist(text);
    expect(r.cards).toEqual([]);
    expect(r.errors[0]).toMatch(/Trop de lignes/i);
  });

  it("rejects qty > MAX_QTY_PER_LINE on that line (warning, parsing continues)", () => {
    const r = parseDecklist(`${MAX_QTY_PER_LINE + 1} Forest\n1 Sol Ring`);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].name).toBe("Sol Ring");
    expect(r.errors.some((e) => /Quantité trop élevée/i.test(e))).toBe(true);
  });

  it("rejects names longer than MAX_NAME_LENGTH on that line (warning)", () => {
    const longName = "X".repeat(MAX_NAME_LENGTH + 1);
    const r = parseDecklist(`1 ${longName}\n1 Sol Ring`);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0].name).toBe("Sol Ring");
    expect(r.errors.some((e) => /Nom trop long/i.test(e))).toBe(true);
  });

  it("rejects total > MAX_TOTAL_CARDS (fatal — clears parsed cards)", () => {
    // Build a deck just over the limit using safe-sized lines.
    const lines = [];
    for (let i = 0; i < 4; i++) lines.push(`${MAX_QTY_PER_LINE} Card${i}`);
    // Total = 4 * 100 = 400 > 250.
    const r = parseDecklist(lines.join("\n"));
    expect(r.cards).toEqual([]);
    expect(r.errors.some((e) => /trop grand/i.test(e))).toBe(true);
  });

  it("does NOT expand absurd qty into a giant array (memory safety)", () => {
    // The pathological case the limit is designed to prevent.
    const r = parseDecklist("999999999 Forest");
    expect(r.cards).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });
});

describe("parseDecklist — full Meren reference deck", () => {
  it("parses 1 commander + 99 main with 0 errors", () => {
    const text = `// COMMANDER
1 Meren of Clan Nel Toth (C15) 49

1 Aid from the Cowl (AER) 105
1 Command Tower (CMD) 269
1 Eternal Witness (5DN) 86 *F*
8 Forest (UNH) 140
7 Forest (OTJ) 285
1 Never // Return (AKH) 212
1 Sheoldred, Whispering One (PNPH) 73★ *F*
1 Spike Weaver (PLST) EXO-128
16 Swamp (UNH) 138
62 Filler (CMD) 1`;
    const r = parseDecklist(text);
    expect(r.counts.commanders).toBe(1);
    expect(r.counts.main).toBe(99);
    expect(r.errors).toEqual([]);
    expect(r.commanders[0].name).toBe("Meren of Clan Nel Toth");
  });
});
