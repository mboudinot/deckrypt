import { describe, it, expect } from "vitest";
import { pluralFr, sortDecksByColors } from "../js/util.js";

describe("pluralFr", () => {
  it("singular for 1", () => {
    expect(pluralFr(1, "carte")).toBe("1 carte");
    expect(pluralFr(1, "terrain")).toBe("1 terrain");
  });

  it("plural for n > 1 (adds an 's')", () => {
    expect(pluralFr(2, "carte")).toBe("2 cartes");
    expect(pluralFr(99, "permanent")).toBe("99 permanents");
  });

  it("singular for 0 (French convention: 0 ou 1 → singulier)", () => {
    expect(pluralFr(0, "carte")).toBe("0 carte");
  });

  it("singular for negative numbers (defensive — not expected in UI)", () => {
    expect(pluralFr(-1, "carte")).toBe("-1 carte");
  });
});

describe("sortDecksByColors", () => {
  const deck = (id, name, format = "commander") => ({ id, name, format });
  const names = (decks) => decks.map((d) => d.name);

  it("orders by colour count, colourless first", () => {
    const decks = [deck("a", "Sultai"), deck("b", "Mono"), deck("c", "Artefacts"), deck("d", "Five")];
    const colors = new Map([["a", ["U", "B", "G"]], ["b", ["R"]], ["c", []], ["d", ["W", "U", "B", "R", "G"]]]);
    expect(names(sortDecksByColors(decks, colors))).toEqual(["Artefacts", "Mono", "Sultai", "Five"]);
  });

  it("breaks ties by name, ignoring case and accents", () => {
    const decks = [deck("a", "zombies"), deck("b", "Élfes"), deck("c", "Anges")];
    const colors = new Map([["a", ["B"]], ["b", ["G"]], ["c", ["W"]]]);
    expect(names(sortDecksByColors(decks, colors))).toEqual(["Anges", "Élfes", "zombies"]);
  });

  it("puts decks with unknown colours after known ones, format libre last", () => {
    const decks = [deck("a", "Libre", "limited"), deck("b", "Inconnu"), deck("c", "Five")];
    const colors = new Map([["b", null], ["c", ["W", "U", "B", "R", "G"]]]);
    expect(names(sortDecksByColors(decks, colors))).toEqual(["Five", "Inconnu", "Libre"]);
  });

  it("does not mutate the input array", () => {
    const decks = [deck("a", "B"), deck("b", "A")];
    sortDecksByColors(decks, new Map([["a", []], ["b", []]]));
    expect(names(decks)).toEqual(["B", "A"]);
  });
});
