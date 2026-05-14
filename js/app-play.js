/* Play view — commanders, battlefield, lands, hand, graveyard, game
 * bar, hand stats, basic-land buttons + game actions + drag-and-drop +
 * play-specific modal openers (commander/instance/graveyard).
 *
 * Reads `state` and `els` from app.js. Calls shared helpers from
 * app.js (`showModal`, `closeModal`, `setStatus`) and from the pure
 * modules (`game.js`, `scryfall.js`, `deck-suggestions.js`, etc.).
 * Load order: after all pure modules, after util/scryfall, before
 * the view files that depend on `placeholderText` / `makeCardEl`
 * (app-analyze.js, app-manage.js) and before app.js. */

// Five basic lands. The `name` matches Scryfall's English card name —
// `fetchByName` does an exact match, so a mono-blue deck (no Plains in
// its library) will keep the W button disabled. Order is WUBRG.
const BASIC_LANDS = [
  { color: "W", name: "Plains",   labelFr: "Plaine"   },
  { color: "U", name: "Island",   labelFr: "Île"      },
  { color: "B", name: "Swamp",    labelFr: "Marais"   },
  { color: "R", name: "Mountain", labelFr: "Montagne" },
  { color: "G", name: "Forest",   labelFr: "Forêt"    },
];

// ============================================================
// Rendering helpers (shared with manage + analyze views)
// ============================================================
function placeholderText(text) {
  const div = document.createElement("div");
  div.className = "placeholder-empty";
  div.textContent = text;
  return div;
}

/* Trash-can SVG built via DOM APIs rather than innerHTML — avoids the
 * pattern of "innerHTML with template literal" that's only safe when
 * the content is fully static, and trivially copy-pasted into unsafe
 * contexts later. */
const SVG_NS = "http://www.w3.org/2000/svg";
function makeTrashIcon(size = 14) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const polyline = document.createElementNS(SVG_NS, "polyline");
  polyline.setAttribute("points", "3 6 5 6 21 6");
  svg.appendChild(polyline);

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2");
  svg.appendChild(path);

  return svg;
}

/* Build a card DOM node. Generic — same builder for commanders and
 * game instances; the caller supplies tap state, aria text, and the
 * activation callback (clicking or pressing Enter/Space). */
function makeCardEl(card, { tapped = false, ariaLabel, onActivate, onContextMenu, instanceId, sourceZone }) {
  const el = document.createElement("div");
  el.className = "card" + (tapped ? " tapped" : "");
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  if (ariaLabel) el.setAttribute("aria-label", ariaLabel);
  if (instanceId && sourceZone) {
    el.draggable = true;
    el.dataset.instanceId = instanceId;
    el.addEventListener("dragstart", (e) => onCardDragStart(e, instanceId, sourceZone));
    el.addEventListener("dragend", onCardDragEnd);
  }
  if (onContextMenu) {
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      onContextMenu(e);
    });
  }

  const skel = document.createElement("div");
  skel.className = "skeleton";
  el.appendChild(skel);

  const label = document.createElement("div");
  label.className = "skeleton-label";
  label.textContent = card.name;
  el.appendChild(label);

  const src = cardImage(card, "small");
  if (src) {
    const img = document.createElement("img");
    img.alt = card.name;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("load", () => {
      skel.style.display = "none";
      label.style.display = "none";
    });
    img.addEventListener("error", () => {
      el.classList.add("error");
      label.textContent = card.name + " (image indisponible)";
    });
    img.src = src;
    el.appendChild(img);
  } else {
    el.classList.add("error");
    label.textContent = card.name + " (introuvable sur Scryfall)";
  }

  /* Game Changer pin: amber circle in the top-left corner whenever
   * Scryfall flags the card. Same data the Manage view's GC
   * accordion uses, surfaced visually on each card here. */
  if (card.game_changer === true) {
    const gc = document.createElement("span");
    gc.className = "gc-mark";
    gc.textContent = "GC";
    gc.title = "Game Changer";
    gc.setAttribute("aria-label", "Game Changer");
    el.appendChild(gc);
  }

  if (onActivate) {
    el.addEventListener("click", onActivate);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    });
  }
  return el;
}

// ============================================================
// Play-view rendering
// ============================================================

