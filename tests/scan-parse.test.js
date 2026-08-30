import { describe, it, expect } from "vitest";
import { parseBottom, cleanTitle } from "../js/scan-parse.js";

/* Pure OCR-text parsing for the camera scanner (js/scan-parse.js). Inputs
 * mimic raw Tesseract output — noisy, upper/lower mixed, multi-line — so the
 * edge cases here lock the string logic the live scan proved out on mobile. */

describe("parseBottom", () => {
  it("reads set code + collector number from a modern bottom line", () => {
    // "0123/0456 R" (rarity) on one line, "FDN • EN" on the next.
    expect(parseBottom("0123/0456 R\nFDN • EN")).toEqual({ set: "fdn", cn: "123" });
  });

  it("strips leading zeros from the collector number", () => {
    expect(parseBottom("0007/0281\nWOC").cn).toBe("7");
  });

  it("takes the LEFT side of the fraction as this card's number", () => {
    expect(parseBottom("045/264\nBLB").cn).toBe("45");
  });

  it("lowercases the set code", () => {
    expect(parseBottom("12/300\nMH3").set).toBe("mh3");
  });

  it("does not mistake a language trigraph for a set code", () => {
    // If OCR surfaces the three-letter language form, skip it and keep going.
    expect(parseBottom("100/200\nENG FDN").set).toBe("fdn");
  });

  it("does not mistake a pure-digit token for a set code", () => {
    // No letters anywhere but the fraction → no set, but cn still parsed.
    expect(parseBottom("100/200")).toEqual({ set: null, cn: "100" });
  });

  it("returns a set with no number when the fraction is missing", () => {
    expect(parseBottom("FDN")).toEqual({ set: "fdn", cn: null });
  });

  it("returns nulls for unreadable / empty input", () => {
    expect(parseBottom("")).toEqual({ set: null, cn: null });
    expect(parseBottom(null)).toEqual({ set: null, cn: null });
    expect(parseBottom("••• —")).toEqual({ set: null, cn: null });
  });

  it("tolerates whitespace around the slash", () => {
    expect(parseBottom("123 / 456\nDMU").cn).toBe("123");
  });
});

describe("cleanTitle", () => {
  it("strips stray OCR glyphs at the edges of the name", () => {
    expect(cleanTitle("~ Sol Ring *|")).toBe("Sol Ring");
  });

  it("treats a stray glyph inside a word as a break (no false merge)", () => {
    // A digit/symbol mid-name becomes a space — documents the known limit.
    expect(cleanTitle("S0l R1ng")).toBe("S l R ng");
  });

  it("picks the longest surviving line (the name over typeline noise)", () => {
    expect(cleanTitle("Legendary\nAtraxa, Praetors' Voice\nW")).toBe("Atraxa, Praetors' Voice");
  });

  it("preserves accented letters", () => {
    expect(cleanTitle("Juzám Djinn")).toBe("Juzám Djinn");
  });

  it("keeps apostrophes, periods and hyphens", () => {
    expect(cleanTitle("Jaya's Immolating Inferno")).toBe("Jaya's Immolating Inferno");
    expect(cleanTitle("Ratchet, Field Medic")).toBe("Ratchet, Field Medic");
  });

  it("collapses runs of whitespace", () => {
    expect(cleanTitle("Sol    Ring")).toBe("Sol Ring");
  });

  it("drops fragments shorter than 3 chars", () => {
    expect(cleanTitle("W\nSol Ring")).toBe("Sol Ring");
  });

  it("returns an empty string when nothing usable is read", () => {
    expect(cleanTitle("")).toBe("");
    expect(cleanTitle(null)).toBe("");
    expect(cleanTitle("12 34 !!")).toBe("");
  });
});
