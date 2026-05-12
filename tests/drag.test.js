import { describe, it, expect } from "vitest";
import { DRAG_TRANSITIONS, canTransition } from "../js/drag.js";

describe("DRAG_TRANSITIONS", () => {
  it("declares hand, battlefield, graveyard and command as the only sources", () => {
    expect(Object.keys(DRAG_TRANSITIONS).sort()).toEqual([
      "battlefield",
      "command",
      "graveyard",
      "hand",
    ]);
  });

  it("never lists a zone as its own destination", () => {
    for (const [from, tos] of Object.entries(DRAG_TRANSITIONS)) {
      expect(tos).not.toContain(from);
    }
  });
});

describe("canTransition", () => {
  describe("allowed moves", () => {
    it("hand → battlefield (play a card)", () => {
      expect(canTransition("hand", "battlefield")).toBe(true);
    });
    it("hand → graveyard (discard)", () => {
      expect(canTransition("hand", "graveyard")).toBe(true);
    });
    it("battlefield → hand (undo a play)", () => {
      expect(canTransition("battlefield", "hand")).toBe(true);
    });
    it("graveyard → hand (recover a card)", () => {
      expect(canTransition("graveyard", "hand")).toBe(true);
    });
    it("command → battlefield (cast a commander)", () => {
      expect(canTransition("command", "battlefield")).toBe(true);
    });
    it("battlefield → command (return a commander, undo)", () => {
      expect(canTransition("battlefield", "command")).toBe(true);
    });
    it("battlefield → graveyard (sacrifice / dies)", () => {
      expect(canTransition("battlefield", "graveyard")).toBe(true);
    });
    it("graveyard → battlefield (reanimate / undo)", () => {
      expect(canTransition("graveyard", "battlefield")).toBe(true);
    });
  });

  describe("rejected moves", () => {
    it("rejects any move involving the library", () => {
      expect(canTransition("library", "hand")).toBe(false);
      expect(canTransition("hand", "library")).toBe(false);
    });

    it("rejects hand ↔ command (commanders never come from the hand)", () => {
      expect(canTransition("hand", "command")).toBe(false);
      expect(canTransition("command", "hand")).toBe(false);
    });

    it("rejects graveyard ↔ command", () => {
      expect(canTransition("graveyard", "command")).toBe(false);
      expect(canTransition("command", "graveyard")).toBe(false);
    });

    it("rejects same-zone drops", () => {
      for (const z of ["hand", "battlefield", "graveyard"]) {
        expect(canTransition(z, z)).toBe(false);
      }
    });

    it("rejects unknown source zones", () => {
      expect(canTransition("exile", "hand")).toBe(false);
    });

    it("rejects unknown destination zones", () => {
      expect(canTransition("hand", "exile")).toBe(false);
    });
  });

  describe("guard against no drag in progress", () => {
    it("rejects null source", () => {
      expect(canTransition(null, "hand")).toBe(false);
    });
    it("rejects undefined source", () => {
      expect(canTransition(undefined, "battlefield")).toBe(false);
    });
    it("rejects empty-string source", () => {
      expect(canTransition("", "hand")).toBe(false);
    });
  });
});