/* Three rendering paths:
 *   - no deck loaded                      → placeholder
 *   - deck resolved but game not yet built → static read-only cards
 *   - game running                         → instances drawn from
 *     game.command, draggable to the battlefield (see DRAG_TRANSITIONS)
 * The header counter shows "X sur Y" when some commanders have been
 * cast — useful for multi-commander partner decks. */
function renderCommanders() {
  els.commanderZone.replaceChildren();

  if (!state.resolved || state.resolved.commanders.length === 0) {
    els.commanderZone.appendChild(placeholderText("Aucun commandant."));
    els.commanderInfo.textContent = "0 carte";
    return;
  }

  if (!state.game) {
    for (const c of state.resolved.commanders) {
      els.commanderZone.appendChild(makeCardEl(c, {
        ariaLabel: `${c.name}, agrandir`,
        onActivate: () => openCommanderModal(c),
      }));
    }
    const n = state.resolved.commanders.length;
    els.commanderInfo.textContent = pluralFr(n, "carte");
    return;
  }

  const cmd = state.game.command;
  const total = state.resolved.commanders.length;

  if (cmd.length === 0) {
    els.commanderZone.appendChild(placeholderText(
      total === 1 ? "Commandant en jeu." : "Commandants en jeu.",
    ));
  } else {
    for (const inst of cmd) {
      els.commanderZone.appendChild(makeCardEl(inst.card, {
        ariaLabel: `${inst.card.name}, actions`,
        onActivate: () => openInstanceModal(inst),
        onContextMenu: (e) => openInstanceContextMenu(inst, e.clientX, e.clientY),
        instanceId: inst.instanceId,
        sourceZone: "command",
      }));
    }
  }

  els.commanderInfo.textContent = cmd.length === total
    ? pluralFr(total, "carte")
    : `${cmd.length} sur ${total}`;
}

function renderInstanceZone(elem, instances, emptyText, sourceZone) {
  elem.replaceChildren();
  if (!instances || instances.length === 0) {
    elem.appendChild(placeholderText(emptyText));
    return;
  }
  for (const inst of instances) {
    elem.appendChild(makeCardEl(inst.card, {
      tapped: inst.tapped,
      ariaLabel: `${inst.card.name}${inst.tapped ? " (engagé)" : ""}, actions`,
      onActivate: () => openInstanceModal(inst),
      onContextMenu: (e) => openInstanceContextMenu(inst, e.clientX, e.clientY),
      instanceId: inst.instanceId,
      sourceZone,
    }));
  }
}

/* The game's `battlefield` array holds every permanent (lands too — MTG
 * rule). The UI splits them into two visual blocks: lands on their own
 * row, other permanents above. Drag-and-drop targets both blocks at the
 * same underlying zone, so a card lands in the right block automatically
 * after the move. */
function renderBattlefield() {
  const all = state.game ? state.game.battlefield : [];
  const lands = all.filter((inst) => isLand(inst.card));
  const others = all.filter((inst) => !isLand(inst.card));

  renderInstanceZone(els.battlefield, others, "Aucun permanent sur le champ.", "battlefield");
  els.battlefieldInfo.textContent = others.length === 0
    ? "vide"
    : pluralFr(others.length, "permanent");

  renderInstanceZone(els.lands, lands, "Aucun terrain.", "battlefield");
  els.landsInfo.textContent = lands.length === 0
    ? "vide"
    : pluralFr(lands.length, "terrain");
}

function renderHand() {
  const list = state.game ? state.game.hand : [];
  renderInstanceZone(els.hand, list, "Aucune carte en main.", "hand");
  if (!state.game) {
    els.handInfo.textContent = "—";
    if (els.gameStateHand) els.gameStateHand.textContent = "—";
  } else {
    els.handInfo.textContent = pluralFr(state.game.hand.length, "carte");
    if (els.gameStateHand) els.gameStateHand.textContent = String(state.game.hand.length);
  }
}

/* The graveyard is a pile, not a strip: top card on top, up to two
 * backing cards behind it (rotated, dimmed) so the depth is implied
 * with real Scryfall art instead of placeholder rectangles. Click
 * the top card → graveyard modal with the full list and per-card
 * actions. The top card stays a drag source so flick-back-to-hand
 * still works without opening the modal. Backings are static (no
 * drag, no click). */
