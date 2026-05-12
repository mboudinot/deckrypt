/* Drag-and-drop transition policy.
 *
 * Distinct from the game engine: `moveInstance` accepts any zone-to-zone
 * move (so the modal can offer arbitrary actions), but drag is a UX
 * affordance with a tighter policy — only the moves the user is likely
 * to want by direct manipulation.
 *
 * The graveyard is a fully bidirectional partner of both hand and
 * battlefield (sacrifice / mill / reanimate, and undo of any of those).
 * Commanders move freely between command and battlefield.
 */

const DRAG_TRANSITIONS = {
  hand: ["battlefield", "graveyard"],
  battlefield: ["hand", "command", "graveyard"],
  graveyard: ["hand", "battlefield"],
  command: ["battlefield"],
};

function canTransition(from, to) {
  if (!from || from === to) return false;
  return (DRAG_TRANSITIONS[from] || []).includes(to);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { DRAG_TRANSITIONS, canTransition };
}
