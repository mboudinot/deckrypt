/* User-deck persistence with shape validation.
 * Loading filters out corrupted/tampered entries instead of crashing the app. */

const STORAGE_KEY = "mtg-hand-sim:user-decks-v1";
const SEEDED_KEY = "mtg-hand-sim:defaults-seeded-v1";

function isValidDeckEntry(c) {
  return !!(c && typeof c === "object"
    && typeof c.name === "string" && c.name.length > 0);
}

function isValidDeckCard(c) {
  return isValidDeckEntry(c)
    && Number.isInteger(c.qty) && c.qty > 0;
}

/* `format` is optional for backward compatibility with decks saved
 * before the field existed. Allowed values: "commander" | "limited".
 * Anything else (including `undefined`) is tolerated; the runtime
 * helper deckFormatOf falls back to a size heuristic. */
const VALID_DECK_FORMATS = new Set(["commander", "limited"]);

function isValidDeck(d) {
  if (!d || typeof d !== "object") return false;
  if (typeof d.id !== "string" || d.id.length === 0) return false;
  if (typeof d.name !== "string" || d.name.length === 0) return false;
  if (!Array.isArray(d.commanders) || !d.commanders.every(isValidDeckEntry)) return false;
  if (!Array.isArray(d.cards) || !d.cards.every(isValidDeckCard)) return false;
  if (d.format !== undefined && !VALID_DECK_FORMATS.has(d.format)) return false;
  return true;
}

/* Default-deck seeding state. The flag is independent from the
 * user-decks key so the migration runs once per user — including
 * existing users whose decks predate the introduction of seeding. */
function hasSeededDefaults() {
  try {
    return localStorage.getItem(SEEDED_KEY) !== null;
  } catch (e) {
    return false;
  }
}

function markDefaultsSeeded() {
  try {
    localStorage.setItem(SEEDED_KEY, "1");
    return true;
  } catch (e) {
    return false;
  }
}

/* Pure merge: append every default whose id isn't already in `existing`.
 * Idempotent — running it twice with the same inputs returns the same
 * list. Caller decides whether to persist via saveUserDecks. */
function mergeDefaultsForSeeding(existing, defaults) {
  const ids = new Set(existing.map((d) => d.id));
  const additions = defaults.filter((d) => !ids.has(d.id));
  return additions.length === 0 ? existing : [...existing, ...additions];
}

function loadUserDecks() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.warn("localStorage unavailable:", e);
    return [];
  }
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn("Corrupted user-decks JSON, ignoring:", e);
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidDeck);
}

function saveUserDecks(decks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
    return true;
  } catch (e) {
    console.error("Failed to save user decks:", e);
    return false;
  }
}

/* CommonJS export for tests — no-op in the browser. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STORAGE_KEY, SEEDED_KEY, VALID_DECK_FORMATS,
    isValidDeck, isValidDeckEntry, isValidDeckCard,
    loadUserDecks, saveUserDecks,
    hasSeededDefaults, markDefaultsSeeded, mergeDefaultsForSeeding,
  };
}
