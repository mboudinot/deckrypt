/* Persistent cache for Scryfall card data, backed by localStorage.
 *
 * Decklists already live in storage.js; this layer caches the resolved
 * card metadata (name, cmc, type_line, colors, image_uris, …) so a
 * page reload doesn't re-hit Scryfall for cards we already know.
 *
 * Cards are keyed by their printing (`<set>:<collector_number>`,
 * lowercased). Name-only lookups scan the store — typical decklist
 * size keeps that O(N) scan well under a millisecond. Each entry
 * carries a `fetchedAt` timestamp; entries past `ttlMs` are treated
 * as missing and evicted in batch.
 *
 * Failure modes are all soft: corrupted JSON, missing localStorage,
 * quota exhaustion → the cache silently degrades to "miss" and the
 * caller falls back to a network fetch.
 */

const CARD_CACHE_KEY = "mtg-hand-sim:scryfall-cache-v1";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function _readStore() {
  let raw;
  try {
    raw = localStorage.getItem(CARD_CACHE_KEY);
  } catch (e) {
    console.warn("Card cache: localStorage unavailable", e);
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch (e) {
    console.warn("Card cache: corrupted JSON, resetting", e);
    return {};
  }
}

/* On quota exhaustion, drop the oldest 25% of entries and retry once.
 * Slow-but-rare hot path — only triggered when localStorage is full. */
function _writeStore(store) {
  try {
    localStorage.setItem(CARD_CACHE_KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    const trimmed = _trimOldest(store, 0.25);
    try {
      localStorage.setItem(CARD_CACHE_KEY, JSON.stringify(trimmed));
      console.warn("Card cache: trimmed oldest entries to fit quota");
      return true;
    } catch (e2) {
      console.error("Card cache: write failed even after trim", e2);
      return false;
    }
  }
}

function _trimOldest(store, fraction) {
  const entries = Object.entries(store);
  if (entries.length === 0) return store;
  entries.sort((a, b) => (a[1].fetchedAt || 0) - (b[1].fetchedAt || 0));
  const dropCount = Math.max(1, Math.ceil(entries.length * fraction));
  return Object.fromEntries(entries.slice(dropCount));
}

function _isFresh(entry, now, ttlMs) {
  if (!entry || typeof entry.fetchedAt !== "number" || !entry.card) return false;
  return now - entry.fetchedAt < ttlMs;
}

function _printingKey(card) {
  if (!card.set || !card.collector_number) return null;
  return `${card.set.toLowerCase()}:${card.collector_number}`;
}

function _lookup(store, identifier, now, ttlMs) {
  if (!identifier) return null;
  if (identifier.set && identifier.collector_number) {
    const k = `${identifier.set.toLowerCase()}:${identifier.collector_number}`;
    return _isFresh(store[k], now, ttlMs) ? store[k].card : null;
  }
  if (identifier.name) {
    const lname = identifier.name.toLowerCase();
    for (const entry of Object.values(store)) {
      if (!_isFresh(entry, now, ttlMs)) continue;
      if (entry.card.name && entry.card.name.toLowerCase() === lname) {
        return entry.card;
      }
    }
  }
  return null;
}

/* Bulk lookup. Single store read for the whole batch.
 *
 * For name-only identifiers (common in user decks where the user
 * types a name without a printing), we build a one-shot name index
 * up front rather than re-scanning the whole store on each lookup —
 * that turns O(N × M) into O(N + M) where N is identifier count and
 * M is cache size. Critical once the cache grows past a few hundred
 * entries (every printing the user has ever fetched accumulates). */
function lookupMany(identifiers, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  const store = _readStore();
  let byName = null;
  for (const id of identifiers) {
    if (id && !id.set && !id.id && id.name) { byName = new Map(); break; }
  }
  if (byName) {
    for (const entry of Object.values(store)) {
      if (!_isFresh(entry, now, ttlMs)) continue;
      const n = entry.card.name && entry.card.name.toLowerCase();
      if (n && !byName.has(n)) byName.set(n, entry.card);
    }
  }
  const found = [];
  const missing = [];
  for (const id of identifiers) {
    let card = null;
    if (id) {
      if (id.set && id.collector_number) {
        const k = `${id.set.toLowerCase()}:${id.collector_number}`;
        if (_isFresh(store[k], now, ttlMs)) card = store[k].card;
      } else if (id.name && byName) {
        card = byName.get(id.name.toLowerCase()) || null;
      }
    }
    if (card) found.push(card);
    else missing.push(id);
  }
  return { found, missing };
}

/* Single-identifier convenience used by tests and ad-hoc calls. */
function getCachedCard(identifier, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  return _lookup(_readStore(), identifier, now, ttlMs);
}

/* Bulk-lookup helper: reads the cache ONCE and returns indexed lookup
 * functions. For UIs that resolve many entries against the cache
 * (rendering a 100-card deck list, for example), this avoids the
 * N × readStore() / parse cost — dropping render time from O(N × M)
 * to O(M + N) where M is cache size, N is deck size.
 *
 * Returns: { getByPrinting(set, cn), getByName(name) }. Both return
 * the card object or null. Entries past TTL are filtered at build
 * time, so callers don't worry about freshness. */
function cardCacheReader(now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  const store = _readStore();
  const byPrinting = new Map();
  const byNameLower = new Map();
  const byScryfallId = new Map();
  for (const entry of Object.values(store)) {
    if (!_isFresh(entry, now, ttlMs)) continue;
    const card = entry.card;
    const k = _printingKey(card);
    if (k) byPrinting.set(k, card);
    if (card.name) {
      const lname = card.name.toLowerCase();
      // First-seen wins — multiple printings of the same name share data.
      if (!byNameLower.has(lname)) byNameLower.set(lname, card);
    }
    // Index Scryfall IDs too — tokens are looked up by `{id}` not
    // (set, cn), and we don't want every render to round-trip
    // Scryfall when the cache already has them.
    if (card.id) byScryfallId.set(card.id, card);
  }
  return {
    getByPrinting(setCode, cn) {
      if (!setCode || !cn) return null;
      return byPrinting.get(`${setCode.toLowerCase()}:${cn}`) || null;
    },
    getByName(name) {
      return name ? (byNameLower.get(name.toLowerCase()) || null) : null;
    },
    getById(id) {
      return id ? (byScryfallId.get(id) || null) : null;
    },
  };
}

/* Persist Scryfall card objects keyed by their printing. Cards without
 * set + collector_number (shouldn't happen for real Scryfall data) are
 * skipped silently. Returns the count actually written. */
function cacheCards(cards, now = Date.now()) {
  if (!cards || cards.length === 0) return 0;
  const store = _readStore();
  let written = 0;
  for (const card of cards) {
    const k = _printingKey(card);
    if (!k) continue;
    store[k] = { card, fetchedAt: now };
    written++;
  }
  if (written > 0) _writeStore(store);
  return written;
}

/* Drop entries past the TTL. Returns the count evicted. */
function evictExpired(now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  const store = _readStore();
  let evicted = 0;
  for (const k of Object.keys(store)) {
    if (!_isFresh(store[k], now, ttlMs)) {
      delete store[k];
      evicted++;
    }
  }
  if (evicted > 0) _writeStore(store);
  return evicted;
}

/* Wipe the entire cache. */
function clearCache() {
  try {
    localStorage.removeItem(CARD_CACHE_KEY);
  } catch (e) {
    console.warn("Card cache: clear failed", e);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CARD_CACHE_KEY, DEFAULT_TTL_MS,
    lookupMany, getCachedCard, cardCacheReader,
    cacheCards, evictExpired, clearCache,
  };
}
