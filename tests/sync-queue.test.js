import { describe, it, expect } from "vitest";
import {
  queueKeyForUid,
  isValidQueueEntry,
  dedupEnqueue,
} from "../js/sync-queue.js";

const validSave = { op: "save", deckId: "deck-1", deck: { id: "deck-1", name: "X" } };
const validDelete = { op: "delete", deckId: "deck-1" };

describe("queueKeyForUid", () => {
  it("is namespaced with the same prefix as other storage keys", () => {
    expect(queueKeyForUid("abc")).toMatch(/^mtg-hand-sim:/);
  });
  it("includes the uid so two users on the same browser don't share a queue", () => {
    /* This is the load-bearing property: without per-uid keys, a
     * logged-out user's pending writes would be drained into the next
     * user's account once they log in. */
    expect(queueKeyForUid("user-a")).not.toBe(queueKeyForUid("user-b"));
    expect(queueKeyForUid("user-a")).toContain("user-a");
  });
  it("rejects a missing or empty uid (callers must always have one)", () => {
    expect(() => queueKeyForUid("")).toThrow();
    expect(() => queueKeyForUid(null)).toThrow();
    expect(() => queueKeyForUid(undefined)).toThrow();
    expect(() => queueKeyForUid(42)).toThrow();
  });
});

describe("isValidQueueEntry", () => {
  it("accepts a well-formed save entry", () => {
    expect(isValidQueueEntry(validSave)).toBe(true);
  });
  it("accepts a well-formed delete entry (no deck body)", () => {
    expect(isValidQueueEntry(validDelete)).toBe(true);
  });
  it("rejects null/undefined/non-objects", () => {
    expect(isValidQueueEntry(null)).toBe(false);
    expect(isValidQueueEntry(undefined)).toBe(false);
    expect(isValidQueueEntry("save")).toBe(false);
    expect(isValidQueueEntry(42)).toBe(false);
  });
  it("rejects unknown op values", () => {
    expect(isValidQueueEntry({ ...validSave, op: "upsert" })).toBe(false);
    expect(isValidQueueEntry({ ...validSave, op: "" })).toBe(false);
  });
  it("rejects entries with missing or empty deckId", () => {
    expect(isValidQueueEntry({ op: "save", deck: {} })).toBe(false);
    expect(isValidQueueEntry({ op: "save", deckId: "", deck: {} })).toBe(false);
    expect(isValidQueueEntry({ op: "save", deckId: 42, deck: {} })).toBe(false);
  });
  it("rejects save entries with no deck body", () => {
    expect(isValidQueueEntry({ op: "save", deckId: "x" })).toBe(false);
    expect(isValidQueueEntry({ op: "save", deckId: "x", deck: null })).toBe(false);
  });
});

describe("dedupEnqueue", () => {
  it("appends to an empty queue", () => {
    expect(dedupEnqueue([], validSave)).toEqual([validSave]);
  });

  it("does not mutate the input queue", () => {
    const input = [validSave];
    const out = dedupEnqueue(input, { op: "save", deckId: "deck-2", deck: { id: "deck-2", name: "Y" } });
    expect(input).toEqual([validSave]);
    expect(out).not.toBe(input);
  });

  it("replaces a queued save for the same id (latest-wins)", () => {
    const first = { op: "save", deckId: "deck-1", deck: { id: "deck-1", name: "v1" } };
    const second = { op: "save", deckId: "deck-1", deck: { id: "deck-1", name: "v2" } };
    const out = dedupEnqueue([first], second);
    expect(out).toEqual([second]);
  });

  it("voids a queued save when a delete for the same id arrives", () => {
    const save = { op: "save", deckId: "deck-1", deck: { id: "deck-1", name: "X" } };
    const del = { op: "delete", deckId: "deck-1" };
    expect(dedupEnqueue([save], del)).toEqual([del]);
  });

  it("voids a queued delete when a save for the same id arrives", () => {
    const del = { op: "delete", deckId: "deck-1" };
    const save = { op: "save", deckId: "deck-1", deck: { id: "deck-1", name: "X" } };
    expect(dedupEnqueue([del], save)).toEqual([save]);
  });

  it("keeps entries for other deck ids untouched", () => {
    const a = { op: "save", deckId: "a", deck: { id: "a" } };
    const b = { op: "save", deckId: "b", deck: { id: "b" } };
    const aNew = { op: "save", deckId: "a", deck: { id: "a", name: "updated" } };
    const out = dedupEnqueue([a, b], aNew);
    /* b stays in place, a is dropped, aNew goes to the tail. */
    expect(out).toEqual([b, aNew]);
  });

  it("preserves arrival order for unrelated ids when adding a new one", () => {
    const a = { op: "save", deckId: "a", deck: { id: "a" } };
    const b = { op: "save", deckId: "b", deck: { id: "b" } };
    const c = { op: "delete", deckId: "c" };
    expect(dedupEnqueue([a, b], c)).toEqual([a, b, c]);
  });

  it("save→delete→save converges to just the final save", () => {
    let q = [];
    q = dedupEnqueue(q, { op: "save", deckId: "deck-1", deck: { id: "deck-1", name: "v1" } });
    q = dedupEnqueue(q, { op: "delete", deckId: "deck-1" });
    const final = { op: "save", deckId: "deck-1", deck: { id: "deck-1", name: "v3" } };
    q = dedupEnqueue(q, final);
    expect(q).toEqual([final]);
  });

  it("delete→save→delete converges to just the final delete", () => {
    let q = [];
    q = dedupEnqueue(q, { op: "delete", deckId: "deck-1" });
    q = dedupEnqueue(q, { op: "save", deckId: "deck-1", deck: { id: "deck-1" } });
    const finalDelete = { op: "delete", deckId: "deck-1" };
    q = dedupEnqueue(q, finalDelete);
    expect(q).toEqual([finalDelete]);
  });
});
