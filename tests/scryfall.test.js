import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isLand, cardImage, manaSourcesOf, deckProducedColors,
  makeIdentifier, identifierKey, cardKey, makePlaceholder,
  resolveEntry, fetchScryfallCards,
  autocompleteCardName, searchPrintings,
} from "../js/scryfall.js";

describe("isLand", () => {
  it("detects basic lands", () => {
    expect(isLand({ type_line: "Basic Land — Forest" })).toBe(true);
  });
  it("detects nonbasic lands", () => {
    expect(isLand({ type_line: "Land — Island Swamp" })).toBe(true);
  });
  it("returns false for creatures", () => {
    expect(isLand({ type_line: "Creature — Bird" })).toBe(false);
  });
  it("returns false when type_line is missing", () => {
    expect(isLand({})).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(isLand({ type_line: "LAND" })).toBe(true);
  });
});

describe("cardImage", () => {
  const SCRYFALL_SMALL = "https://cards.scryfall.io/small/front/abc.jpg";
  const SCRYFALL_NORMAL = "https://cards.scryfall.io/normal/front/abc.jpg";

  it("returns the small image_uris by default", () => {
    const card = { image_uris: { small: SCRYFALL_SMALL, normal: SCRYFALL_NORMAL } };
    expect(cardImage(card)).toBe(SCRYFALL_SMALL);
  });
  it("returns normal image_uris when requested", () => {
    const card = { image_uris: { small: SCRYFALL_SMALL, normal: SCRYFALL_NORMAL } };
    expect(cardImage(card, "normal")).toBe(SCRYFALL_NORMAL);
  });
  it("falls back to the first card_face for DFCs", () => {
    const card = { card_faces: [{ image_uris: { small: SCRYFALL_SMALL } }] };
    expect(cardImage(card)).toBe(SCRYFALL_SMALL);
  });
  it("returns null for placeholders", () => {
    expect(cardImage({ _placeholder: true, name: "x" })).toBeNull();
  });
  it("returns null for cards with no images", () => {
    expect(cardImage({ name: "x" })).toBeNull();
  });
  it("returns null for null/undefined card", () => {
    expect(cardImage(null)).toBeNull();
    expect(cardImage(undefined)).toBeNull();
  });

  // Defense in depth: reject anything that isn't a Scryfall HTTPS URL.
  it("rejects non-Scryfall URLs", () => {
    const card = { image_uris: { small: "https://evil.example.com/x.jpg" } };
    expect(cardImage(card)).toBeNull();
  });
  it("rejects HTTP (non-HTTPS) URLs", () => {
    const card = { image_uris: { small: "http://cards.scryfall.io/small/x.jpg" } };
    expect(cardImage(card)).toBeNull();
  });
  it("rejects data: URIs", () => {
    const card = { image_uris: { small: "data:image/png;base64,iVBOR..." } };
    expect(cardImage(card)).toBeNull();
  });
  it("rejects javascript: URIs", () => {
    const card = { image_uris: { small: "javascript:alert(1)" } };
    expect(cardImage(card)).toBeNull();
  });
  it("rejects non-string URL values", () => {
    const card = { image_uris: { small: { href: SCRYFALL_SMALL } } };
    expect(cardImage(card)).toBeNull();
  });
});

describe("manaSourcesOf", () => {
  it("returns produced colors", () => {
    expect(manaSourcesOf({ produced_mana: ["U", "B"] })).toEqual(["U", "B"]);
  });
  it("filters out colorless (C)", () => {
    expect(manaSourcesOf({ produced_mana: ["G", "C"] })).toEqual(["G"]);
  });
  it("returns empty when produced_mana is missing", () => {
    expect(manaSourcesOf({})).toEqual([]);
  });
});

describe("deckProducedColors", () => {
  it("aggregates colors from lands only, in WUBRG order", () => {
    const resolved = {
      deck: [
        { type_line: "Land — Forest", produced_mana: ["G"] },
        { type_line: "Land — Island", produced_mana: ["U"] },
        // Creature with mana ability — must NOT count toward sources.
        { type_line: "Creature — Druid", produced_mana: ["W"] },
      ],
    };
    expect(deckProducedColors(resolved)).toEqual(["U", "G"]);
  });
  it("dedupes across multiple lands", () => {
    const resolved = {
      deck: [
        { type_line: "Land", produced_mana: ["U"] },
        { type_line: "Land", produced_mana: ["U", "B"] },
      ],
    };
    expect(deckProducedColors(resolved)).toEqual(["U", "B"]);
  });
  it("returns empty for an all-creatures deck", () => {
    expect(deckProducedColors({ deck: [{ type_line: "Creature" }] })).toEqual([]);
  });
});