function renderGraveyard() {
  const list = state.game ? state.game.graveyard : [];
  els.graveyard.replaceChildren();
  /* Legacy depth classes are no longer used (the visual is now
   * driven by real card layers); clear them defensively in case
   * any external CSS still keys off them. */
  els.graveyard.classList.remove("has-stack", "has-deep-stack");
  if (list.length === 0) {
    /* Card-shaped phantom slot so the empty state reads as "drop a
     * card here" and the drag drop-target outlines a card-sized
     * area instead of a tiny rectangle. */
    const slot = document.createElement("div");
    slot.className = "graveyard-empty-slot";
    slot.textContent = "Cimetière vide";
    els.graveyard.appendChild(slot);
    els.graveyardInfo.textContent = "vide";
    return;
  }
  const stack = document.createElement("div");
  stack.className = "graveyard-stack";

  /* Backing layers — render bottom-up so DOM order matches z-index.
   * 3+ cards: gs-2 (3rd) then gs-1 (2nd) sit behind the top. */
  if (list.length >= 3) {
    const c3 = list[list.length - 3];
    const el3 = makeCardEl(c3.card, { tapped: c3.tapped });
    el3.classList.add("gs-2");
    el3.setAttribute("aria-hidden", "true");
    stack.appendChild(el3);
  }
  if (list.length >= 2) {
    const c2 = list[list.length - 2];
    const el2 = makeCardEl(c2.card, { tapped: c2.tapped });
    el2.classList.add("gs-1");
    el2.setAttribute("aria-hidden", "true");
    stack.appendChild(el2);
  }
  const top = list[list.length - 1];
  const ariaLabel = list.length === 1
    ? `${top.card.name}, ouvrir le cimetière`
    : `${top.card.name}, ${pluralFr(list.length, "carte")} en cimetière, ouvrir le cimetière`;
  const topEl = makeCardEl(top.card, {
    tapped: top.tapped,
    ariaLabel,
    onActivate: openGraveyardModal,
    onContextMenu: (e) => openInstanceContextMenu(top, e.clientX, e.clientY),
    instanceId: top.instanceId,
    sourceZone: "graveyard",
  });
  topEl.classList.add("gs-top");
  stack.appendChild(topEl);
  els.graveyard.appendChild(stack);
  els.graveyardInfo.textContent = pluralFr(list.length, "carte");
}

function renderGameBar() {
  /* Single pass: the same numbers feed the sidebar's "Partie en
   * cours" panel AND the top game-state bar, so the user sees the
   * same truth wherever they look. */
  if (!state.game) {
    els.turnCounter.textContent = "—";
    els.libraryCount.textContent = "—";
    if (els.graveyardCount) els.graveyardCount.textContent = "—";
    if (els.battlefieldCount) els.battlefieldCount.textContent = "—";
    if (els.gameStateTurn) els.gameStateTurn.textContent = "—";
    if (els.gameStateLibrary) els.gameStateLibrary.textContent = "—";
    if (els.btnNextTurnLabel) els.btnNextTurnLabel.textContent = "Tour suivant";
    return;
  }
  const turn = state.game.turn;
  const lib = state.game.library.length;
  const gy = state.game.graveyard.length;
  /* Champ de bataille = tout ce qui est en jeu (terrains inclus —
   * ils vivent dans battlefield, pas dans une zone séparée; la vue
   * les filtre à l'affichage pour les afficher dans leur propre
   * section). */
  const bf = state.game.battlefield.length;

  els.turnCounter.textContent = turn;
  els.libraryCount.textContent = lib;
  if (els.graveyardCount) els.graveyardCount.textContent = String(gy);
  if (els.battlefieldCount) els.battlefieldCount.textContent = String(bf);
  if (els.gameStateTurn) els.gameStateTurn.textContent = String(turn);
  if (els.gameStateLibrary) els.gameStateLibrary.textContent = String(lib);
  /* "Tour suivant" → "Tour N+1" so the user knows where the click
   * sends them. Reverts to the plain label when no game is loaded. */
  if (els.btnNextTurnLabel) els.btnNextTurnLabel.textContent = `Tour ${turn + 1}`;
}

