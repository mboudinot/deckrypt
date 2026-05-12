import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TRANSLATIONS_KEY,
  getTranslation, bulkTranslationLookup,
  fetchFrenchNames, clearTranslations,
} from "../js/translations.js";

describe("translations", () => {
  let warnSpy;

  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      clear: () => { store.clear(); },
    };
    globalThis.fetch = vi.fn();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.fetch;
    delete globalThis.localStorage;
  });

  it("getTranslation returns null on a cold cache", () => {
    expect(getTranslation("Sol Ring")).toBeNull();
  });

  it("getTranslation returns the cached French name", () => {
    localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify({ "Sol Ring": "Anneau solaire" }));
    expect(getTranslation("Sol Ring")).toBe("Anneau solaire");
  });

  it("getTranslation treats empty-string cache as 'no FR printing'", () => {
    // Empty-string sentinel — we tried, Scryfall had nothing, don't retry.
    localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify({ "Custom Card": "" }));
    expect(getTranslation("Custom Card")).toBeNull();
  });

  it("fetchFrenchNames does nothing for an empty input", async () => {
    await fetchFrenchNames([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fetchFrenchNames hits Scryfall and stores printed_name in cache", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { name: "Sol Ring", lang: "fr", printed_name: "Anneau solaire" },
          { name: "Lightning Bolt", lang: "fr", printed_name: "Foudre" },
        ],
      }),
    });
    await fetchFrenchNames(["Sol Ring", "Lightning Bolt"]);
    expect(getTranslation("Sol Ring")).toBe("Anneau solaire");
    expect(getTranslation("Lightning Bolt")).toBe("Foudre");
  });

  it("fetchFrenchNames builds a Scryfall search query with lang:fr", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    await fetchFrenchNames(["Sol Ring"]);
    const url = globalThis.fetch.mock.calls[0][0];
    expect(decodeURIComponent(url)).toContain('lang:fr');
    expect(decodeURIComponent(url)).toContain('!"Sol Ring"');
  });

  it("fetchFrenchNames batches into chunks of 10", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    const names = Array.from({ length: 23 }, (_, i) => `Card${i}`);
    await fetchFrenchNames(names);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3); // 10 + 10 + 3
  });

  it("fetchFrenchNames skips already-cached names on subsequent calls", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ name: "Sol Ring", lang: "fr", printed_name: "Anneau solaire" }],
      }),
    });
    await fetchFrenchNames(["Sol Ring"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await fetchFrenchNames(["Sol Ring"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no new request
  });

  it("fetchFrenchNames marks missing names with empty string (avoid retry forever)", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    await fetchFrenchNames(["Made-up Card"]);
    // Internal state: stored as "" so a re-fetch is a no-op.
    expect(getTranslation("Made-up Card")).toBeNull();

    globalThis.fetch.mockClear();
    await fetchFrenchNames(["Made-up Card"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fetchFrenchNames absorbs network errors and leaves cache mostly intact", async () => {
    globalThis.fetch.mockRejectedValue(new Error("network"));
    // Should not throw to the caller.
    await expect(fetchFrenchNames(["Sol Ring"])).resolves.toBeUndefined();
    // Network error: we don't poison the cache, so a future retry is allowed.
    expect(getTranslation("Sol Ring")).toBeNull();
    globalThis.fetch.mockClear();
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ name: "Sol Ring", printed_name: "Anneau solaire" }],
      }),
    });
    await fetchFrenchNames(["Sol Ring"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(getTranslation("Sol Ring")).toBe("Anneau solaire");
  });

  it("fetchFrenchNames absorbs HTTP error responses", async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });
    await expect(fetchFrenchNames(["Made-up Card"])).resolves.toBeUndefined();
    // 404 from Scryfall = "no results"; treat as miss + cache to avoid retry.
    globalThis.fetch.mockClear();
    await fetchFrenchNames(["Made-up Card"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("clearTranslations wipes the entire cache", () => {
    localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify({ "Sol Ring": "Anneau solaire" }));
    clearTranslations();
    expect(getTranslation("Sol Ring")).toBeNull();
  });

  it("recovers gracefully from a corrupted JSON cache", () => {
    localStorage.setItem(TRANSLATIONS_KEY, "{not valid json");
    expect(getTranslation("Sol Ring")).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("escapes embedded quotes in card names for the search query", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    await fetchFrenchNames(['Card "with quotes"']);
    const url = decodeURIComponent(globalThis.fetch.mock.calls[0][0]);
    expect(url).toContain('!"Card \\"with quotes\\""');
  });

  it("calls onBatchComplete once per batch with the batch's names", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    const onBatch = vi.fn();
    const names = Array.from({ length: 23 }, (_, i) => `Card${i}`);
    await fetchFrenchNames(names, onBatch);
    expect(onBatch).toHaveBeenCalledTimes(3); // 10 + 10 + 3
    expect(onBatch.mock.calls[0][0]).toHaveLength(10);
    expect(onBatch.mock.calls[2][0]).toHaveLength(3);
  });

  it("onBatchComplete still fires when a batch's network call rejects", async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
    const onBatch = vi.fn();
    const names = Array.from({ length: 25 }, (_, i) => `Card${i}`);
    await fetchFrenchNames(names, onBatch);
    expect(onBatch).toHaveBeenCalledTimes(3);
  });

  describe("bulkTranslationLookup", () => {
    it("returns a per-name accessor that reads storage exactly once", () => {
      localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify({
        "Sol Ring": "Anneau solaire",
        "Forest": "Forêt",
      }));
      const spy = vi.spyOn(globalThis.localStorage, "getItem");
      const lookup = bulkTranslationLookup();
      for (let i = 0; i < 50; i++) {
        expect(lookup("Sol Ring")).toBe("Anneau solaire");
        expect(lookup("Forest")).toBe("Forêt");
      }
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("returns null for missing names and empty-string sentinels", () => {
      localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify({
        "Made-up Card": "",
      }));
      const lookup = bulkTranslationLookup();
      expect(lookup("Made-up Card")).toBeNull();
      expect(lookup("Anything")).toBeNull();
    });
  });

  it("persists translations after each batch (visible mid-fetch)", async () => {
    let batchIdx = 0;
    globalThis.fetch.mockImplementation(async () => {
      batchIdx++;
      return {
        ok: true,
        json: async () => ({
          data: batchIdx === 1
            ? [{ name: "Card0", printed_name: "Carte0" }]
            : [{ name: "Card15", printed_name: "Carte15" }],
        }),
      };
    });
    const seen = [];
    const names = Array.from({ length: 16 }, (_, i) => `Card${i}`);
    await fetchFrenchNames(names, () => {
      // After first batch, the FR name for Card0 must already be readable
      // (the per-card UI relies on this persistence-between-batches).
      seen.push(getTranslation("Card0"));
    });
    expect(seen[0]).toBe("Carte0");
  });
});
