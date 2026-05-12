import { describe, it, expect } from "vitest";
import {
  EXPORT_FORMATS,
  exportPlainNames, exportListWithQty, exportMoxfield, exportJson,
  exportDeck,
} from "../js/deck-export.js";
import { parseDecklist } from "../js/parser.js";

const sampleDeck = () => ({
  id: "test-deck",
  name: "Test Deck",
  format: "commander",
  commanders: [
    { name: "Atraxa, Praetors' Voice" },
  ],
  cards: [
    { name: "Sol Ring", set: "cmd", collector_number: "259", qty: 1 },
    { name: "Forest", qty: 5 },
    { name: "Counterspell", qty: 1 },
  ],
});

describe("EXPORT_FORMATS", () => {
  it("exposes a stable list of format descriptors", () => {
    const keys = EXPORT_FORMATS.map((f) => f.key);
    expect(keys).toEqual(["plain", "list", "moxfield", "json"]);
    for (const f of EXPORT_FORMATS) {
      expect(f.label).toBeTruthy();
      expect(f.description).toBeTruthy();
      expect(f.extension).toMatch(/^(txt|json)$/);
    }
  });
});

describe("exportPlainNames", () => {
  it("expands by qty (one line per copy)", () => {
    const out = exportPlainNames(sampleDeck()).split("\n");
    expect(out).toEqual([
      "Atraxa, Praetors' Voice",
      "Sol Ring",
      "Forest", "Forest", "Forest", "Forest", "Forest",
      "Counterspell",
    ]);
  });

  it("handles an empty deck", () => {
    expect(exportPlainNames({ commanders: [], cards: [] })).toBe("");
  });
});

describe("exportListWithQty", () => {
  it("writes qty + name with section headers", () => {
    const out = exportListWithQty(sampleDeck());
    expect(out).toContain("// Commanders");
    expect(out).toContain("1 Atraxa, Praetors' Voice");
    expect(out).toContain("// Mainboard");
    expect(out).toContain("1 Sol Ring");
    expect(out).toContain("5 Forest");
  });

  it("omits the commanders section when there are none", () => {
    const def = { commanders: [], cards: [{ name: "Forest", qty: 60 }] };
    expect(exportListWithQty(def)).not.toContain("// Commanders");
  });
});

describe("exportMoxfield", () => {
  it("appends (SET) cn when both are present", () => {
    const out = exportMoxfield(sampleDeck());
    expect(out).toContain("1 Sol Ring (CMD) 259");
    expect(out).toContain("5 Forest"); // no set → no parenthesis
  });

  it("uppercases the set code (matches Moxfield's output)", () => {
    const def = {
      commanders: [], cards: [{ name: "X", set: "cmd", collector_number: "1", qty: 1 }],
    };
    expect(exportMoxfield(def)).toContain("(CMD) 1");
  });

  it("preserves the data when round-tripped through parser.js", () => {
    const original = sampleDeck();
    const exported = exportMoxfield(original);
    const reparsed = parseDecklist(exported);
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.commanders.map((c) => c.name)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(reparsed.cards.find((c) => c.name === "Sol Ring")).toEqual({
      name: "Sol Ring", set: "cmd", collector_number: "259", qty: 1,
    });
    expect(reparsed.cards.find((c) => c.name === "Forest").qty).toBe(5);
  });

  it("list format round-trips too (qty only)", () => {
    const original = sampleDeck();
    const exported = exportListWithQty(original);
    const reparsed = parseDecklist(exported);
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.commanders.map((c) => c.name)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(reparsed.cards.find((c) => c.name === "Forest").qty).toBe(5);
  });
});

describe("exportJson", () => {
  it("emits a valid JSON snapshot of the canonical fields", () => {
    const out = exportJson(sampleDeck());
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      name: "Test Deck",
      format: "commander",
      commanders: [{ name: "Atraxa, Praetors' Voice" }],
      cards: [
        { name: "Sol Ring", set: "cmd", collector_number: "259", qty: 1 },
        { name: "Forest", qty: 5 },
        { name: "Counterspell", qty: 1 },
      ],
    });
  });

  it("strips fields the app doesn't use (defensive against junk)", () => {
    const dirty = {
      name: "T", format: "commander",
      _internalNote: "leak",
      commanders: [{ name: "X", randomField: 42 }],
      cards: [{ name: "Y", qty: 1, ghost: true }],
    };
    const parsed = JSON.parse(exportJson(dirty));
    expect(parsed.commanders[0]).toEqual({ name: "X" });
    expect(parsed.cards[0]).toEqual({ name: "Y", qty: 1 });
    expect(parsed._internalNote).toBeUndefined();
  });

  it("defaults format to 'commander' when missing (legacy decks)", () => {
    const noFmt = { name: "Legacy", commanders: [], cards: [] };
    expect(JSON.parse(exportJson(noFmt)).format).toBe("commander");
  });
});

describe("exportDeck dispatcher", () => {
  it("routes to the right formatter", () => {
    const def = sampleDeck();
    expect(exportDeck(def, "plain")).toBe(exportPlainNames(def));
    expect(exportDeck(def, "list")).toBe(exportListWithQty(def));
    expect(exportDeck(def, "moxfield")).toBe(exportMoxfield(def));
    expect(exportDeck(def, "json")).toBe(exportJson(def));
  });

  it("returns '' for null def (defensive)", () => {
    expect(exportDeck(null, "plain")).toBe("");
  });

  it("throws on an unknown format key", () => {
    expect(() => exportDeck(sampleDeck(), "bogus")).toThrow(/Unknown export format/);
  });
});