describe("makeIdentifier", () => {
  it("prefers set + collector_number", () => {
    expect(makeIdentifier({ name: "X", set: "CMD", collector_number: "259" }))
      .toEqual({ set: "cmd", collector_number: "259" });
  });
  it("falls back to name when collector_number is missing", () => {
    expect(makeIdentifier({ name: "X", set: "CMD" })).toEqual({ name: "X" });
  });
  it("falls back to name when set is missing", () => {
    expect(makeIdentifier({ name: "X", collector_number: "259" }))
      .toEqual({ name: "X" });
  });
  it("normalizes set to lowercase and stringifies the collector", () => {
    expect(makeIdentifier({ name: "X", set: "CMD", collector_number: 259 }))
      .toEqual({ set: "cmd", collector_number: "259" });
  });
});

describe("identifierKey / cardKey", () => {
  it("identifierKey is stable for set+collector", () => {
    expect(identifierKey({ set: "cmd", collector_number: "259" }))
      .toBe("set:cmd:259");
  });
  it("identifierKey is stable for name", () => {
    expect(identifierKey({ name: "Sol Ring" })).toBe("name:sol ring");
  });
  it("identifierKey normalizes set case", () => {
    expect(identifierKey({ set: "CMD", collector_number: "259" }))
      .toBe("set:cmd:259");
  });
  it("cardKey matches identifierKey for the same printing", () => {
    const card = { set: "cmd", collector_number: "259" };
    const id = { set: "cmd", collector_number: "259" };
    expect(cardKey(card)).toBe(identifierKey(id));
  });

  it("identifierKey supports {id} (Scryfall UUID — used by token fetch)", () => {
    expect(identifierKey({ id: "70F8A1DE-CD4C-4AFA-BF03-0245D375D42E" }))
      .toBe("id:70f8a1de-cd4c-4afa-bf03-0245d375d42e");
  });

  it("identifierKey supports {oracle_id}", () => {
    expect(identifierKey({ oracle_id: "ABCDEF" })).toBe("oracle:abcdef");
  });

  it("identifierKey doesn't crash when only an id is provided", () => {
    // Regression: the fallback used to call `id.name.toLowerCase()`
    // which threw on token identifiers like {id: "<uuid>"}.
    expect(() => identifierKey({ id: "xxx" })).not.toThrow();
  });

  it("identifierKey returns a sentinel for unknown identifier shapes", () => {
    expect(identifierKey({})).toBe("unknown");
  });
});

describe("makePlaceholder", () => {
  it("creates a non-rendering, type-safe placeholder", () => {
    const p = makePlaceholder("Unknown Card");
    expect(p.name).toBe("Unknown Card");
    expect(p._placeholder).toBe(true);
    expect(cardImage(p)).toBeNull();
    expect(isLand(p)).toBe(false);
    expect(manaSourcesOf(p)).toEqual([]);
  });
});

describe("resolveEntry", () => {
  const island = { name: "Island", set: "lea", collector_number: "289" };
  const sol = { name: "Sol Ring", set: "cmd", collector_number: "259" };
  const byKey = new Map([
    ["set:lea:289", island],
    ["set:cmd:259", sol],
  ]);
  const byName = new Map([
    ["island", island],
    ["sol ring", sol],
  ]);

  it("matches by set+collector when both provided", () => {
    expect(resolveEntry({ name: "X", set: "lea", collector_number: "289" }, byKey, byName))
      .toBe(island);
  });
  it("falls back to name match", () => {
    expect(resolveEntry({ name: "Sol Ring" }, byKey, byName)).toBe(sol);
  });
  it("returns null when nothing matches", () => {
    expect(resolveEntry({ name: "Unknown" }, byKey, byName)).toBeNull();
  });
});

