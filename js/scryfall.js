/* Scryfall API client + card data helpers.
 * Source of truth for card stats — never hardcode CMC/types/colors. */

const SCRYFALL_COLLECTION = "https://api.scryfall.com/cards/collection";
const SCRYFALL_AUTOCOMPLETE = "https://api.scryfall.com/cards/autocomplete";
const SCRYFALL_SEARCH = "https://api.scryfall.com/cards/search";
const SCRYFALL_BATCH_SIZE = 75;        // API hard limit per request
const SCRYFALL_TIMEOUT_MS = 10_000;    // abort hung requests after 10s
const SCRYFALL_RETRIES = 2;            // 1 try + 2 retries on transient failures
const SCRYFALL_RETRY_BASE_MS = 300;    // exponential backoff: 300ms, 900ms

// Allow only Scryfall-hosted images. Defense in depth in case the API
// response is ever tampered with (downgrade attack, MITM, compromise).
const SCRYFALL_IMG_HOST_RE = /^https:\/\/[a-z0-9-]+\.scryfall\.(io|com)\//i;

const COLOR_ORDER = ["W", "U", "B", "R", "G"];
const COLOR_NAMES = { W: "Blanc", U: "Bleu", B: "Noir", R: "Rouge", G: "Vert" };

/* Build a Scryfall identifier object from a deck entry. Prefers exact
 * printing (set + collector_number) when available, falls back to name. */
function makeIdentifier(entry) {
  if (entry.set && entry.collector_number) {
    return { set: entry.set.toLowerCase(), collector_number: String(entry.collector_number) };
  }
  return { name: entry.name };
}

/* Scryfall accepts several identifier shapes on /cards/collection:
 *   { set, collector_number }   exact printing
 *   { id: "<uuid>" }            Scryfall ID (used to fetch tokens
 *                               referenced via all_parts)
 *   { oracle_id: "<uuid>" }     same card across all printings
 *   { name }                    by name (any printing)
 * The fallback used to assume `name`, which crashed token fetching
 * with: "can't access property toLowerCase, id.name is undefined". */
function identifierKey(id) {
  if (id.set && id.collector_number) return `set:${id.set.toLowerCase()}:${id.collector_number}`;
  if (id.id) return `id:${id.id.toLowerCase()}`;
  if (id.oracle_id) return `oracle:${id.oracle_id.toLowerCase()}`;
  if (id.name) return `name:${id.name.toLowerCase()}`;
  return "unknown";
}

function cardKey(card) {
  return `set:${card.set.toLowerCase()}:${card.collector_number}`;
}

/* POST /cards/collection with retry on transient errors (5xx, 429,
 * network errors). Each attempt has its own timeout so a hung server
 * can't block longer than SCRYFALL_TIMEOUT_MS per try. */
