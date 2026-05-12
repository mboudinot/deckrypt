/* French card-name translations, fetched via Scryfall and persisted
 * in localStorage.
 *
 * Scryfall doesn't expose translated names on /cards/collection. We
 * use /cards/search with `lang:fr` instead — the response carries
 * `printed_name` for each French printing. Names without a French
 * release are cached as empty string so we don't keep retrying.
 *
 * One batch query covers up to 10 names (the OR-joined query stays
 * well under any URL/syntax limit). For a 100-card EDH deck that's
 * ~10 round-trips, which the user sees as a brief "loading" state
 * the first time they switch to FR. After that everything's cached.
 */

const TRANSLATIONS_KEY = "mtg-hand-sim:translations-fr-v1";
const TRANSLATION_BATCH_SIZE = 10;
const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";

function _read() {
  let raw;
  try { raw = localStorage.getItem(TRANSLATIONS_KEY); }
  catch (e) { console.warn("Translations: storage unavailable", e); return {}; }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) {
    console.warn("Translations: corrupt JSON, resetting", e);
    return {};
  }
}

function _write(map) {
  try { localStorage.setItem(TRANSLATIONS_KEY, JSON.stringify(map)); return true; }
  catch (e) { console.warn("Translations: write failed", e); return false; }
}

/* Single-entry lookup. Returns the French name if cached, otherwise
 * null (caller decides whether to fall back to English). Empty-string
 * cache entries also return null — those mean "we tried and there's
 * no French printing", and treating them as null lets the UI fall
 * back gracefully. */
function getTranslation(englishName) {
  const v = _read()[englishName];
  return (typeof v === "string" && v.length > 0) ? v : null;
}

/* Bulk-lookup helper: reads the translation cache ONCE and returns a
 * per-name accessor closure. For renders that resolve many names in a
 * row (the manage view shows ~100 cards), this drops cost from N reads
 * to 1 read. Empty-string sentinels are returned as null, same as
 * getTranslation. */
function bulkTranslationLookup() {
  const map = _read();
  return (englishName) => {
    const v = map[englishName];
    return (typeof v === "string" && v.length > 0) ? v : null;
  };
}

/* Bulk fetch. Resolves once every name in `englishNames` either has
 * a translation in cache or has been recorded as "no FR printing".
 * Failures (network, 404, parse) are absorbed — we just record what
 * we got and move on.
 *
 * `onBatchComplete(batchNames)` (optional) is called after each batch
 * finishes (success or fail), letting the UI clear per-card loading
 * states progressively as translations land. */
async function fetchFrenchNames(englishNames, onBatchComplete) {
  if (!englishNames || englishNames.length === 0) return;
  const cache = _read();
  const missing = englishNames.filter((n) => !(n in cache));
  if (missing.length === 0) return;

  for (let i = 0; i < missing.length; i += TRANSLATION_BATCH_SIZE) {
    const batch = missing.slice(i, i + TRANSLATION_BATCH_SIZE);
    const ors = batch.map((n) => `!"${n.replace(/"/g, '\\"')}"`).join(" or ");
    const q = `lang:fr (${ors})`;
    const url = `${SCRYFALL_SEARCH_URL}?q=${encodeURIComponent(q)}&unique=cards`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        for (const card of data.data || []) {
          if (card.name && card.printed_name) {
            cache[card.name] = card.printed_name;
          }
        }
      }
      // 404 and other non-OK statuses fall through to the "mark missing
      // as empty string" pass below — Scryfall returns 404 for empty
      // search results.
    } catch (e) {
      // Network / abort — leave the batch unmarked so a future
      // fetchFrenchNames retries (in case the user re-toggles later).
      // Still notify the caller that the batch is "done" so the UI
      // can move on.
      if (typeof onBatchComplete === "function") {
        try { onBatchComplete(batch); } catch (cbErr) { /* don't break the loop */ }
      }
      continue;
    }
    // Anything unanswered in this batch gets a sentinel to avoid
    // re-querying it on every toggle.
    for (const n of batch) if (!(n in cache)) cache[n] = "";
    // Persist after each batch so getTranslation calls between
    // batches see the latest data — the per-card UI relies on this.
    _write(cache);
    if (typeof onBatchComplete === "function") {
      try { onBatchComplete(batch); } catch (cbErr) { /* don't break the loop */ }
    }
  }
}

function clearTranslations() {
  try { localStorage.removeItem(TRANSLATIONS_KEY); }
  catch (e) { /* nothing to do — already inaccessible */ }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TRANSLATIONS_KEY, TRANSLATION_BATCH_SIZE,
    getTranslation, bulkTranslationLookup, fetchFrenchNames, clearTranslations,
  };
}
