/* Decklist parser — MTGA / Moxfield / Archidekt format.
 *   "1 Card Name (SET) 123"      basic
 *   "1 Card Name (SET) 73★ *F*"  promo + foil
 *   "1 Card Name (PLST) EXO-128" The List style
 *   "1 Card Name"                name only
 *   "// COMMANDER"               section header
 *   "Commander", "Sideboard"     standalone keyword headers
 *
 * Hardening: bounded inputs to prevent DoS via pathological lists
 * (e.g. "1000000 Forest" expanding into a billion-entry array, a 100MB
 * textarea paste, or an unbounded card name).
 */

// Limits. Generous for any real format, tight enough to bound work.
const MAX_INPUT_LENGTH = 100_000;   // ~100KB of text
const MAX_LINES = 5_000;
const MAX_QTY_PER_LINE = 100;       // > any realistic basic-land count
const MAX_NAME_LENGTH = 200;
const MAX_TOTAL_CARDS = 250;        // Commander = 100; Standard 60+15; etc.

const SECTION_KEYWORDS = {
  commander: "commanders", commanders: "commanders",
  sideboard: "sideboard", side: "sideboard",
  mainboard: "main", main: "main", deck: "main", maindeck: "main",
};

function parseDecklist(text) {
  const result = {
    commanders: [], cards: [], errors: [],
    counts: { commanders: 0, main: 0, sideboard: 0 },
  };
  if (!text) return result;

  if (text.length > MAX_INPUT_LENGTH) {
    result.errors.push(`Liste trop longue (${text.length} caractères, max ${MAX_INPUT_LENGTH}).`);
    return result; // fatal: don't parse anything
  }

  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines.length > MAX_LINES) {
    result.errors.push(`Trop de lignes (${lines.length}, max ${MAX_LINES}).`);
    return result; // fatal
  }

  // Set code and collector number are independently optional:
  //   "1 Sol Ring"                 → name only
  //   "1 Sol Ring (CMD)"           → name + set, no collector
  //   "1 Sol Ring (CMD) 259"       → full
  //   "1 Sol Ring (CMD) 259 *F*"   → full + foil flag
  const cardRe = /^(\d+)\s+(.+?)(?:\s+\(([A-Za-z0-9]+)\)(?:\s+(\S+))?)?(?:\s+\*F\*)?\s*$/;

  let section = "main";
  let inCommanderBlock = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inCommanderBlock) { section = "main"; inCommanderBlock = false; }
      continue;
    }

    // Comment-style headers: "// COMMANDER"
    if (line.startsWith("//")) {
      const word = line.slice(2).trim().toLowerCase().replace(/[^a-z]/g, "");
      if (SECTION_KEYWORDS[word]) {
        section = SECTION_KEYWORDS[word];
        inCommanderBlock = (section === "commanders");
      }
      continue;
    }
    // Keyword-only headers: "Commander", "Sideboard"
    const wordOnly = line.toLowerCase().replace(/[:].*$/, "").trim();
    if (SECTION_KEYWORDS[wordOnly] && !/^\d/.test(line)) {
      section = SECTION_KEYWORDS[wordOnly];
      inCommanderBlock = (section === "commanders");
      continue;
    }

    const m = line.match(cardRe);
    if (!m) {
      result.errors.push(`Ligne ignorée : « ${line} »`);
      continue;
    }
    const qty = parseInt(m[1], 10);
    const name = m[2].trim();
    const set = m[3] || null;
    const collector = m[4] || null;

    if (qty > MAX_QTY_PER_LINE) {
      result.errors.push(`Quantité trop élevée (${qty}, max ${MAX_QTY_PER_LINE}) : « ${line} »`);
      continue;
    }
    if (name.length > MAX_NAME_LENGTH) {
      result.errors.push(`Nom trop long (${name.length} caractères, max ${MAX_NAME_LENGTH}).`);
      continue;
    }

    const entry = { name };
    if (set && collector) {
      entry.set = set.toLowerCase();
      entry.collector_number = collector;
    }

    if (section === "commanders") {
      for (let i = 0; i < qty; i++) result.commanders.push({ ...entry });
      result.counts.commanders += qty;
    } else if (section === "sideboard") {
      result.counts.sideboard += qty;
    } else {
      result.cards.push({ ...entry, qty });
      result.counts.main += qty;
    }
  }

  // Final cap: refuse imports that exceed the absolute deck-size limit.
  const total = result.counts.commanders + result.counts.main;
  if (total > MAX_TOTAL_CARDS) {
    result.errors.push(`Deck trop grand (${total} cartes, max ${MAX_TOTAL_CARDS}).`);
    result.commanders = [];
    result.cards = [];
    result.counts.commanders = 0;
    result.counts.main = 0;
  }

  return result;
}

/* CommonJS export for tests — no-op in the browser. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseDecklist, SECTION_KEYWORDS,
    MAX_INPUT_LENGTH, MAX_LINES, MAX_QTY_PER_LINE, MAX_NAME_LENGTH, MAX_TOTAL_CARDS,
  };
}