async function postCollection(identifiers) {
  let lastErr;
  for (let attempt = 0; attempt <= SCRYFALL_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = SCRYFALL_RETRY_BASE_MS * Math.pow(3, attempt - 1);
      console.warn(`Scryfall retry ${attempt}/${SCRYFALL_RETRIES} after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SCRYFALL_TIMEOUT_MS);
    try {
      const res = await fetch(SCRYFALL_COLLECTION, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers }),
        signal: ctrl.signal,
      });
      const isRetryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (isRetryable) {
        lastErr = new Error(`Scryfall ${res.status} ${res.statusText}`);
        continue;
      }
      if (!res.ok) throw new Error(`Scryfall ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (err.name === "AbortError") {
        // Timeout — don't retry; the API or network is too slow.
        throw new Error(`Scryfall timeout (>${SCRYFALL_TIMEOUT_MS}ms)`);
      }
      // Network/DNS errors are TypeErrors in fetch — retry.
      if (err instanceof TypeError) {
        lastErr = err;
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("Scryfall: unknown error");
}

/* Batch-fetch cards via /cards/collection (75 max per request). */
async function fetchScryfallCards(identifiers) {
  const dedup = new Map();
  for (const id of identifiers) dedup.set(identifierKey(id), id);
  const unique = [...dedup.values()];

  const chunks = [];
  for (let i = 0; i < unique.length; i += SCRYFALL_BATCH_SIZE) {
    chunks.push(unique.slice(i, i + SCRYFALL_BATCH_SIZE));
  }

  const responses = await Promise.all(chunks.map(postCollection));

  const byKey = new Map();
  const byName = new Map();
  const notFound = [];
  for (const r of responses) {
    for (const card of (r.data || [])) {
      if (card.set && card.collector_number) byKey.set(cardKey(card), card);
      /* First-win on byName: when the batch holds two cards with the
       * same name but different printings (e.g. an entry by-name + an
       * entry by-set/cn for the same card), the FIRST one keeps the
       * name mapping so a name-only entry doesn't borrow the printing
       * picked for the set/cn-keyed entry. */
      if (card.name && !byName.has(card.name.toLowerCase())) {
        byName.set(card.name.toLowerCase(), card);
      }
    }
    for (const nf of (r.not_found || [])) {
      notFound.push(nf.name || `${nf.set || "?"} ${nf.collector_number || "?"}`);
    }
  }

  return { byKey, byName, notFound };
}

function resolveEntry(entry, byKey, byName) {
  if (entry.set && entry.collector_number) {
    const card = byKey.get(`set:${entry.set.toLowerCase()}:${entry.collector_number}`);
    if (card) return card;
  }
  return byName.get(entry.name.toLowerCase()) || null;
}

function makePlaceholder(name) {
  return {
    name, _placeholder: true,
    cmc: 0, type_line: "Unknown", produced_mana: [], image_uris: null,
  };
}

/* Card-data helpers (read directly off Scryfall card objects). */
function isLand(card) {
  return !!(card.type_line && card.type_line.toLowerCase().includes("land"));
}

/* Return a vetted image URL or null. Only HTTPS URLs hosted on a
 * Scryfall domain are accepted; anything else (data URIs, third parties,
 * non-string values) is rejected as a defense-in-depth measure. */
function cardImage(card, version = "small") {
  if (!card || card._placeholder) return null;
  let url = null;
  if (card.image_uris && card.image_uris[version]) url = card.image_uris[version];
  else if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
    url = card.card_faces[0].image_uris[version];
  }
  if (typeof url !== "string") return null;
  if (!SCRYFALL_IMG_HOST_RE.test(url)) return null;
  return url;
}

function manaSourcesOf(card) {
  if (!card.produced_mana) return [];
  return card.produced_mana.filter((c) => COLOR_ORDER.includes(c));
}

/* GET helper with the same timeout / abort behaviour as postCollection,
 * minus the retry loop — these endpoints are called interactively from
 * the manage view, so a long stall would block the user. Returns the
 * parsed JSON or throws. */
async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCRYFALL_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Scryfall ${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Scryfall timeout (>${SCRYFALL_TIMEOUT_MS}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* Suggest card names matching the prefix. Returns up to ~20 names.
 * Empty / too-short queries return [] without hitting the network.
 * This endpoint is English-only — see autocompleteCardNamesMultilingual
 * for combined EN + FR. */
async function autocompleteCardName(query) {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  const url = `${SCRYFALL_AUTOCOMPLETE}?q=${encodeURIComponent(q)}`;
  const json = await getJson(url);
  return Array.isArray(json.data) ? json.data : [];
}

/* Search Scryfall for cards whose French printed name matches the
 * query — the `lang:fr name:term` syntax tells Scryfall to filter
 * results to French printings and match against the printed (FR)
 * name. Returns full card objects so the caller can read both `name`
 * (English, used for deck-edit) and `printed_name` (French, for
 * display). 404 from the search endpoint means "no match" — we map
 * that to an empty array rather than re-throwing. */
async function searchFrenchByPartialName(query) {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  const url = `${SCRYFALL_SEARCH}?q=${encodeURIComponent(`lang:fr name:${q}`)}&unique=cards`;
  try {
    const json = await getJson(url);
    return Array.isArray(json.data) ? json.data : [];
  } catch (err) {
    if (/\b404\b/.test(err.message)) return [];
    throw err;
  }
}

/* Basic-land FR↔EN mapping. Scryfall's lang:fr name:term search
 * works for most cards but for very-common names like "marais" it
 * returns dozens of "Marais X" themed cards and the basic Swamp
 * falls past our 20-entry cap. Pinning the 5 basic lands locally
 * solves this without adding a second network round-trip. */
const BASIC_LAND_FR_NAMES = [
  { name: "Plains",   frenchName: "Plaine" },
  { name: "Island",   frenchName: "Île" },
  { name: "Swamp",    frenchName: "Marais" },
  { name: "Mountain", frenchName: "Montagne" },
  { name: "Forest",   frenchName: "Forêt" },
];

function _stripAccents(s) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function _basicLandSuggestions(query) {
  const q = _stripAccents(query);
  if (q.length < 2) return [];
  return BASIC_LAND_FR_NAMES.filter((b) =>
    _stripAccents(b.frenchName).includes(q)
    || _stripAccents(b.name).includes(q),
  );
}

/* Autocomplete across both languages. Runs the English autocomplete
 * and a French-name search in parallel, merges results by English
 * name. Each entry is `{ name, frenchName }` — the EN name is what
 * the deck-edit layer stores (single source of truth) and the FR
 * name is the display label when present.
 *
 * Basic lands are pinned to the top of the result list so typing
 * "marais" surfaces Swamp ahead of Scryfall's flood of "Marais X"
 * themed cards.
 *
 * Capped at 20 entries so the suggestion list stays scannable. The
 * cap is applied after merging so the user gets a good mix of EN
 * and FR matches rather than 20 of one and 0 of the other. */
async function autocompleteCardNamesMultilingual(query) {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  const [enNames, frHits] = await Promise.all([
    autocompleteCardName(q).catch(() => []),
    searchFrenchByPartialName(q).catch(() => []),
  ]);
  const merged = new Map();
  // Basic lands first — Map preserves insertion order, so they keep
  // the top slots even if Scryfall returns the same card later.
  for (const b of _basicLandSuggestions(q)) {
    merged.set(b.name, { name: b.name, frenchName: b.frenchName });
  }
  for (const name of enNames) {
    if (!merged.has(name)) merged.set(name, { name, frenchName: null });
  }
  for (const card of frHits) {
    if (!card.name) continue;
    const fr = card.lang === "fr" && card.printed_name ? card.printed_name : null;
    const entry = merged.get(card.name) || { name: card.name, frenchName: null };
    if (fr && !entry.frenchName) entry.frenchName = fr;
    merged.set(card.name, entry);
  }
  return [...merged.values()].slice(0, 20);
}

/* List every printing of an exact card name. The `q=!"name"` syntax
 * is Scryfall's exact-name match; `unique=prints` returns one card per
 * printing rather than collapsing them. Pagination beyond 175 printings
 * is ignored — it's the Scryfall hard limit per page anyway, and we'd
 * have UX problems before that mattered. */
async function searchPrintings(name) {
  const q = `!"${name.replace(/"/g, '\\"')}"`;
  const url = `${SCRYFALL_SEARCH}?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=desc`;
  try {
    const json = await getJson(url);
    return Array.isArray(json.data) ? json.data : [];
  } catch (err) {
    // 404 = no prints found (Scryfall returns 404 for empty searches).
    if (/\b404\b/.test(err.message)) return [];
    throw err;
  }
}

function deckProducedColors(resolved) {
  const set = new Set();
  for (const card of resolved.deck) {
    if (!isLand(card)) continue;
    for (const c of manaSourcesOf(card)) set.add(c);
  }
  return COLOR_ORDER.filter((c) => set.has(c));
}

/* CommonJS export for tests — no-op in the browser. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SCRYFALL_COLLECTION,
    SCRYFALL_BATCH_SIZE, SCRYFALL_TIMEOUT_MS,
    SCRYFALL_RETRIES, SCRYFALL_RETRY_BASE_MS, SCRYFALL_IMG_HOST_RE,
    COLOR_ORDER, COLOR_NAMES,
    makeIdentifier, identifierKey, cardKey,
    fetchScryfallCards, resolveEntry, makePlaceholder,
    autocompleteCardName, autocompleteCardNamesMultilingual,
    searchFrenchByPartialName, searchPrintings,
    isLand, cardImage, manaSourcesOf, deckProducedColors,
  };
}
