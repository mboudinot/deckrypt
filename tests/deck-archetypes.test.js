import { describe, it, expect } from "vitest";
import {
  archetypeSignals,
  detectArchetypes,
} from "../js/deck-archetypes.js";

const card = (overrides = {}) => ({
  name: "X",
  type_line: "Creature — Bear",
  cmc: 2,
  power: "2", toughness: "2",
  oracle_text: "",
  produced_mana: [],
  ...overrides,
});

const land = () => card({ type_line: "Basic Land — Forest", cmc: 0, produced_mana: ["G"] });

/* Deck builders for each archetype — each constructs a deck whose
 * signals should make the corresponding rule win. */
const buildAggro = () => {
  const deck = [];
  // 32 small evasive creatures with low CMC
  for (let i = 0; i < 32; i++) {
    deck.push(card({
      type_line: "Creature — Faerie", cmc: 1,
      power: "1", toughness: "1",
      oracle_text: "Flying.",
    }));
  }
  // A few cheap auras / removal
  for (let i = 0; i < 6; i++) deck.push(card({ type_line: "Instant", cmc: 1, oracle_text: "Destroy target creature." }));
  // Lands
  for (let i = 0; i < 36; i++) deck.push(land());
  return { commanders: [], deck };
};

const buildControl = () => {
  const deck = [];
  for (let i = 0; i < 10; i++) deck.push(card({ type_line: "Instant", cmc: 2, oracle_text: "Counter target spell." }));
  for (let i = 0; i < 12; i++) deck.push(card({ type_line: "Instant", cmc: 2, oracle_text: "Destroy target permanent." }));
  for (let i = 0; i < 4; i++) deck.push(card({ type_line: "Sorcery", cmc: 4, oracle_text: "Destroy all creatures." }));
  for (let i = 0; i < 12; i++) deck.push(card({ type_line: "Instant", cmc: 2, oracle_text: "Draw two cards." }));
  for (let i = 0; i < 8; i++) deck.push(card({ type_line: "Creature — Wall", cmc: 3, power: "0", toughness: "4" }));
  for (let i = 0; i < 36; i++) deck.push(land());
  return { commanders: [], deck };
};

const buildCombo = () => {
  const deck = [];
  for (let i = 0; i < 8; i++) deck.push(card({
    type_line: "Sorcery", cmc: 2,
    oracle_text: "Search your library for a creature card and put it onto the battlefield.",
  }));
  for (let i = 0; i < 14; i++) deck.push(card({ type_line: "Instant", cmc: 1, oracle_text: "Draw three cards." }));
  for (let i = 0; i < 12; i++) deck.push(card({ type_line: "Artifact", cmc: 2, produced_mana: ["C"] }));
  for (let i = 0; i < 10; i++) deck.push(card({ type_line: "Creature — Wizard", cmc: 2, power: "1", toughness: "1" }));
  for (let i = 0; i < 36; i++) deck.push(land());
  return { commanders: [], deck };
};

const buildVoltron = () => {
  const deck = [];
  for (let i = 0; i < 12; i++) deck.push(card({
    type_line: "Enchantment — Aura", cmc: 2,
    oracle_text: "Enchanted creature has flying and can't be blocked.",
  }));
  for (let i = 0; i < 8; i++) deck.push(card({
    type_line: "Artifact — Equipment", cmc: 2,
    oracle_text: "Equipped creature gets +2/+2 and has trample.",
  }));
  for (let i = 0; i < 12; i++) deck.push(card({
    type_line: "Creature — Knight", cmc: 2,
    power: "2", toughness: "2",
    oracle_text: "Hexproof.",
  }));
  for (let i = 0; i < 4; i++) deck.push(card({ type_line: "Instant", cmc: 2, oracle_text: "Destroy target creature." }));
  for (let i = 0; i < 36; i++) deck.push(land());
  return { commanders: [], deck };
};

const buildAristocrats = () => {
  const deck = [];
  for (let i = 0; i < 6; i++) deck.push(card({
    type_line: "Artifact", cmc: 1,
    oracle_text: "Sacrifice a creature: each opponent loses 1 life.",
  }));
  for (let i = 0; i < 8; i++) deck.push(card({
    type_line: "Creature — Spirit", cmc: 1,
    oracle_text: "When this creature dies, create a 1/1 Spirit creature token.",
  }));
  for (let i = 0; i < 4; i++) deck.push(card({
    type_line: "Sorcery", cmc: 3,
    oracle_text: "Return target creature card from your graveyard to the battlefield.",
  }));
  for (let i = 0; i < 14; i++) deck.push(card({ type_line: "Creature — Zombie", cmc: 2, power: "2", toughness: "2" }));
  for (let i = 0; i < 36; i++) deck.push(land());
  return { commanders: [], deck };
};

const buildReanimator = () => {
  const deck = [];
  for (let i = 0; i < 6; i++) deck.push(card({
    type_line: "Sorcery", cmc: 2,
    oracle_text: "Return target creature card from your graveyard to the battlefield.",
  }));
  for (let i = 0; i < 6; i++) deck.push(card({
    type_line: "Sorcery", cmc: 1,
    oracle_text: "Discard a card. Then draw a card.",
  }));
  for (let i = 0; i < 8; i++) deck.push(card({
    type_line: "Creature — Dragon", cmc: 8,
    power: "8", toughness: "8",
    oracle_text: "Flying, trample.",
  }));
  for (let i = 0; i < 5; i++) deck.push(card({
    type_line: "Sorcery", cmc: 2,
    oracle_text: "Search your library for a creature card and put it into your hand.",
  }));
  for (let i = 0; i < 36; i++) deck.push(land());
  return { commanders: [], deck };
};

