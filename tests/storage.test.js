import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  STORAGE_KEY, SEEDED_KEY,
  isValidDeck, isValidDeckEntry, isValidDeckCard,
  loadUserDecks, saveUserDecks,
  hasSeededDefaults, markDefaultsSeeded, mergeDefaultsForSeeding,
} from "../js/storage.js";

const validDeck = {
  id: "user-x",
  name: "My Deck",
  commanders: [{ name: "Cmdr" }],
  cards: [{ name: "Sol Ring", qty: 1 }],
};

describe("isValidDeckEntry", () => {
  it("accepts an entry with a non-empty name", () => {
    expect(isValidDeckEntry({ name: "Sol Ring" })).toBe(true);
  });
  it("rejects null/undefined", () => {
    expect(isValidDeckEntry(null)).toBe(false);
    expect(isValidDeckEntry(undefined)).toBe(false);
  });
  it("rejects entries without a string name", () => {
    expect(isValidDeckEntry({})).toBe(false);
    expect(isValidDeckEntry({ name: "" })).toBe(false);
    expect(isValidDeckEntry({ name: 5 })).toBe(false);
  });
});

describe("isValidDeckCard", () => {
  it("accepts {name, qty>0}", () => {
    expect(isValidDeckCard({ name: "Sol Ring", qty: 1 })).toBe(true);
    expect(isValidDeckCard({ name: "Forest", qty: 8 })).toBe(true);
  });
  it("rejects non-integer qty", () => {
    expect(isValidDeckCard({ name: "X", qty: 1.5 })).toBe(false);
    expect(isValidDeckCard({ name: "X", qty: "1" })).toBe(false);
  });
  it("rejects qty <= 0", () => {
    expect(isValidDeckCard({ name: "X", qty: 0 })).toBe(false);
    expect(isValidDeckCard({ name: "X", qty: -1 })).toBe(false);
  });
  it("rejects entries without qty", () => {
    expect(isValidDeckCard({ name: "X" })).toBe(false);
  });
});

describe("isValidDeck", () => {
  it("accepts a complete valid deck", () => {
    expect(isValidDeck(validDeck)).toBe(true);
  });
  it("rejects when id is missing or empty", () => {
    expect(isValidDeck({ ...validDeck, id: "" })).toBe(false);
    const noId = { ...validDeck };
    delete noId.id;
    expect(isValidDeck(noId)).toBe(false);
  });
  it("rejects when commanders is not an array", () => {
    expect(isValidDeck({ ...validDeck, commanders: "x" })).toBe(false);
  });
  it("rejects when any card is invalid", () => {
    expect(isValidDeck({ ...validDeck, cards: [{ name: "x" }] })).toBe(false);
  });
  it("rejects null and primitives", () => {
    expect(isValidDeck(null)).toBe(false);
    expect(isValidDeck("foo")).toBe(false);
    expect(isValidDeck(42)).toBe(false);
  });

  it("accepts a deck without a format field (legacy)", () => {
    const noFormat = { ...validDeck };
    delete noFormat.format;
    expect(isValidDeck(noFormat)).toBe(true);
  });

  it("accepts an explicit 'commander' or 'limited' format", () => {
    expect(isValidDeck({ ...validDeck, format: "commander" })).toBe(true);
    expect(isValidDeck({ ...validDeck, format: "limited" })).toBe(true);
  });

  it("rejects an unknown format value", () => {
    expect(isValidDeck({ ...validDeck, format: "modern" })).toBe(false);
    expect(isValidDeck({ ...validDeck, format: "" })).toBe(false);
    expect(isValidDeck({ ...validDeck, format: 42 })).toBe(false);
  });
});

describe("loadUserDecks / saveUserDecks", () => {
  let warnSpy, errorSpy;

  beforeEach(() => {
    // Minimal localStorage shim for the Node test environment.
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      clear: () => { store.clear(); },
    };
    // Silence — and assert — the warnings emitted on intentional failures.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns [] when storage is empty", () => {
    expect(loadUserDecks()).toEqual([]);
  });

  it("round-trips a single deck", () => {
    expect(saveUserDecks([validDeck])).toBe(true);
    expect(loadUserDecks()).toEqual([validDeck]);
  });

  it("returns [] for corrupted JSON and warns", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadUserDecks()).toEqual([]);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/Corrupted/);
  });

  it("returns [] when the stored value is not an array", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 1 }));
    expect(loadUserDecks()).toEqual([]);
  });

  it("filters out invalid entries while keeping valid ones", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      validDeck,
      { id: "bad" },           // missing fields
      "not an object",
      null,
      { ...validDeck, id: "user-y", cards: [{ name: "x", qty: 0 }] }, // invalid qty
    ]));
    expect(loadUserDecks()).toEqual([validDeck]);
  });

  it("saveUserDecks returns false when localStorage throws (quota)", () => {
    globalThis.localStorage.setItem = () => { throw new Error("quota"); };
    expect(saveUserDecks([validDeck])).toBe(false);
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("loadUserDecks returns [] when localStorage throws (security)", () => {
    globalThis.localStorage.getItem = () => { throw new Error("blocked"); };
    expect(loadUserDecks()).toEqual([]);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  describe("hasSeededDefaults / markDefaultsSeeded", () => {
    it("false until markDefaultsSeeded is called", () => {
      expect(hasSeededDefaults()).toBe(false);
      markDefaultsSeeded();
      expect(hasSeededDefaults()).toBe(true);
    });

    it("uses a key independent from the user-decks key", () => {
      // Saving decks must NOT mark defaults as seeded — a pre-migration
      // user with a saved deck list still needs the seed migration.
      saveUserDecks([validDeck]);
      expect(hasSeededDefaults()).toBe(false);
    });

    it("survives reads when localStorage throws", () => {
      globalThis.localStorage.getItem = () => { throw new Error("blocked"); };
      expect(hasSeededDefaults()).toBe(false);
    });

    it("markDefaultsSeeded returns false (and doesn't crash) on quota error", () => {
      globalThis.localStorage.setItem = () => { throw new Error("quota"); };
      expect(markDefaultsSeeded()).toBe(false);
    });
  });
});

describe("mergeDefaultsForSeeding", () => {
  const A = { id: "a", name: "A", commanders: [], cards: [] };
  const B = { id: "b", name: "B", commanders: [], cards: [] };
  const C = { id: "c", name: "C", commanders: [], cards: [] };

  it("returns all defaults when existing is empty (fresh user)", () => {
    expect(mergeDefaultsForSeeding([], [A, B])).toEqual([A, B]);
  });

  it("appends the missing defaults to a pre-existing user list (migration)", () => {
    expect(mergeDefaultsForSeeding([C], [A, B])).toEqual([C, A, B]);
  });

  it("doesn't duplicate when a default is already present (by id)", () => {
    expect(mergeDefaultsForSeeding([A, C], [A, B])).toEqual([A, C, B]);
  });

  it("returns the input array reference (not a copy) when nothing to add", () => {
    const existing = [A, B, C];
    expect(mergeDefaultsForSeeding(existing, [A])).toBe(existing);
  });

  it("is idempotent across repeated calls", () => {
    const once = mergeDefaultsForSeeding([], [A, B]);
    const twice = mergeDefaultsForSeeding(once, [A, B]);
    expect(twice).toEqual([A, B]);
  });

  it("preserves user-deck order when appending (defaults go to the tail)", () => {
    expect(mergeDefaultsForSeeding([B], [A]).map((d) => d.id)).toEqual(["b", "a"]);
  });
});
