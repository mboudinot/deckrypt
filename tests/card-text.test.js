import { describe, it, expect } from "vitest";
import { oracleText, drawsCards, isLandCard, isMdfcLand, isLandDrop } from "../js/card-text.js";

describe("oracleText", () => {
  it("returns the top-level oracle_text for single-face cards", () => {
    expect(oracleText({ oracle_text: "Flying" })).toBe("Flying");
  });

  it("joins every face when there's no top-level text", () => {
    expect(oracleText({
      card_faces: [{ oracle_text: "Flying" }, { oracle_text: "Draw a card." }],
    })).toBe("Flying\nDraw a card.");
  });

  it("skips faces without text (vanilla front side)", () => {
    expect(oracleText({
      card_faces: [{ oracle_text: "" }, { oracle_text: "Draw a card." }],
    })).toBe("Draw a card.");
  });

  it("returns an empty string for missing data", () => {
    expect(oracleText(null)).toBe("");
    expect(oracleText({})).toBe("");
  });
});

describe("drawsCards", () => {
  const draws = (oracle_text) => drawsCards({ oracle_text });

  it.each([
    ["Divination", "Draw two cards."],
    ["Pitiless Carnage", "Sacrifice any number of permanents you control, then draw that many cards.\nPlot {1}{B}{B}"],
    ["Rishkar's Expertise", "Draw cards equal to the greatest power among creatures you control.\nYou may cast a spell with mana value 5 or less from your hand without paying its mana cost."],
    ["Rhystic Study", "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}."],
    ["Howling Mine", "At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card."],
    ["Phyrexian Arena", "At the beginning of your upkeep, you draw a card and you lose 1 life."],
    ["Sylvan Library", "At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn."],
    ["Faithless Looting", "Draw two cards, then discard two cards.\nFlashback {2}{R}"],
    ["Mind Stone", "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card."],
    ["Ancestral Recall", "Target player draws three cards."],
    ["Secret Rendezvous", "You and target opponent each draw three cards."],
    ["Notion Thief", "Flash\nIf an opponent would draw a card except the first one they draw in each of their draw steps, instead you skip that draw and you draw a card."],
  ])("counts %s", (_name, text) => {
    expect(draws(text)).toBe(true);
  });

  it.each([
    ["Narset, Parter of Veils", "Each opponent can't draw more than one card each turn."],
    ["Laboratory Maniac", "If you would draw a card while your library has no cards in it, you win the game instead."],
    ["a draw punisher", "Whenever an opponent draws a card, this creature deals 1 damage to that player."],
    ["a first-draw trigger", "Whenever you draw your second card each turn, put a +1/+1 counter on this creature."],
    ["removal with compensation", "Destroy target creature. Its controller draws a card."],
    ["a draw-step reference", "Skip your draw step."],
    ["a drawn-cards count", "This spell costs {1} less to cast for each card you've drawn this turn."],
  ])("ignores %s", (_name, text) => {
    expect(draws(text)).toBe(false);
  });
});

describe("land classification", () => {
  const seaGate = { layout: "modal_dfc", type_line: "Sorcery // Land" };
  const pathway = { layout: "modal_dfc", type_line: "Land // Land" };
  const ixalanFlip = { layout: "transform", type_line: "Legendary Creature — Vampire // Legendary Land" };

  it("reads the front face: a spell // land MDFC isn't a land", () => {
    expect(isLandCard(seaGate)).toBe(false);
    expect(isLandCard(pathway)).toBe(true);
    expect(isLandCard({ type_line: "Basic Land — Forest" })).toBe(true);
  });
  it("flags spell // land MDFCs only — not pathways, not transform backs", () => {
    expect(isMdfcLand(seaGate)).toBe(true);
    expect(isMdfcLand(pathway)).toBe(false);
    expect(isMdfcLand(ixalanFlip)).toBe(false);
  });
  it("counts both lands and spell // land MDFCs as land drops", () => {
    expect([seaGate, pathway, ixalanFlip].filter(isLandDrop)).toEqual([seaGate, pathway]);
  });
});