function renderStats() {
  const hand = state.game ? state.game.hand : [];
  let lands = 0, spells = 0, cmcSum = 0;
  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const inst of hand) {
    const c = inst.card;
    if (isLand(c)) {
      lands++;
      for (const m of manaSourcesOf(c)) sources[m]++;
    } else {
      spells++;
      cmcSum += (typeof c.cmc === "number" ? c.cmc : 0);
    }
  }
  els.statLands.textContent = lands;
  if (els.statLandsSub) {
    els.statLandsSub.textContent = `${hand.length} carte${hand.length > 1 ? "s" : ""} en main`;
  }
  els.statSpells.textContent = spells;
  const avgCmc = spells === 0 ? "—" : (cmcSum / spells).toFixed(2);
  if (els.statSpellsSub) {
    els.statSpellsSub.textContent = `CMC moy. ${avgCmc}`;
  }

  const colors = state.resolved ? deckProducedColors(state.resolved) : COLOR_ORDER;
  els.statSources.replaceChildren();
  if (colors.length === 0) {
    const span = document.createElement("span");
    span.className = "deck-status";
    span.textContent = "aucune source colorée";
    els.statSources.appendChild(span);
    return;
  }
  for (const c of colors) {
    const pip = document.createElement("span");
    pip.className = `pip ${c}`;
    pip.title = COLOR_NAMES[c];
    const dot = document.createElement("span");
    dot.className = "dot";
    pip.appendChild(dot);
    pip.append(` ${c} `);
    const strong = document.createElement("strong");
    strong.textContent = String(sources[c]);
    pip.appendChild(strong);
    els.statSources.appendChild(pip);
  }
}

function renderAll() {
  renderCommanders();
  renderBattlefield();
  renderHand();
  renderGraveyard();
  renderGameBar();
  renderStats();
  updateButtons();
}

function updateButtons() {
  const hasDeck = !!state.resolved;
  const hasGame = !!state.game;
  els.btnNew.disabled = !hasDeck;
  els.btnDraw.disabled = !hasGame || state.game.library.length === 0;
  els.btnNextTurn.disabled = !hasGame;
  for (const btn of els.basicLandButtons) {
    const name = btn.dataset.landName;
    const labelFr = btn.dataset.landLabel;
    const count = hasGame ? libraryCount(state.game, name) : 0;
    btn.disabled = count === 0;
    btn.querySelector(".land-btn-label").textContent = `+ ${labelFr} (${count})`;
    btn.setAttribute("aria-label", count === 0
      ? `${labelFr} : aucun exemplaire dans la pioche`
      : `Ajouter ${labelFr} en main, ${count} dans la pioche`);
    btn.title = count === 0
      ? `Aucune ${labelFr} dans la pioche`
      : `Ajouter ${labelFr} (${pluralFr(count, "restant")} dans la pioche)`;
  }
}

/* Build the five colored "add a basic land" buttons once at init.
 * Their label, count, disabled state and aria-label are refreshed by
 * updateButtons after every render. */
function buildBasicLandButtons() {
  for (const land of BASIC_LANDS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `land-btn ${land.color}`;
    btn.dataset.landName = land.name;
    btn.dataset.landLabel = land.labelFr;

    const dot = document.createElement("span");
    dot.className = "dot";
    btn.appendChild(dot);

    const lbl = document.createElement("span");
    lbl.className = "land-btn-label";
    btn.appendChild(lbl);

    btn.addEventListener("click", () => addBasicLand(land.name));
    els.basicLands.appendChild(btn);
    els.basicLandButtons.push(btn);
  }
}

function addBasicLand(name) {
  if (!state.game) return;
  if (fetchByName(state.game, name)) renderAll();
}

// ============================================================
// Game actions
// ============================================================
function startNewGame() {
  if (!state.resolved) return;
  state.game = createGame(state.resolved);
  renderAll();
}

function drawOne() {
  if (!state.game) return;
  if (drawCards(state.game, 1) === 0) {
    setStatus("Bibliothèque vide.", "error");
    return;
  }
  renderAll();
}

function advanceTurn() {
  if (!state.game) return;
  nextTurn(state.game);
  renderAll();
}

function moveInstanceTo(instanceId, zone) {
  if (!state.game) return;
  if (moveInstance(state.game, instanceId, zone)) renderAll();
}

