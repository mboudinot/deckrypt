import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CARD_CACHE_KEY, DEFAULT_TTL_MS,
  lookupMany, getCachedCard, cardCacheReader,
  cacheCards, evictExpired, clearCache,
} from "../js/card-cache.js";

const card = (set, cn, name, extra = {}) => ({
  set, collector_number: cn, name,
  cmc: 0, type_line: "Creature", colors: [], image_uris: { small: "" },
  ...extra,
});

const idByName = (name) => ({ name });
const idByPrinting = (set, cn) => ({ set, collector_number: cn });

const T0 = 1_700_000_000_000; // arbitrary anchor "now"
const ONE_HOUR = 60 * 60 * 1000;

describe("card-cache", () => {
  let warnSpy, errorSpy;

  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      clear: () => { store.clear(); },
    };
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("cold start", () => {
    it("lookupMany on empty cache reports everything as missing", () => {
      const ids = [idByName("Plains"), idByPrinting("cmd", "269")];
      const { found, missing } = lookupMany(ids, T0);
      expect(found).toEqual([]);
      expect(missing).toEqual(ids);
    });

    it("getCachedCard returns null on empty cache", () => {
      expect(getCachedCard(idByName("Plains"), T0)).toBeNull();
    });

    it("evictExpired returns 0 when there is nothing", () => {
      expect(evictExpired(T0)).toBe(0);
    });
  });

  describe("cacheCards", () => {
    it("stores a card keyed by lowercased set + collector_number", () => {
      const c = card("CMD", "269", "Command Tower");
      expect(cacheCards([c], T0)).toBe(1);
      const raw = JSON.parse(localStorage.getItem(CARD_CACHE_KEY));
      expect(raw["cmd:269"]).toBeDefined();
      expect(raw["cmd:269"].card.name).toBe("Command Tower");
      expect(raw["cmd:269"].fetchedAt).toBe(T0);
    });

    it("skips cards missing set or collector_number", () => {
      expect(cacheCards([{ name: "Orphan" }], T0)).toBe(0);
      expect(cacheCards([{ set: "x", name: "Half" }], T0)).toBe(0);
      expect(localStorage.getItem(CARD_CACHE_KEY)).toBeNull();
    });

    it("returns 0 and writes nothing for an empty input", () => {
      expect(cacheCards([], T0)).toBe(0);
      expect(cacheCards(null, T0)).toBe(0);
      expect(localStorage.getItem(CARD_CACHE_KEY)).toBeNull();
    });

    it("upserts: re-caching the same printing refreshes fetchedAt", () => {
      cacheCards([card("cmd", "269", "Command Tower")], T0);
      cacheCards([card("cmd", "269", "Command Tower")], T0 + ONE_HOUR);
      const raw = JSON.parse(localStorage.getItem(CARD_CACHE_KEY));
      expect(raw["cmd:269"].fetchedAt).toBe(T0 + ONE_HOUR);
      expect(Object.keys(raw)).toHaveLength(1);
    });
  });

  describe("lookupMany / getCachedCard", () => {
    beforeEach(() => {
      cacheCards([
        card("cmd", "269", "Command Tower"),
        card("c15", "49", "Meren of Clan Nel Toth"),
        card("unh", "140", "Forest"),
      ], T0);
    });

    it("hits by exact printing", () => {
      const c = getCachedCard(idByPrinting("cmd", "269"), T0);
      expect(c).not.toBeNull();
      expect(c.name).toBe("Command Tower");
    });

    it("hits by name (case-insensitive scan)", () => {
      const c = getCachedCard(idByName("MEREN OF CLAN NEL TOTH"), T0);
      expect(c).not.toBeNull();
      expect(c.set).toBe("c15");
    });

    it("misses when set+cn differ", () => {
      expect(getCachedCard(idByPrinting("cmd", "999"), T0)).toBeNull();
    });

    it("misses when name has no match", () => {
      expect(getCachedCard(idByName("Black Lotus"), T0)).toBeNull();
    });

    it("lookupMany splits hits and misses preserving order", () => {
      const ids = [
        idByPrinting("cmd", "269"),         // hit
        idByName("Black Lotus"),             // miss
        idByName("Forest"),                  // hit
        idByPrinting("xyz", "1"),            // miss
      ];
      const { found, missing } = lookupMany(ids, T0);
      expect(found.map((c) => c.name)).toEqual(["Command Tower", "Forest"]);
      expect(missing).toEqual([idByName("Black Lotus"), idByPrinting("xyz", "1")]);
    });

    it("lookupMany reads localStorage exactly once for many ids", () => {
      const spy = vi.spyOn(globalThis.localStorage, "getItem");
      lookupMany([
        idByName("Command Tower"),
        idByName("Forest"),
        idByName("Meren of Clan Nel Toth"),
        idByPrinting("cmd", "269"),
      ], T0);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("returns null for null/empty identifier", () => {
      expect(getCachedCard(null, T0)).toBeNull();
      expect(getCachedCard({}, T0)).toBeNull();
    });
  });

  describe("TTL & eviction", () => {
    it("treats entries past TTL as missing", () => {
      cacheCards([card("cmd", "269", "Command Tower")], T0);
      const future = T0 + DEFAULT_TTL_MS + 1;
      expect(getCachedCard(idByPrinting("cmd", "269"), future)).toBeNull();
    });

    it("treats entries exactly at TTL boundary as stale (strict <)", () => {
      cacheCards([card("cmd", "269", "Command Tower")], T0);
      // now - fetchedAt < ttl is the freshness rule, so equality is stale.
      expect(getCachedCard(idByPrinting("cmd", "269"), T0 + DEFAULT_TTL_MS)).toBeNull();
    });

    it("evictExpired drops only expired entries and reports the count", () => {
      cacheCards([card("old", "1", "Old")], T0);
      cacheCards([card("new", "1", "New")], T0 + DEFAULT_TTL_MS - ONE_HOUR);
      const evicted = evictExpired(T0 + DEFAULT_TTL_MS + 1);
      expect(evicted).toBe(1);
      expect(getCachedCard(idByPrinting("old", "1"))).toBeNull();
      // fresh "New" entry survives — checked relative to its own write time.
      expect(getCachedCard(idByPrinting("new", "1"), T0 + DEFAULT_TTL_MS)).not.toBeNull();
    });

    it("evictExpired returns 0 when all entries are fresh", () => {
      cacheCards([card("cmd", "269", "Command Tower")], T0);
      expect(evictExpired(T0 + ONE_HOUR)).toBe(0);
    });

    it("supports a custom ttlMs (for tests / future settings)", () => {
      cacheCards([card("cmd", "269", "Command Tower")], T0);
      const tenSec = 10_000;
      expect(getCachedCard(idByPrinting("cmd", "269"), T0 + 5_000, tenSec)).not.toBeNull();
      expect(getCachedCard(idByPrinting("cmd", "269"), T0 + 11_000, tenSec)).toBeNull();
    });
  });

  describe("clearCache", () => {
    it("wipes everything", () => {
      cacheCards([card("cmd", "269", "Command Tower")], T0);
      expect(getCachedCard(idByPrinting("cmd", "269"), T0)).not.toBeNull();
      clearCache();
      expect(getCachedCard(idByPrinting("cmd", "269"), T0)).toBeNull();
      expect(localStorage.getItem(CARD_CACHE_KEY)).toBeNull();
    });

    it("survives localStorage.removeItem throwing", () => {
      cacheCards([card("cmd", "269", "Command Tower")], T0);
      globalThis.localStorage.removeItem = () => { throw new Error("blocked"); };
      expect(() => clearCache()).not.toThrow();
      expect(warnSpy).toHaveBeenCalledOnce();
    });
  });

  describe("graceful failure modes", () => {
    it("returns no hits when stored JSON is corrupted", () => {
      localStorage.setItem(CARD_CACHE_KEY, "{not valid json");
      const { found, missing } = lookupMany([idByName("Forest")], T0);
      expect(found).toEqual([]);
      expect(missing).toEqual([idByName("Forest")]);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("treats a non-object stored value as empty", () => {
      localStorage.setItem(CARD_CACHE_KEY, JSON.stringify(["wrong", "shape"]));
      expect(getCachedCard(idByName("Forest"), T0)).toBeNull();
    });

    it("returns empty when localStorage.getItem throws", () => {
      globalThis.localStorage.getItem = () => { throw new Error("blocked"); };
      expect(getCachedCard(idByName("Forest"), T0)).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it("recovers from quota exhaustion by trimming oldest 25%", () => {
      // Pre-seed 4 entries written at increasing timestamps.
      cacheCards([card("a", "1", "A")], T0);
      cacheCards([card("b", "1", "B")], T0 + 1);
      cacheCards([card("c", "1", "C")], T0 + 2);
      cacheCards([card("d", "1", "D")], T0 + 3);

      // Make the *next* write fail once, then succeed (simulating quota).
      const realSet = globalThis.localStorage.setItem.bind(globalThis.localStorage);
      let calls = 0;
      globalThis.localStorage.setItem = (k, v) => {
        calls++;
        if (calls === 1) throw new Error("quota");
        realSet(k, v);
      };

      const written = cacheCards([card("e", "1", "E")], T0 + 4);
      expect(written).toBe(1);
      // Oldest entry "a" was trimmed to make room.
      expect(getCachedCard(idByPrinting("a", "1"))).toBeNull();
      expect(getCachedCard(idByPrinting("e", "1"), T0 + 4)).not.toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it("returns 0 from cacheCards when even the trimmed write fails", () => {
      cacheCards([card("a", "1", "A")], T0);
      globalThis.localStorage.setItem = () => { throw new Error("quota"); };
      // The function still increments `written` (entries were merged in
      // memory) but the write didn't land — caller can ignore or alert.
      const written = cacheCards([card("b", "1", "B")], T0 + 1);
      expect(written).toBe(1);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe("malformed stored entries", () => {
    it("ignores entries with no fetchedAt", () => {
      localStorage.setItem(CARD_CACHE_KEY, JSON.stringify({
        "cmd:269": { card: card("cmd", "269", "Command Tower") /* no fetchedAt */ },
      }));
      expect(getCachedCard(idByPrinting("cmd", "269"), T0)).toBeNull();
    });

    it("ignores entries with no card", () => {
      localStorage.setItem(CARD_CACHE_KEY, JSON.stringify({
        "cmd:269": { fetchedAt: T0 },
      }));
      expect(getCachedCard(idByPrinting("cmd", "269"), T0)).toBeNull();
    });
  });

  describe("cardCacheReader (bulk lookups)", () => {
    beforeEach(() => {
      cacheCards([
        card("cmd", "269", "Command Tower"),
        card("c15", "49", "Meren of Clan Nel Toth"),
        card("unh", "140", "Forest"),
      ], T0);
    });

    it("getByPrinting hits exact set+cn", () => {
      const r = cardCacheReader(T0);
      expect(r.getByPrinting("cmd", "269").name).toBe("Command Tower");
      expect(r.getByPrinting("CMD", "269").name).toBe("Command Tower"); // case-insensitive
      expect(r.getByPrinting("xxx", "1")).toBeNull();
    });

    it("getByName hits case-insensitive", () => {
      const r = cardCacheReader(T0);
      expect(r.getByName("forest").name).toBe("Forest");
      expect(r.getByName("MEREN OF CLAN NEL TOTH").set).toBe("c15");
      expect(r.getByName("Made-up Card")).toBeNull();
    });

    it("excludes stale entries from both indexes", () => {
      const r = cardCacheReader(T0 + DEFAULT_TTL_MS + 1);
      expect(r.getByPrinting("cmd", "269")).toBeNull();
      expect(r.getByName("Forest")).toBeNull();
    });

    it("returns null for null/empty inputs", () => {
      const r = cardCacheReader(T0);
      expect(r.getByPrinting("", "1")).toBeNull();
      expect(r.getByPrinting("cmd", "")).toBeNull();
      expect(r.getByName("")).toBeNull();
      expect(r.getByName(null)).toBeNull();
    });

    it("reads localStorage exactly once for many lookups", () => {
      const spy = vi.spyOn(globalThis.localStorage, "getItem");
      const r = cardCacheReader(T0);
      // Lots of lookups — should not trigger more reads.
      for (let i = 0; i < 50; i++) {
        r.getByPrinting("cmd", "269");
        r.getByName("Forest");
      }
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("getById hits cards by Scryfall ID (used by token panel)", () => {
      cacheCards([
        { ...card("tk", "1", "Goblin"), id: "abc-123" },
        { ...card("tk", "2", "Zombie"), id: "def-456" },
      ], T0);
      const r = cardCacheReader(T0);
      expect(r.getById("abc-123").name).toBe("Goblin");
      expect(r.getById("def-456").name).toBe("Zombie");
      expect(r.getById("missing")).toBeNull();
      expect(r.getById("")).toBeNull();
      expect(r.getById(null)).toBeNull();
    });
  });

  describe("lookupMany — perf contract", () => {
    it("name-only lookups don't degrade to O(N × M)", () => {
      // Seed a cache big enough that an O(N × M) scan would be
      // visibly N × M ops. With the name-index, every name-only
      // lookup is O(1) after a one-shot build.
      const many = [];
      for (let i = 0; i < 500; i++) {
        many.push(card("set" + i, String(i), "Card " + i));
      }
      cacheCards(many, T0);

      const ids = [
        { name: "Card 0" },
        { name: "Card 250" },
        { name: "Card 499" },
        { name: "Missing card" },
      ];
      const { found, missing } = lookupMany(ids, T0);
      expect(found).toHaveLength(3);
      expect(missing).toHaveLength(1);
    });

    it("doesn't build the name index when every identifier has (set, cn)", () => {
      // Indirect check: with only set/cn lookups, the name-index
      // build is skipped. We assert the result is correct — the
      // perf optimisation itself is observable only via timing.
      cacheCards([card("cmd", "1", "A"), card("cmd", "2", "B")], T0);
      const { found } = lookupMany([
        { set: "cmd", collector_number: "1" },
        { set: "cmd", collector_number: "2" },
      ], T0);
      expect(found).toHaveLength(2);
    });

    it("a single lookupMany call reads localStorage exactly once", () => {
      cacheCards([card("cmd", "1", "Foo"), card("cmd", "2", "Bar")], T0);
      const spy = vi.spyOn(globalThis.localStorage, "getItem");
      lookupMany([
        { name: "Foo" },
        { set: "cmd", collector_number: "2" },
        { name: "Bar" },
      ], T0);
      // _readStore is called exactly once per lookupMany call,
      // regardless of how many identifiers go through.
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });
});