describe("fetchScryfallCards", () => {
  let warnSpy;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    // Silence the retry log noise. We assert on it where relevant.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.fetch;
  });

  it("dedupes identifiers before sending", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ name: "Sol Ring" }], not_found: [] }),
    });
    await fetchScryfallCards([
      { name: "Sol Ring" }, { name: "Sol Ring" }, { name: "Sol Ring" },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.identifiers).toHaveLength(1);
  });

  it("batches > 75 identifiers into multiple requests", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], not_found: [] }),
    });
    const ids = Array.from({ length: 80 }, (_, i) => ({ name: `Card${i}` }));
    await fetchScryfallCards(ids);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("collects not_found entries", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ name: "Found Card" }],
        not_found: [{ name: "Missing Card" }],
      }),
    });
    const r = await fetchScryfallCards([
      { name: "Found Card" }, { name: "Missing Card" },
    ]);
    expect(r.notFound).toEqual(["Missing Card"]);
    expect(r.byName.has("found card")).toBe(true);
  });

  it("indexes returned cards by both name and set+collector", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ name: "Sol Ring", set: "cmd", collector_number: "259" }],
        not_found: [],
      }),
    });
    const r = await fetchScryfallCards([{ name: "Sol Ring" }]);
    expect(r.byName.get("sol ring")).toBeTruthy();
    expect(r.byKey.get("set:cmd:259")).toBeTruthy();
  });

  it("throws immediately on a non-retryable 4xx response", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 400, statusText: "Bad Request",
      json: async () => ({}),
    });
    await expect(fetchScryfallCards([{ name: "X" }]))
      .rejects.toThrow(/Scryfall 400/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("throws a timeout error when the fetch is aborted (no retry)", async () => {
    vi.useFakeTimers();
    globalThis.fetch.mockImplementation((url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    }));
    const promise = fetchScryfallCards([{ name: "X" }]);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(11_000);
    await expect(promise).rejects.toThrow(/timeout/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("fetchScryfallCards — retry behavior", () => {
  let warnSpy;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.fetch;
  });

  it("retries on 5xx and succeeds on the 2nd attempt", async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable", json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ name: "Sol Ring" }], not_found: [] }) });
    const promise = fetchScryfallCards([{ name: "Sol Ring" }]);
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    const r = await promise;
    expect(r.byName.get("sol ring")).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 (rate limited)", async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests", json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [], not_found: [] }) });
    const promise = fetchScryfallCards([{ name: "X" }]);
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await promise;
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on network TypeError", async () => {
    globalThis.fetch
      .mockRejectedValueOnce(new TypeError("Network error"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [], not_found: [] }) });
    const promise = fetchScryfallCards([{ name: "X" }]);
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await promise;
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after SCRYFALL_RETRIES retries on persistent 500", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 500, statusText: "Internal Server Error",
      json: async () => ({}),
    });
    const promise = fetchScryfallCards([{ name: "X" }]);
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/Scryfall 500/);
    // 1 initial + 2 retries = 3 attempts.
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 4xx (other than 429)", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 404, statusText: "Not Found",
      json: async () => ({}),
    });
    const promise = fetchScryfallCards([{ name: "X" }]);
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/Scryfall 404/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("autocompleteCardName", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); delete globalThis.fetch; });

  it("returns the suggestion list for a valid query", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: ["Sol Ring", "Sol", "Solar Tide"] }),
    });
    const out = await autocompleteCardName("sol");
    expect(out).toEqual(["Sol Ring", "Sol", "Solar Tide"]);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(/cards\/autocomplete\?q=sol$/);
  });

  it("returns [] without hitting the network for queries < 2 chars", async () => {
    expect(await autocompleteCardName("")).toEqual([]);
    expect(await autocompleteCardName("s")).toEqual([]);
    expect(await autocompleteCardName("  ")).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("URL-encodes the query (special chars don't break the request)", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true, json: async () => ({ data: [] }),
    });
    await autocompleteCardName("Mox & Co");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("q=Mox%20%26%20Co");
  });

  it("returns [] when the response has no data array", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true, json: async () => ({}),
    });
    expect(await autocompleteCardName("xyz")).toEqual([]);
  });

  it("propagates HTTP errors as Error", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 500, statusText: "Internal",
    });
    await expect(autocompleteCardName("foo")).rejects.toThrow(/Scryfall 500/);
  });
});

describe("searchPrintings", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); delete globalThis.fetch; });

  it("builds an exact-name query with unique=prints", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ name: "Sol Ring", set: "cmd" }] }),
    });
    await searchPrintings("Sol Ring");
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/cards/search");
    expect(url).toContain("unique=prints");
    // !"Sol Ring" → URL-encoded
    expect(decodeURIComponent(url)).toContain('q=!"Sol Ring"');
  });

  it("escapes embedded double quotes in the card name", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true, json: async () => ({ data: [] }),
    });
    await searchPrintings('Card "Quoted" Name');
    const decoded = decodeURIComponent(globalThis.fetch.mock.calls[0][0]);
    expect(decoded).toContain('!"Card \\"Quoted\\" Name"');
  });

  it("returns the printings array", async () => {
    const data = [
      { name: "Sol Ring", set: "cmd", collector_number: "259" },
      { name: "Sol Ring", set: "lea", collector_number: "270" },
    ];
    globalThis.fetch.mockResolvedValue({
      ok: true, json: async () => ({ data }),
    });
    const out = await searchPrintings("Sol Ring");
    expect(out).toHaveLength(2);
    expect(out[0].set).toBe("cmd");
  });

  it("treats 404 as 'no printings' (Scryfall returns 404 for empty searches)", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 404, statusText: "Not Found",
    });
    expect(await searchPrintings("Nonexistent Card")).toEqual([]);
  });

  it("propagates non-404 HTTP errors", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false, status: 500, statusText: "Internal",
    });
    await expect(searchPrintings("X")).rejects.toThrow(/Scryfall 500/);
  });
});
