/* Header concerns: deck-pill + its dropdown.
 *
 * Extracted from app.js (~150 lines) so the spine module stays
 * focused on state, deck resolution, view switching, and the
 * imports. The other view-specific files (app-play / app-manage /
 * app-analyze / app-gallery / app-login / app-settings) already
 * own their slice; this one rounds out the pattern for the header.
 *
 * Cross-module contracts:
 *  - Reads `state` and `els` (declared in app.js as classic-script
 *    top-level const — accessible across all classic scripts in
 *    document order). Both must be initialised by the time any
 *    function here runs (handled by load order + init sequencing).
 *  - Calls into storage.js (`loadUserDecks`) and app.js
 *    (`findDeck`, `setupDropdown`, `switchDeck` via the
 *    deck-select change handler).
 *  - The deck dropdown's lifecycle (open/close/toggle) is exposed
 *    via the `deckDropdown` global so app.js can `.close()` it
 *    after import / delete clicks.
 *
 * Load order: this file MUST appear BEFORE app.js in index.html so
 * its function declarations are evaluated when app.js's init() runs.
 */

/* Populated by setupHeaderDropdown() — read by populateDeckSelect's
 * "deck item click" handler so it can close the dropdown after a
 * pick. Exported (via window-global) so app.js can close it too
 * (from the import / delete handlers). */
let deckDropdown = null;

function cacheHeaderElements() {
  els.deckDropdownBtn = document.getElementById("btn-deck-pill");
  els.deckDropdownMenu = document.getElementById("deck-dropdown-menu");
  els.deckDropdownList = document.getElementById("deck-dropdown-list");
  els.deckDropdownCount = document.getElementById("deck-dropdown-count");
  els.deckPillName = document.getElementById("deck-pill-name");
  els.deckPillCount = document.getElementById("deck-pill-count");
  els.deckPillPips = document.getElementById("deck-pill-pips");
}

/* Single source of truth is the hidden #deck-select. The visible UI
 * is the header deck-pill + dropdown menu (#deck-dropdown). Both are
 * populated here. Other code reads/writes els.deckSelect.value as
 * before — no need to refactor every call site to know about the
 * pill. */
function populateDeckSelect() {
  els.deckSelect.replaceChildren();
  const decks = loadUserDecks();
  for (const d of decks) {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name;
    els.deckSelect.appendChild(opt);
  }
  if (!findDeck(state.currentDeckId)) {
    state.currentDeckId = decks[0]?.id || null;
  }
  if (state.currentDeckId) els.deckSelect.value = state.currentDeckId;
  renderDeckDropdown(decks);
  refreshDeckPill();
  updateDeleteButton();
}

/* Rebuild the deck-pill dropdown's deck list. Each item is a button
 * carrying the deck id; clicking it pipes through the hidden select
 * + the existing change handler (which fires switchDeck). */
function renderDeckDropdown(decks) {
  if (!els.deckDropdownList) return;
  els.deckDropdownList.replaceChildren();
  els.deckDropdownCount.textContent = `${decks.length} actif${decks.length > 1 ? "s" : ""}`;
  if (decks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dropdown-item";
    empty.style.color = "var(--text-muted)";
    empty.textContent = "Aucun deck — importe-en un.";
    els.deckDropdownList.appendChild(empty);
    return;
  }
  for (const d of decks) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dropdown-item";
    btn.dataset.deckId = d.id;
    btn.setAttribute("role", "menuitem");
    if (d.id === state.currentDeckId) btn.setAttribute("aria-current", "true");

    const col = document.createElement("div");
    col.className = "name-col";
    const nameRow = document.createElement("div");
    nameRow.className = "deck-name-row";
    nameRow.textContent = d.name;
    const metaRow = document.createElement("div");
    metaRow.className = "deck-meta-row";
    const fmt = d.format ? (d.format === "limited" ? "Limited" : "Commander") : "";
    const size = (d.commanders?.length || 0) + (d.cards || []).reduce((s, c) => s + (c.qty || 0), 0);
    metaRow.textContent = `${fmt}${fmt ? " · " : ""}${size} cartes`;
    col.appendChild(nameRow);
    col.appendChild(metaRow);
    btn.appendChild(col);

    btn.addEventListener("click", () => {
      if (els.deckSelect.value !== d.id) {
        els.deckSelect.value = d.id;
        els.deckSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (deckDropdown) deckDropdown.close();
    });
    els.deckDropdownList.appendChild(btn);
  }
}

