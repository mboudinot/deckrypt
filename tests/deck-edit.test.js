import { describe, it, expect } from "vitest";
import {
  addCard, removeCard, setQty, changePrinting,
  addCommander, removeCommander, changeCommanderPrinting,
} from "../js/deck-edit.js";

const newDeck = () => ({ id: "d1", name: "Test", commanders: [], cards: [] });

describe("addCard", () => {
  it("appends when no matching entry exists", () => {
    const d = newDeck();
    expect(addCard(d, { name: "Sol Ring", qty: 1 })).toBe(1);
    expect(d.cards).toEqual([{ name: "Sol Ring", qty: 1 }]);
  });

  it("defaults to qty 1 when none provided", () => {
    const d = newDeck();
    addCard(d, { name: "Sol Ring" });
    expect(d.cards[0].qty).toBe(1);
  });

  it("merges qty when name + set + cn match", () => {
    const d = newDeck();
    addCard(d, { name: "Sol Ring", set: "cmd", collector_number: "259", qty: 1 });
    expect(addCard(d, { name: "Sol Ring", set: "cmd", collector_number: "259", qty: 2 })).toBe(3);
    expect(d.cards).toHaveLength(1);
    expect(d.cards[0].qty).toBe(3);
  });

  it("treats different printings as separate entries", () => {
    const d = newDeck();
    addCard(d, { name: "Sol Ring", set: "cmd", collector_number: "259", qty: 1 });
    addCard(d, { name: "Sol Ring", set: "lea", collector_number: "270", qty: 1 });
    expect(d.cards).toHaveLength(2);
  });

  it("treats name-only and printing-specific as different identities", () => {
    const d = newDeck();
    addCard(d, { name: "Sol Ring", qty: 1 });
    addCard(d, { name: "Sol Ring", set: "cmd", collector_number: "259", qty: 1 });
    expect(d.cards).toHaveLength(2);
  });

  it("doesn't carry undefined set/cn into the stored entry", () => {
    const d = newDeck();
    addCard(d, { name: "Forest", qty: 5 });
    expect(d.cards[0]).toEqual({ name: "Forest", qty: 5 });
    expect("set" in d.cards[0]).toBe(false);
    expect("collector_number" in d.cards[0]).toBe(false);
  });
});

describe("removeCard", () => {
  it("decrements qty", () => {
    const d = newDeck();
    addCard(d, { name: "Forest", qty: 5 });
    expect(removeCard(d, { name: "Forest" }, 2)).toBe(3);
    expect(d.cards[0].qty).toBe(3);
  });

  it("removes the entry when qty reaches 0", () => {
    const d = newDeck();
    addCard(d, { name: "Forest", qty: 1 });
    expect(removeCard(d, { name: "Forest" }, 1)).toBe(0);
    expect(d.cards).toEqual([]);
  });

  it("removes the entry when qty drops below 0 (caller asks for too many)", () => {
    const d = newDeck();
    addCard(d, { name: "Forest", qty: 2 });
    expect(removeCard(d, { name: "Forest" }, 5)).toBe(0);
    expect(d.cards).toEqual([]);
  });

  it("returns -1 for unknown entry", () => {
    const d = newDeck();
    expect(removeCard(d, { name: "Nonexistent" })).toBe(-1);
  });

  it("matches identity (name+set+cn), not just name", () => {
    const d = newDeck();
    addCard(d, { name: "Sol Ring", set: "cmd", collector_number: "259", qty: 1 });
    addCard(d, { name: "Sol Ring", set: "lea", collector_number: "270", qty: 1 });
    removeCard(d, { name: "Sol Ring", set: "cmd", collector_number: "259" }, 1);
    expect(d.cards).toEqual([{ name: "Sol Ring", set: "lea", collector_number: "270", qty: 1 }]);
  });
});

describe("setQty", () => {
  it("sets the absolute qty", () => {
    const d = newDeck();
    addCard(d, { name: "Forest", qty: 5 });
    expect(setQty(d, { name: "Forest" }, 8)).toBe(true);
    expect(d.cards[0].qty).toBe(8);
  });

  it("removes the entry when qty <= 0", () => {
    const d = newDeck();
    addCard(d, { name: "Forest", qty: 5 });
    setQty(d, { name: "Forest" }, 0);
    expect(d.cards).toEqual([]);
  });

  it("returns false for unknown entry", () => {
    expect(setQty(newDeck(), { name: "Nope" }, 4)).toBe(false);
  });
});

describe("changePrinting", () => {
  it("updates set + collector_number on the entry", () => {
    const d = newDeck();
    addCard(d, { name: "Sol Ring", set: "cmd", collector_number: "259", qty: 1 });
    expect(changePrinting(d, { name: "Sol Ring", set: "cmd", collector_number: "259" }, "lea", "270")).toBe(true);
    expect(d.cards[0].set).toBe("lea");
    expect(d.cards[0].collector_number).toBe("270");
  });

  it("merges into an existing entry of the same target identity", () => {
    const d = newDeck();
    addCard(d, { name: "Forest", set: "unh", collector_number: "140", qty: 3 });
    addCard(d, { name: "Forest", set: "j25", collector_number: "200", qty: 2 });
    expect(changePrinting(
      d,
      { name: "Forest", set: "j25", collector_number: "200" },
      "unh", "140",
    )).toBe(true);
    expect(d.cards).toHaveLength(1);
    expect(d.cards[0]).toEqual({ name: "Forest", set: "unh", collector_number: "140", qty: 5 });
  });

  it("returns false when the source entry doesn't exist", () => {
    expect(changePrinting(newDeck(), { name: "Nope" }, "x", "1")).toBe(false);
  });

  it("changing to the same printing is a no-op", () => {
    const d = newDeck();
    addCard(d, { name: "Sol Ring", set: "cmd", collector_number: "259", qty: 1 });
    changePrinting(d, { name: "Sol Ring", set: "cmd", collector_number: "259" }, "cmd", "259");
    expect(d.cards).toEqual([{ name: "Sol Ring", set: "cmd", collector_number: "259", qty: 1 }]);
  });
});

describe("commander mutations", () => {
  it("addCommander appends and refuses duplicates", () => {
    const d = newDeck();
    expect(addCommander(d, { name: "Atraxa" })).toBe(true);
    expect(addCommander(d, { name: "Atraxa" })).toBe(false);
    expect(d.commanders).toHaveLength(1);
  });

  it("addCommander treats different printings as different commanders", () => {
    const d = newDeck();
    addCommander(d, { name: "Atraxa", set: "cmr", collector_number: "5" });
    addCommander(d, { name: "Atraxa", set: "phop", collector_number: "1" });
    expect(d.commanders).toHaveLength(2);
  });

  it("removeCommander drops by identity", () => {
    const d = newDeck();
    addCommander(d, { name: "Atraxa" });
    expect(removeCommander(d, { name: "Atraxa" })).toBe(true);
    expect(d.commanders).toEqual([]);
  });

  it("removeCommander returns false for unknown", () => {
    expect(removeCommander(newDeck(), { name: "Nope" })).toBe(false);
  });

  it("changeCommanderPrinting updates set + cn in place", () => {
    const d = newDeck();
    addCommander(d, { name: "Atraxa", set: "cmr", collector_number: "5" });
    changeCommanderPrinting(d, { name: "Atraxa", set: "cmr", collector_number: "5" }, "phop", "1");
    expect(d.commanders[0].set).toBe("phop");
    expect(d.commanders[0].collector_number).toBe("1");
  });
});