function tapInstance(instanceId) {
  if (!state.game) return;
  if (toggleTap(state.game, instanceId)) renderAll();
}

// ============================================================
// Drag and drop between zones
// ============================================================
function onCardDragStart(e, instanceId, sourceZone) {
  e.dataTransfer.setData("text/instance-id", instanceId);
  e.dataTransfer.effectAllowed = "move";
  state.dragSourceZone = sourceZone;
  e.currentTarget.classList.add("dragging");
}

function onCardDragEnd(e) {
  state.dragSourceZone = null;
  e.currentTarget.classList.remove("dragging");
  // Defensive cleanup: a drop outside any target leaves the highlight on.
  for (const { el } of els.dropZones) el.classList.remove("drop-target");
}

function canDropOn(toZone) {
  return canTransition(state.dragSourceZone, toZone);
}

function setupDropTargets() {
  for (const { el, zone } of els.dropZones) {
    el.addEventListener("dragover", (e) => {
      if (!canDropOn(zone)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.classList.add("drop-target");
    });
    el.addEventListener("dragleave", (e) => {
      // dragleave also fires when the cursor enters a child element.
      // Only clear the highlight when we've truly left the zone.
      if (!el.contains(e.relatedTarget)) el.classList.remove("drop-target");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drop-target");
      if (!canDropOn(zone)) return;
      const id = e.dataTransfer.getData("text/instance-id");
      if (id) moveInstanceTo(id, zone);
    });
  }
}

// ============================================================
// Play-specific modal openers (shared modal infra lives in app.js)
// ============================================================
function openCommanderModal(card) {
  showModal(card, []); // commanders are read-only
}

/* Build the action list for an instance based on its current zone.
 * Shared between the click-to-open modal and the right-click context
 * menu so both surfaces stay in sync. Returns [] if the instance is
 * no longer in the game (concurrent drag, stale ref). */
function getInstanceActions(instance) {
  if (!state.game) return [];
  const found = findInstance(state.game, instance.instanceId);
  if (!found) return [];
  const id = instance.instanceId;
  const actions = [];
  if (found.zone === "hand") {
    actions.push({ label: "Jouer", primary: true, fn: () => moveInstanceTo(id, "battlefield") });
    actions.push({ label: "Défausser", fn: () => moveInstanceTo(id, "graveyard") });
  } else if (found.zone === "battlefield") {
    actions.push({
      label: found.instance.tapped ? "Dégager" : "Engager",
      primary: true,
      fn: () => tapInstance(id),
    });
    actions.push({ label: "→ Cimetière", fn: () => moveInstanceTo(id, "graveyard") });
    actions.push({ label: "→ Main", fn: () => moveInstanceTo(id, "hand") });
  } else if (found.zone === "graveyard") {
    actions.push({ label: "→ Main", primary: true, fn: () => moveInstanceTo(id, "hand") });
    actions.push({ label: "→ Champ de bataille", fn: () => moveInstanceTo(id, "battlefield") });
  } else if (found.zone === "command") {
    actions.push({ label: "Jouer", primary: true, fn: () => moveInstanceTo(id, "battlefield") });
  }
  return actions;
}

function openInstanceModal(instance) {
  const actions = getInstanceActions(instance);
  if (actions.length === 0) return;
  showModal(instance.card, actions);
}

function openInstanceContextMenu(instance, x, y) {
  const actions = getInstanceActions(instance);
  if (actions.length === 0) return;
  openCardContextMenu(actions, x, y);
}

// ============================================================
// Right-click context menu for play-view cards
// ============================================================
/* Single live menu at a time. The previous one is torn down before
 * opening a new one so right-clicking different cards in succession
 * just "moves" the menu. Listeners are attached on the next tick to
 * avoid the synthetic mousedown that opened the menu also closing
 * it. Capture phase on the close handlers so the menu disappears
 * before any underlying click would fire on a sibling. */
let cardContextMenuEl = null;

function closeCardContextMenu() {
  if (!cardContextMenuEl) return;
  cardContextMenuEl.remove();
  cardContextMenuEl = null;
  document.removeEventListener("mousedown", onCardCtxOutside, true);
  document.removeEventListener("contextmenu", onCardCtxOutside, true);
  document.removeEventListener("keydown", onCardCtxKey, true);
  window.removeEventListener("scroll", closeCardContextMenu, true);
  window.removeEventListener("resize", closeCardContextMenu);
}

function onCardCtxOutside(e) {
  if (cardContextMenuEl && !cardContextMenuEl.contains(e.target)) closeCardContextMenu();
}

function onCardCtxKey(e) {
  if (e.key === "Escape") closeCardContextMenu();
}

function openCardContextMenu(actions, x, y) {
  closeCardContextMenu();
  const menu = document.createElement("div");
  menu.className = "dropdown-menu ctx-menu";
  menu.setAttribute("role", "menu");

  for (const a of actions) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "dropdown-item" + (a.primary ? " ctx-primary" : "");
    item.setAttribute("role", "menuitem");
    item.textContent = a.label;
    item.addEventListener("click", () => {
      a.fn();
      closeCardContextMenu();
    });
    menu.appendChild(item);
  }

  /* Append off-screen first so we can measure, then clamp to viewport. */
  menu.style.position = "fixed";
  menu.style.left = "-9999px";
  menu.style.top = "-9999px";
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(8, Math.min(x, vw - rect.width - 8));
  const top = Math.max(8, Math.min(y, vh - rect.height - 8));
  menu.style.left = left + "px";
  menu.style.top = top + "px";

  cardContextMenuEl = menu;
  setTimeout(() => {
    document.addEventListener("mousedown", onCardCtxOutside, true);
    document.addEventListener("contextmenu", onCardCtxOutside, true);
    document.addEventListener("keydown", onCardCtxKey, true);
    window.addEventListener("scroll", closeCardContextMenu, true);
    window.addEventListener("resize", closeCardContextMenu);
  }, 0);

  const first = menu.querySelector("button");
  if (first) first.focus();
}