/* Update the visible pill — name + cards count + color pips —
 * from the current deck. Called on populate, on switchDeck, and
 * after resolveDeck so the count + pips reflect the resolved data
 * once it's available. */
function refreshDeckPill() {
  if (!els.deckPillName) return;
  const def = findDeck(state.currentDeckId);
  if (!def) {
    els.deckPillName.textContent = "Aucun deck";
    els.deckPillCount.textContent = "0 cartes";
    els.deckPillPips.replaceChildren();
    return;
  }
  els.deckPillName.textContent = def.name;
  const size = (def.commanders?.length || 0)
    + (def.cards || []).reduce((s, c) => s + (c.qty || 0), 0);
  els.deckPillCount.textContent = `${size} carte${size > 1 ? "s" : ""}`;

  /* Color pips from the resolved commanders, when we have them. The
   * deck def itself only has names; the color identity comes from
   * Scryfall, so the pips appear after the resolve lands. */
  const colors = new Set();
  if (state.resolved && state.resolved.def.id === def.id) {
    for (const c of state.resolved.commanders) {
      if (Array.isArray(c.color_identity)) {
        for (const cid of c.color_identity) colors.add(cid);
      }
    }
  }
  els.deckPillPips.replaceChildren();
  for (const c of ["W", "U", "B", "R", "G"]) {
    if (!colors.has(c)) continue;
    const pip = document.createElement("span");
    pip.className = `pip-dot dot-${c.toLowerCase()}`;
    pip.setAttribute("aria-label", c);
    els.deckPillPips.appendChild(pip);
  }
}

/* Toggle the entire deck-summary kebab menu's trigger based on
 * whether a deck is loaded. With no deck, Dupliquer / Supprimer
 * are both no-ops (handlers bail) — hiding the whole menu keeps
 * the empty-state surface clean. The function name + the el ref
 * stay as "DeleteButton" for historical callsite continuity. */
function updateDeleteButton() {
  const kebab = document.getElementById("btn-deck-kebab");
  if (kebab) kebab.hidden = !findDeck(state.currentDeckId);
}

/* Move `aria-current="true"` to whichever dropdown item matches the
 * active deck. Cheap walk over already-built DOM — used after every
 * switchDeck so the highlight follows the user's selection without
 * rebuilding the whole menu (which would lose focus state). */
function refreshDeckDropdownActive() {
  if (!els.deckDropdownList) return;
  for (const btn of els.deckDropdownList.querySelectorAll(".dropdown-item")) {
    if (btn.dataset.deckId === state.currentDeckId) {
      btn.setAttribute("aria-current", "true");
    } else {
      btn.removeAttribute("aria-current");
    }
  }
}

/* Wire the header deck-pill dropdown via the shared setupDropdown
 * helper (defined in app.js). The "Importer" + "Supprimer" items
 * inside the menu still need explicit close calls because their
 * click handlers run after the dropdown's own click handler
 * captures the event. Returns the deckDropdown API for callers
 * that need programmatic access (currently none outside this
 * module — the API is stored in the module-level `deckDropdown`
 * variable for the deck-item click handler in renderDeckDropdown). */
function setupHeaderDropdown() {
  deckDropdown = setupDropdown({
    trigger: els.deckDropdownBtn,
    menu: els.deckDropdownMenu,
  });
  if (deckDropdown) {
    els.btnImportToggle.addEventListener("click", () => deckDropdown.close());
    els.btnDeleteDeck.addEventListener("click", () => deckDropdown.close());
  }
}
