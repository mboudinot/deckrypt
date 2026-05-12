/* Game state and zone transitions for the playtest UI.
 * Pure-ish: each function takes a `game` object and mutates it.
 * No DOM, no Scryfall, no storage. */

const STARTING_HAND_SIZE = 7;
const ZONES = ["library", "hand", "battlefield", "graveyard", "command"];

let _instanceSeq = 0;
function _makeInstance(card) {
  return { instanceId: `i${++_instanceSeq}`, card, tapped: false };
}
function _resetInstanceSeq() { _instanceSeq = 0; } // for tests

/* Fisher-Yates. Returns a new array, doesn't mutate input. */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Build a fresh game from a resolved deck. Commanders start in the
 * dedicated `command` zone as instances, so they can be moved (cast,
 * returned) through the same primitives as any other card. */
function createGame(resolved, handSize = STARTING_HAND_SIZE) {
  const library = shuffle(resolved.deck).map(_makeInstance);
  const hand = library.splice(0, handSize);
  const command = (resolved.commanders || []).map(_makeInstance);
  return {
    library, hand,
    battlefield: [], graveyard: [],
    command,
    turn: 1,
    mulligans: 0,
  };
}

/* Locate which zone an instance lives in. null if not found. */
function findInstance(game, instanceId) {
  for (const zone of ZONES) {
    const idx = game[zone].findIndex((i) => i.instanceId === instanceId);
    if (idx !== -1) return { zone, index: idx, instance: game[zone][idx] };
  }
  return null;
}

/* Move an instance to a target zone. Returns true on success. */
function moveInstance(game, instanceId, toZone) {
  if (!ZONES.includes(toZone)) return false;
  const found = findInstance(game, instanceId);
  if (!found || found.zone === toZone) return false;
  game[found.zone].splice(found.index, 1);
  // Cards leaving the battlefield untap automatically (real MTG rule:
  // permanents lose all in-play state when they change zones).
  if (found.zone === "battlefield" && toZone !== "battlefield") {
    found.instance.tapped = false;
  }
  game[toZone].push(found.instance);
  return true;
}

/* Draw N cards from library to hand. Returns the number actually drawn. */
function drawCards(game, n = 1) {
  let drawn = 0;
  while (drawn < n && game.library.length > 0) {
    game.hand.push(game.library.shift());
    drawn++;
  }
  return drawn;
}

/* Move the first library card matching `name` to the hand. Used by the
 * "add a basic land" buttons — the rule "comes from the remaining
 * library" is what keeps the deck honest (mono-blue won't surface a
 * Plains because none exist in its library). Returns true on success. */
function fetchByName(game, name) {
  const idx = game.library.findIndex((inst) => inst.card.name === name);
  if (idx === -1) return false;
  const [inst] = game.library.splice(idx, 1);
  game.hand.push(inst);
  return true;
}

/* Number of library cards matching `name`. Drives both the disabled
 * state of the basic-land buttons (count === 0) and the remaining
 * count shown on each button. */
function libraryCount(game, name) {
  let n = 0;
  for (const inst of game.library) if (inst.card.name === name) n++;
  return n;
}

/* Toggle a battlefield card's tapped state. Returns true on success. */
function toggleTap(game, instanceId) {
  const found = findInstance(game, instanceId);
  if (!found || found.zone !== "battlefield") return false;
  found.instance.tapped = !found.instance.tapped;
  return true;
}

function untapAll(game) {
  for (const inst of game.battlefield) inst.tapped = false;
}

/* Advance to the next turn: untap all + draw 1. */
function nextTurn(game) {
  game.turn++;
  untapAll(game);
  return drawCards(game, 1);
}

/* Mulligan rules: turn 1, no plays yet, hand still big enough to shrink. */
function canMulligan(game) {
  return game.turn === 1
    && game.battlefield.length === 0
    && game.graveyard.length === 0
    && game.mulligans < STARTING_HAND_SIZE - 1;
}

/* Reshuffle and redraw N-1. Returns true on success. The command zone
 * is reset too: a fresh game means commanders return to their starting
 * spot with new instance IDs. */
function mulligan(game, resolved) {
  if (!canMulligan(game)) return false;
  game.mulligans++;
  const size = Math.max(1, STARTING_HAND_SIZE - game.mulligans);
  game.library = shuffle(resolved.deck).map(_makeInstance);
  game.hand = game.library.splice(0, size);
  game.battlefield = [];
  game.graveyard = [];
  game.command = (resolved.commanders || []).map(_makeInstance);
  return true;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STARTING_HAND_SIZE, ZONES,
    shuffle, createGame,
    findInstance, moveInstance, drawCards,
    fetchByName, libraryCount,
    toggleTap, untapAll, nextTurn,
    canMulligan, mulligan,
    _resetInstanceSeq,
  };
}