const buildMidrange = () => {
  const deck = [];
  // Balanced curve at 3 CMC, 25 creatures, moderate everything
  for (let i = 0; i < 25; i++) deck.push(card({
    type_line: "Creature — Elf", cmc: 3,
    power: "3", toughness: "3",
  }));
  for (let i = 0; i < 8; i++) deck.push(card({ type_line: "Instant", cmc: 2, oracle_text: "Destroy target creature." }));
  for (let i = 0; i < 10; i++) deck.push(card({
    type_line: "Sorcery", cmc: 3,
    oracle_text: "Search your library for a basic land card and put it onto the battlefield tapped.",
  }));
  for (let i = 0; i < 8; i++) deck.push(card({ type_line: "Sorcery", cmc: 4, oracle_text: "Draw two cards." }));
  for (let i = 0; i < 36; i++) deck.push(land());
  return { commanders: [], deck };
};

describe("archetypeSignals", () => {
  it("counts creatures, lands, auras and equipment correctly", () => {
    const deck = [
      card({ type_line: "Creature — Bear" }),
      card({ type_line: "Creature — Bird" }),
      card({ type_line: "Enchantment — Aura" }),
      card({ type_line: "Artifact — Equipment" }),
      land(),
    ];
    const s = archetypeSignals(deck);
    expect(s.creatureCount).toBe(2);
    expect(s.auraCount).toBe(1);
    expect(s.equipmentCount).toBe(1);
    expect(s.voltronPieces).toBe(2);
    expect(s.nonLandCount).toBe(4);
  });

  it("flags big creatures (P+T ≥ 10)", () => {
    const deck = [
      card({ type_line: "Creature — Dragon", power: "5", toughness: "5" }), // 10
      card({ type_line: "Creature — Bear", power: "2", toughness: "2" }),    // 4
    ];
    expect(archetypeSignals(deck).bigCreatures).toBe(1);
  });

  it("counts mana producers (lands + non-land producers) for ramp", () => {
    const deck = [
      card({ type_line: "Artifact", produced_mana: ["C"] }),     // mana rock
      card({ type_line: "Creature — Elf", produced_mana: ["G"] }), // dork
      card({ type_line: "Sorcery", oracle_text: "Search your library for a basic land card." }),
    ];
    expect(archetypeSignals(deck).ramp).toBe(3);
  });
});

describe("detectArchetypes", () => {
  it("aggro deck → top archetype is Aggro / Tempo", () => {
    const out = detectArchetypes(buildAggro());
    expect(out[0].key).toBe("aggro");
  });

  it("control deck → top archetype is Contrôle", () => {
    const out = detectArchetypes(buildControl());
    expect(out[0].key).toBe("control");
  });

  it("combo deck → top archetype is Combo", () => {
    const out = detectArchetypes(buildCombo());
    expect(out[0].key).toBe("combo");
  });

  it("voltron deck → top archetype is Voltron", () => {
    const out = detectArchetypes(buildVoltron());
    expect(out[0].key).toBe("voltron");
  });

  it("aristocrats deck → top archetype is Aristocrats", () => {
    const out = detectArchetypes(buildAristocrats());
    expect(out[0].key).toBe("aristocrats");
  });

  it("reanimator deck → top archetype is Réanimator", () => {
    const out = detectArchetypes(buildReanimator());
    expect(out[0].key).toBe("reanimator");
  });

  it("midrange deck → top archetype is Midrange (balanced signals)", () => {
    const out = detectArchetypes(buildMidrange());
    expect(out[0].key).toBe("midrange");
  });

  it("each detected archetype carries a confidence in [0, 1]", () => {
    for (const a of detectArchetypes(buildControl())) {
      expect(a.confidence).toBeGreaterThanOrEqual(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("archetypes are sorted by confidence descending", () => {
    const out = detectArchetypes(buildAristocrats());
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].confidence).toBeGreaterThanOrEqual(out[i].confidence);
    }
  });

  it("a deck with no clear plan stays under the confidence threshold", () => {
    // Mid-CMC vanilla creatures + lands. No spells, no auras, no
    // text. Nothing fits any archetype profile cleanly — every score
    // is well below the 35 % gate.
    const deck = [
      ...Array.from({ length: 30 }, () => card({
        type_line: "Creature — Bear", cmc: 4, power: "3", toughness: "3",
      })),
      ...Array.from({ length: 36 }, () => land()),
    ];
    expect(detectArchetypes({ commanders: [], deck })).toEqual([]);
  });

  it("returns [] for null / empty input", () => {
    expect(detectArchetypes(null)).toEqual([]);
    expect(detectArchetypes({ commanders: [], deck: [] })).toEqual([]);
  });

  it("custom minConfidence threshold filters more aggressively", () => {
    const allDetected = detectArchetypes(buildControl(), { minConfidence: 0 });
    const strictOnly = detectArchetypes(buildControl(), { minConfidence: 0.9 });
    expect(strictOnly.length).toBeLessThanOrEqual(allDetected.length);
  });
});
