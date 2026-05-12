import { describe, it, expect, beforeEach } from "vitest";
import {
  STARTING_HAND_SIZE, ZONES,
  shuffle, createGame, findInstance, moveInstance,
  drawCards, fetchByName, libraryCount,
  toggleTap, nextTurn, canMulligan, mulligan,
  _resetInstanceSeq,
} from "../js/game.js";

const fakeCard = (name) => ({ name, type_line: "Creature" });
const buildDeck = (n) => ({
  deck: Array.from({ length: n }, (_, i) => fakeCard(`Card${i}`)),
});

beforeEach(() => _resetInstanceSeq());

describe("shuffle", () => {
  it("returns the same elements (different reference)", () => {
    const arr = [1, 2, 3, 4, 5];
    const out = shuffle(arr);
    expect(out).not.toBe(arr);
    expect(out.slice().sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("createGame", () => {
  it("starts with 7 in hand, the rest in library, others empty", () => {
    const g = createGame(buildDeck(60));
    expect(g.hand).toHaveLength(7);
    expect(g.library).toHaveLength(53);
    expect(g.battlefield).toEqual([]);
    expect(g.graveyard).toEqual([]);
    expect(g.turn).toBe(1);
    expect(g.mulligans).toBe(0);
  });

  it("gives each instance a unique ID", () => {
    const g = createGame(buildDeck(60));
    const ids = new Set();
    for (const z of ZONES) for (const i of g[z]) ids.add(i.instanceId);
    expect(ids.size).toBe(60);
  });

  it("draws fewer than 7 if the deck is smaller", () => {
    const g = createGame(buildDeck(3));
    expect(g.hand).toHaveLength(3);
    expect(g.library).toEqual([]);
  });

  it("respects custom hand size", () => {
    const g = createGame(buildDeck(20), 4);
    expect(g.hand).toHaveLength(4);
    expect(g.library).toHaveLength(16);
  });
});

describe("findInstance", () => {
  it("finds an instance in any zone", () => {
    const g = createGame(buildDeck(40));
    const target = g.hand[3];
    const found = findInstance(g, target.instanceId);
    expect(found.zone).toBe("hand");
    expect(found.instance).toBe(target);
  });
  it("returns null for unknown ids", () => {
    const g = createGame(buildDeck(40));
    expect(findInstance(g, "nope")).toBeNull();
  });
});

describe("moveInstance", () => {
  let g;
  beforeEach(() => { g = createGame(buildDeck(40)); });

  it("moves a hand card to the battlefield", () => {
    const inst = g.hand[0];
    expect(moveInstance(g, inst.instanceId, "battlefield")).toBe(true);
    expect(g.hand).not.toContain(inst);
    expect(g.battlefield).toContain(inst);
  });

  it("returns false for unknown instance", () => {
    expect(moveInstance(g, "no-such-id", "battlefield")).toBe(false);
  });

  it("returns false if already in target zone", () => {
    const inst = g.hand[0];
    moveInstance(g, inst.instanceId, "battlefield");
    expect(moveInstance(g, inst.instanceId, "battlefield")).toBe(false);
  });

  it("returns false for invalid zones", () => {
    const inst = g.hand[0];
    expect(moveInstance(g, inst.instanceId, "exile")).toBe(false);
    expect(moveInstance(g, inst.instanceId, "")).toBe(false);
  });

  it("auto-untaps cards leaving the battlefield", () => {
    const inst = g.hand[0];
    moveInstance(g, inst.instanceId, "battlefield");
    inst.tapped = true;
    moveInstance(g, inst.instanceId, "graveyard");
    expect(inst.tapped).toBe(false);
  });
});

describe("drawCards", () => {
  it("moves N cards from library to hand", () => {
    const g = createGame(buildDeck(40));
    const before = g.library.length;
    expect(drawCards(g, 3)).toBe(3);
    expect(g.library).toHaveLength(before - 3);
    expect(g.hand).toHaveLength(STARTING_HAND_SIZE + 3);
  });

  it("draws as many as available when N > library size", () => {
    const g = createGame(buildDeck(8));
    expect(drawCards(g, 5)).toBe(1);
    expect(g.library).toEqual([]);
  });

  it("returns 0 when library is empty", () => {
    const g = createGame(buildDeck(7));
    expect(drawCards(g, 1)).toBe(0);
  });

  it("defaults to 1 card", () => {
    const g = createGame(buildDeck(40));
    const before = g.hand.length;
    drawCards(g);
    expect(g.hand.length).toBe(before + 1);
  });
});

describe("toggleTap", () => {
  let g, inst;
  beforeEach(() => {
    g = createGame(buildDeck(40));
    inst = g.hand[0];
    moveInstance(g, inst.instanceId, "battlefield");
  });

  it("toggles tapped on a battlefield instance", () => {
    expect(toggleTap(g, inst.instanceId)).toBe(true);
    expect(inst.tapped).toBe(true);
    expect(toggleTap(g, inst.instanceId)).toBe(true);
    expect(inst.tapped).toBe(false);
  });

  it("does nothing for cards outside the battlefield", () => {
    const handInst = g.hand[0];
    expect(toggleTap(g, handInst.instanceId)).toBe(false);
    expect(handInst.tapped).toBe(false);
  });
});

describe("nextTurn", () => {
  it("increments the turn counter", () => {
    const g = createGame(buildDeck(40));
    nextTurn(g);
    expect(g.turn).toBe(2);
  });

  it("draws 1 card", () => {
    const g = createGame(buildDeck(40));
    const before = g.hand.length;
    nextTurn(g);
    expect(g.hand).toHaveLength(before + 1);
  });

  it("untaps every battlefield card", () => {
    const g = createGame(buildDeck(40));
    const a = g.hand[0], b = g.hand[1];
    moveInstance(g, a.instanceId, "battlefield");
    moveInstance(g, b.instanceId, "battlefield");
    a.tapped = true; b.tapped = true;
    nextTurn(g);
    expect(a.tapped).toBe(false);
    expect(b.tapped).toBe(false);
  });

  it("survives an empty library (turn advances, no draw)", () => {
    const g = createGame(buildDeck(7)); // empty library after opening hand
    nextTurn(g);
    expect(g.turn).toBe(2);
    expect(g.hand).toHaveLength(7);
  });
});

describe("canMulligan / mulligan", () => {
  it("allows mulligan at turn 1 with a clean board", () => {
    const g = createGame(buildDeck(40));
    expect(canMulligan(g)).toBe(true);
  });

  it("disables mulligan after a play", () => {
    const g = createGame(buildDeck(40));
    moveInstance(g, g.hand[0].instanceId, "battlefield");
    expect(canMulligan(g)).toBe(false);
  });

  it("disables mulligan after something hits the graveyard", () => {
    const g = createGame(buildDeck(40));
    moveInstance(g, g.hand[0].instanceId, "graveyard");
    expect(canMulligan(g)).toBe(false);
  });

  it("disables mulligan past turn 1", () => {
    const g = createGame(buildDeck(40));
    nextTurn(g);
    expect(canMulligan(g)).toBe(false);
  });

  it("can mulligan up to STARTING_HAND_SIZE - 1 times (down to 1 card)", () => {
    const r = buildDeck(40);
    const g = createGame(r);
    for (let i = 0; i < STARTING_HAND_SIZE - 1; i++) {
      expect(canMulligan(g)).toBe(true);
      expect(mulligan(g, r)).toBe(true);
    }
    expect(g.mulligans).toBe(STARTING_HAND_SIZE - 1);
    expect(g.hand).toHaveLength(1);
    expect(canMulligan(g)).toBe(false);
    expect(mulligan(g, r)).toBe(false);
  });

  it("performs a mulligan with a shrunk hand", () => {
    const r = buildDeck(40);
    const g = createGame(r);
    expect(mulligan(g, r)).toBe(true);
    expect(g.hand).toHaveLength(6);
    expect(g.mulligans).toBe(1);
    expect(g.battlefield).toEqual([]);
    expect(g.graveyard).toEqual([]);
  });
});

/* Build a game with a specific library composition so we can drive the
 * "fetch a basic land" code paths deterministically (createGame shuffles
 * and pre-deals, which would obscure what we're testing). */
function gameWithLibrary(names) {
  return {
    library: names.map((name, i) => ({
      instanceId: `lib-${i}`,
      card: { name, type_line: "Basic Land" },
      tapped: false,
    })),
    hand: [],
    battlefield: [],
    graveyard: [],
    turn: 1,
    mulligans: 0,
  };
}

describe("libraryCount", () => {
  it("counts every matching library card", () => {
    const g = gameWithLibrary(["Forest", "Plains", "Forest", "Forest", "Island"]);
    expect(libraryCount(g, "Forest")).toBe(3);
    expect(libraryCount(g, "Plains")).toBe(1);
    expect(libraryCount(g, "Island")).toBe(1);
  });

  it("returns 0 when no library card matches", () => {
    const g = gameWithLibrary(["Island", "Counterspell"]);
    expect(libraryCount(g, "Plains")).toBe(0);
  });

  it("returns 0 on an empty library", () => {
    expect(libraryCount(gameWithLibrary([]), "Forest")).toBe(0);
  });

  it("ignores cards in other zones — only the library counts", () => {
    const g = gameWithLibrary([]);
    g.hand.push({ instanceId: "h1", card: { name: "Plains" }, tapped: false });
    g.battlefield.push({ instanceId: "b1", card: { name: "Plains" }, tapped: false });
    expect(libraryCount(g, "Plains")).toBe(0);
  });

  it("matches names exactly (no fuzzy / no snow basics)", () => {
    const g = gameWithLibrary(["Snow-Covered Plains"]);
    expect(libraryCount(g, "Plains")).toBe(0);
  });

  it("decrements after fetchByName moves a copy out of the library", () => {
    const g = gameWithLibrary(["Forest", "Forest", "Forest"]);
    expect(libraryCount(g, "Forest")).toBe(3);
    fetchByName(g, "Forest");
    expect(libraryCount(g, "Forest")).toBe(2);
    fetchByName(g, "Forest");
    fetchByName(g, "Forest");
    expect(libraryCount(g, "Forest")).toBe(0);
    // One more fetch fails, count stays at 0 — the contract that drives
    // the disabled state of the matching basic-land button.
    expect(fetchByName(g, "Forest")).toBe(false);
    expect(libraryCount(g, "Forest")).toBe(0);
  });
});

describe("fetchByName", () => {
  it("moves the first matching library card to the hand", () => {
    const g = gameWithLibrary(["Lightning Bolt", "Plains", "Island"]);
    expect(fetchByName(g, "Plains")).toBe(true);
    expect(g.hand).toHaveLength(1);
    expect(g.hand[0].card.name).toBe("Plains");
    expect(g.library).toHaveLength(2);
    expect(g.library.map((i) => i.card.name)).toEqual(["Lightning Bolt", "Island"]);
  });

  it("removes only one copy when multiple are present", () => {
    const g = gameWithLibrary(["Forest", "Forest", "Forest"]);
    expect(fetchByName(g, "Forest")).toBe(true);
    expect(g.hand).toHaveLength(1);
    expect(g.library).toHaveLength(2);
  });

  it("returns false and leaves state untouched when no match exists", () => {
    const g = gameWithLibrary(["Island", "Counterspell"]);
    expect(fetchByName(g, "Plains")).toBe(false);
    expect(g.hand).toEqual([]);
    expect(g.library).toHaveLength(2);
  });

  it("returns false on an empty library (UI button should be disabled)", () => {
    const g = gameWithLibrary([]);
    expect(fetchByName(g, "Plains")).toBe(false);
    expect(g.hand).toEqual([]);
  });

  it("preserves the instance reference (same instanceId in hand)", () => {
    const g = gameWithLibrary(["Plains"]);
    const id = g.library[0].instanceId;
    fetchByName(g, "Plains");
    expect(g.hand[0].instanceId).toBe(id);
  });
});

describe("command zone", () => {
  const buildDeckWithCommanders = (n, commanders) => ({
    deck: Array.from({ length: n }, (_, i) => fakeCard(`Card${i}`)),
    commanders: commanders.map(fakeCard),
  });

  it("createGame puts each commander in the command zone as an instance", () => {
    const r = buildDeckWithCommanders(50, ["Atraxa", "Krenko"]);
    const g = createGame(r);
    expect(g.command).toHaveLength(2);
    expect(g.command.map((i) => i.card.name)).toEqual(["Atraxa", "Krenko"]);
    expect(g.command[0].instanceId).toBeTruthy();
    expect(g.command[0].tapped).toBe(false);
  });

  it("createGame leaves the command zone empty when no commanders", () => {
    const g = createGame(buildDeck(60));
    expect(g.command).toEqual([]);
  });

  it("ZONES includes 'command' so findInstance / moveInstance reach it", () => {
    expect(ZONES).toContain("command");
  });

  it("commander instance IDs are unique across all zones", () => {
    const r = buildDeckWithCommanders(60, ["Atraxa"]);
    const g = createGame(r);
    const ids = new Set();
    for (const z of ZONES) for (const i of g[z]) ids.add(i.instanceId);
    expect(ids.size).toBe(61); // 60 deck + 1 commander
  });

  it("findInstance locates a commander by its instanceId", () => {
    const r = buildDeckWithCommanders(50, ["Atraxa"]);
    const g = createGame(r);
    const id = g.command[0].instanceId;
    const found = findInstance(g, id);
    expect(found.zone).toBe("command");
    expect(found.instance.card.name).toBe("Atraxa");
  });

  it("moveInstance casts a commander to the battlefield", () => {
    const r = buildDeckWithCommanders(50, ["Atraxa"]);
    const g = createGame(r);
    const id = g.command[0].instanceId;
    expect(moveInstance(g, id, "battlefield")).toBe(true);
    expect(g.command).toEqual([]);
    expect(g.battlefield).toHaveLength(1);
    expect(g.battlefield[0].card.name).toBe("Atraxa");
  });

  it("moveInstance returns a commander from battlefield to command (undo)", () => {
    const r = buildDeckWithCommanders(50, ["Atraxa"]);
    const g = createGame(r);
    const id = g.command[0].instanceId;
    moveInstance(g, id, "battlefield");
    expect(moveInstance(g, id, "command")).toBe(true);
    expect(g.battlefield).toEqual([]);
    expect(g.command).toHaveLength(1);
  });

  it("a commander returning to command zone untaps (battlefield exit rule)", () => {
    const r = buildDeckWithCommanders(50, ["Atraxa"]);
    const g = createGame(r);
    const id = g.command[0].instanceId;
    moveInstance(g, id, "battlefield");
    toggleTap(g, id);
    expect(findInstance(g, id).instance.tapped).toBe(true);
    moveInstance(g, id, "command");
    expect(findInstance(g, id).instance.tapped).toBe(false);
  });

  it("mulligan refreshes the command zone with new instance IDs", () => {
    const r = buildDeckWithCommanders(40, ["Atraxa"]);
    const g = createGame(r);
    const oldId = g.command[0].instanceId;
    expect(mulligan(g, r)).toBe(true);
    expect(g.command).toHaveLength(1);
    expect(g.command[0].card.name).toBe("Atraxa");
    expect(g.command[0].instanceId).not.toBe(oldId);
  });
});
