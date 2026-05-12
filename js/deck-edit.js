/* Pure mutations on a decklist (the data shape stored in localStorage —
 * NOT the resolved Scryfall objects).
 *
 *   deckDef = { id, name, commanders: [entry], cards: [entry & {qty}] }
 *   entry   = { name, set?, collector_number? }
 *
 * Identity for merging is `(name, set, collector_number)`. Two entries
 * with the same name but different printings are kept separate — that
 * lets the user run "playset of Forest, art X" alongside another art.
 */

function _sameIdentity(a, b) {
  return a.name === b.name
    && (a.set || null) === (b.set || null)
    && (a.collector_number || null) === (b.collector_number || null);
}

function _findIndex(entries, target) {
  return entries.findIndex((e) => _sameIdentity(e, target));
}

/* Add `qty` copies of an entry to deckDef.cards. If an entry with the
 * same identity already exists, qty is folded in; otherwise a new entry
 * is appended. Defaults to qty 1. Returns the resulting qty for that
 * entry. */
function addCard(deckDef, entry) {
  const qty = entry.qty || 1;
  const idx = _findIndex(deckDef.cards, entry);
  if (idx !== -1) {
    deckDef.cards[idx].qty += qty;
    return deckDef.cards[idx].qty;
  }
  const next = { name: entry.name, qty };
  if (entry.set) next.set = entry.set;
  if (entry.collector_number) next.collector_number = entry.collector_number;
  deckDef.cards.push(next);
  return qty;
}

/* Remove `qty` copies. The entry is dropped entirely once qty reaches 0
 * (or below). Returns the new qty (0 = removed) or -1 if not found. */
function removeCard(deckDef, entry, qty = 1) {
  const idx = _findIndex(deckDef.cards, entry);
  if (idx === -1) return -1;
  deckDef.cards[idx].qty -= qty;
  if (deckDef.cards[idx].qty <= 0) {
    deckDef.cards.splice(idx, 1);
    return 0;
  }
  return deckDef.cards[idx].qty;
}

/* Set the qty of an existing entry to an absolute value. qty <= 0
 * removes the entry. Returns true if something changed. */
function setQty(deckDef, entry, qty) {
  const idx = _findIndex(deckDef.cards, entry);
  if (idx === -1) return false;
  if (qty <= 0) {
    deckDef.cards.splice(idx, 1);
    return true;
  }
  deckDef.cards[idx].qty = qty;
  return true;
}

/* Switch the printing (set + collector_number) of an entry. If another
 * entry already exists with the new identity, the qty is merged into
 * that target and the original entry is removed. Returns true on
 * success. */
function changePrinting(deckDef, entry, newSet, newCn) {
  const idx = _findIndex(deckDef.cards, entry);
  if (idx === -1) return false;
  const moved = {
    ...deckDef.cards[idx],
    set: newSet,
    collector_number: newCn,
  };
  // Same identity post-change? No-op (still update set/cn though, in
  // case one of the originals had only `set` without `collector_number`).
  if (_sameIdentity(deckDef.cards[idx], moved)) {
    deckDef.cards[idx] = moved;
    return true;
  }
  const target = deckDef.cards.findIndex(
    (e, i) => i !== idx && _sameIdentity(e, moved),
  );
  if (target !== -1) {
    deckDef.cards[target].qty += moved.qty;
    deckDef.cards.splice(idx, 1);
  } else {
    deckDef.cards[idx] = moved;
  }
  return true;
}

/* Add a commander. Commanders don't carry qty; same-identity duplicates
 * are silently rejected. Returns true if appended. */
function addCommander(deckDef, entry) {
  if (_findIndex(deckDef.commanders, entry) !== -1) return false;
  const next = { name: entry.name };
  if (entry.set) next.set = entry.set;
  if (entry.collector_number) next.collector_number = entry.collector_number;
  deckDef.commanders.push(next);
  return true;
}

function removeCommander(deckDef, entry) {
  const idx = _findIndex(deckDef.commanders, entry);
  if (idx === -1) return false;
  deckDef.commanders.splice(idx, 1);
  return true;
}

function changeCommanderPrinting(deckDef, entry, newSet, newCn) {
  const idx = _findIndex(deckDef.commanders, entry);
  if (idx === -1) return false;
  deckDef.commanders[idx] = {
    ...deckDef.commanders[idx],
    set: newSet,
    collector_number: newCn,
  };
  return true;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    addCard, removeCard, setQty, changePrinting,
    addCommander, removeCommander, changeCommanderPrinting,
  };
}