/* Graveyard "open the pile" modal. Renders all graveyard cards as a
 * grid with two action buttons each (→ Main, → Champ de bataille).
 * Acting on a card re-renders the modal in place; once empty, closes. */
function openGraveyardModal() {
  if (!state.game || state.game.graveyard.length === 0) return;
  state.focusBeforeModal = document.activeElement;
  els.modalImg.removeAttribute("src");
  els.modalImg.alt = "";
  els.modal.classList.add("open");
  els.modal.focus();
  renderGraveyardModalContent();
}

function renderGraveyardModalContent() {
  if (!state.game) { closeModal(); return; }
  const cards = state.game.graveyard;
  els.modalActions.replaceChildren();
  if (cards.length === 0) { closeModal(); return; }

  const wrap = document.createElement("div");
  wrap.className = "graveyard-picker";

  const title = document.createElement("h3");
  title.className = "graveyard-picker-title";
  title.textContent = `Cimetière — ${pluralFr(cards.length, "carte")}`;
  wrap.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "graveyard-grid";
  // Top of the pile first — matches the visual order the user just clicked.
  for (let i = cards.length - 1; i >= 0; i--) {
    grid.appendChild(makeGraveyardTile(cards[i]));
  }
  wrap.appendChild(grid);

  els.modalActions.appendChild(wrap);
}

function makeGraveyardTile(inst) {
  const tile = document.createElement("div");
  tile.className = "graveyard-tile";

  const src = cardImage(inst.card, "normal");
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = inst.card.name;
    img.loading = "lazy";
    tile.appendChild(img);
  }

  const actions = document.createElement("div");
  actions.className = "graveyard-tile-actions";
  const toHand = document.createElement("button");
  toHand.type = "button";
  toHand.className = "btn btn-sm primary";
  toHand.textContent = "→ Main";
  toHand.addEventListener("click", () => moveFromGraveyard(inst.instanceId, "hand"));
  const toBattlefield = document.createElement("button");
  toBattlefield.type = "button";
  toBattlefield.className = "btn btn-sm";
  toBattlefield.textContent = "→ Champ";
  toBattlefield.addEventListener("click", () => moveFromGraveyard(inst.instanceId, "battlefield"));
  actions.append(toHand, toBattlefield);
  tile.appendChild(actions);

  return tile;
}

function moveFromGraveyard(instanceId, zone) {
  if (!state.game) return;
  if (!moveInstance(state.game, instanceId, zone)) return;
  renderAll();
  renderGraveyardModalContent();
}
