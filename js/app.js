/* App spine: state, deck resolution, switchDeck, view-tab switching,
 * skeletons, refresh-resolved state-sync, modal infra (showModal /
 * closeModal), import/export modal, bindEvents + init.
 *
 * Per-view rendering lives in:
 *   js/app-play.js     → commanders / battlefield / hand / graveyard
 *                        + drag-and-drop + game actions
 *   js/app-manage.js   → deck-editor, printing picker, add-card UI
 *   js/app-analyze.js  → bracket, composition, legality, archetypes,
 *                        suggestions, mana curve, tokens, etc.
 *
 * All four files share the same `state` and `els` globals; load order
 * (set in index.html) puts app-* before app.js, but function bodies
 * cross-reference at call time so the order is forgiving once init()
 * runs. Pure modules (util / scryfall / game / deck-* / storage /
 * card-cache / drag / translations / parser) are loaded earlier and
 * provide all the building blocks. */

// ============================================================
// State (single source of truth — never mutate from outside)
// ============================================================
const state = {
  // Set in init() once defaults are seeded; null means "no deck loaded".
  currentDeckId: null,
  /* In-memory snapshot of the active deck, shape:
   *   { def, commanders: [Card], deck: [Card], notFound: [string] }
   * `deck` is expanded by qty (a 4-of becomes 4 references to the same
   * card object). Invariant: if non-null, this mirrors `(def, card-cache)`
   * for the active deck. Maintained by refreshResolved(def), which is the
   * ONLY function allowed to update it after switchDeck/resolveDeck have
   * established the initial value. Never mutate fields in place — assign
   * a fresh object so identity-based change detection still works. */
  resolved: null,
  // Active game state (null until a deck loads). See game.js for shape.
  game: null,
  // Incremented on every switchDeck. Lets us discard stale Scryfall
  // resolutions when the user switches faster than the API responds.
  switchToken: 0,
  // Incremented on every refreshResolved call. Lets _refreshResolvedAsync
  // discard its in-flight fetch when a newer refresh starts (sync or async).
  refreshToken: 0,
  deckCache: new Map(),
  // Saved before opening the modal so we can restore focus on close.
  focusBeforeModal: null,
  // Source zone of the card currently being dragged. Cleared on dragend.
  // Set in dragstart and read in dragover (where dataTransfer.getData is
  // unavailable for security reasons), so we can validate transitions live.
  dragSourceZone: null,
  // Card-name display language for the manage view ("en" | "fr").
  // Persisted in localStorage. Translations themselves live in their
  // own cache (see js/translations.js).
  manageLang: "en",
  // Type-buckets the user collapsed in the manage view (string keys
  // like "Land", "Creature"). Survives re-renders within a session
  // so editing a card doesn't reopen a closed group. Not persisted
  // to localStorage — it's a working-set preference, not a setting.
  collapsedManageGroups: new Set(),
  // Set of card names that were just added in the manage view; rows
  // with a matching name get a brief highlight on render so the user
  // can spot what they just inserted. Populated by add/paste handlers,
  // cleared after the animation completes (see RECENTLY_ADDED_TTL_MS).
  recentlyAddedNames: new Set(),
};

const RECENTLY_ADDED_TTL_MS = 2500;


// ============================================================
// DOM elements (cached during init)
// ============================================================
const els = {};

/* Thin orchestrator — each `_cache*Elements()` helper owns the DOM
 * refs for one view (or for shared infrastructure: modal, nav,
 * global UI). Splitting this way keeps the file scannable and means
 * adding / removing an element in a view only touches that view's
 * helper. The dropZones array is built last because it depends on
 * play-zone refs being populated. */
function cacheElements() {
  _cacheGlobalElements();
  _cacheNavElements();
  _cachePlayElements();
  _cacheManageElements();
  _cacheAnalyzeElements();
  _cacheGalleryElements();
  _cacheModalElements();
  _cacheImportExportElements();
  /* Header deck-pill + dropdown lookups owned by app-header.js. */
  cacheHeaderElements();
  _buildDropZones();
}

function _cacheGlobalElements() {
  els.deckSelect = document.getElementById("deck-select");
  els.flashContainer = document.getElementById("flash-container");
  els.translationBanner = document.getElementById("translation-banner");
}

function _cacheNavElements() {
  els.tabPlay = document.getElementById("tab-play");
  els.tabManage = document.getElementById("tab-manage");
  els.tabAnalyze = document.getElementById("tab-analyze");
  els.tabGallery = document.getElementById("tab-gallery");
  els.viewPlay = document.getElementById("view-play");
  els.viewManage = document.getElementById("view-manage");
  els.viewAnalyze = document.getElementById("view-analyze");
  els.viewGallery = document.getElementById("view-gallery");
}

function _cachePlayElements() {
  els.btnDraw = document.getElementById("btn-draw");
  els.btnNextTurn = document.getElementById("btn-next-turn");
  els.btnNew = document.getElementById("btn-new");
  els.btnNextTurnLabel = document.getElementById("btn-next-turn-label");
  /* Sidebar counters. */
  els.turnCounter = document.getElementById("turn-counter");
  els.libraryCount = document.getElementById("library-count");
  els.graveyardCount = document.getElementById("graveyard-count");
  els.battlefieldCount = document.getElementById("battlefield-count");
  /* Game-state bar mirrors (top of #view-play) — same values as the
   * sidebar counters above; we update both in renderGameBar so the
   * user sees them wherever their eye lands. */
  els.gameStateTurn = document.getElementById("game-state-turn");
  els.gameStateLibrary = document.getElementById("game-state-library");
  els.gameStateHand = document.getElementById("game-state-hand");
  /* Zones. */
  els.commanderZone = document.getElementById("commander-zone");
  els.commanderInfo = document.getElementById("commander-info");
  els.battlefield = document.getElementById("battlefield");
  els.battlefieldInfo = document.getElementById("battlefield-info");
  els.lands = document.getElementById("lands");
  els.landsInfo = document.getElementById("lands-info");
  els.hand = document.getElementById("hand");
  els.handInfo = document.getElementById("hand-info");
  els.graveyard = document.getElementById("graveyard");
  els.graveyardInfo = document.getElementById("graveyard-info");
  els.basicLands = document.getElementById("basic-lands");
  /* Hand stats. */
  els.statLands = document.getElementById("stat-lands");
  els.statLandsSub = document.getElementById("stat-lands-sub");
  els.statSpells = document.getElementById("stat-spells");
  els.statSpellsSub = document.getElementById("stat-spells-sub");
  els.statSources = document.getElementById("stat-sources");
  /* NodeList of basic-land buttons, populated by buildBasicLandButtons.
   * Cached as an array so updateButtons doesn't re-query the DOM
   * every render. */
  els.basicLandButtons = [];
}

function _cacheManageElements() {
  /* Trash button lives in the deck-summary panel since the manage-view
   * refonte (was in the header deck-pill dropdown). Cached under the
   * same name so existing call sites (updateDeleteButton, click wiring)
   * keep working without renaming. */
  els.btnDeleteDeck = document.getElementById("btn-delete-deck-summary");
  els.btnDuplicateDeck = document.getElementById("btn-duplicate-deck");
  els.btnImportToggle = document.getElementById("btn-import-toggle");
  els.manageDeckName = document.getElementById("manage-deck-name");
  els.manageMeta = document.getElementById("manage-meta");
  els.manageCommanders = document.getElementById("manage-commanders");
  els.manageCards = document.getElementById("manage-cards");
  els.manageCardsCount = document.getElementById("manage-cards-count");
  els.addCardInput = document.getElementById("add-card-input");
  els.addCardSuggestions = document.getElementById("add-card-suggestions");
  els.addCardPasteText = document.getElementById("add-card-paste-text");
  els.addCardPasteBtn = document.getElementById("add-card-paste-btn");
  els.addCardDraft = document.getElementById("add-card-draft");
  els.addCardDraftName = document.getElementById("add-card-draft-name");
  els.addCardDraftPreview = document.getElementById("add-card-draft-preview");
  els.addCardDraftPrinting = document.getElementById("add-card-draft-printing");
  els.addCardDraftQty = document.getElementById("add-card-draft-qty");
  els.addCardDraftCancel = document.getElementById("add-card-draft-cancel");
  els.addCardDraftSubmit = document.getElementById("add-card-draft-submit");
  els.langSwitchEn = document.getElementById("lang-switch-en");
  els.langSwitchFr = document.getElementById("lang-switch-fr");
  /* Format edit lives in the deck-summary meta-row (click on the
   * format text → dropdown). Replaces the old <select> field. */
  els.formatTrigger = document.getElementById("manage-deck-format-trigger");
  els.formatMenu = document.getElementById("manage-deck-format-menu");
}

function _cacheAnalyzeElements() {
  els.analyzeBracket = document.getElementById("analyze-bracket");
  els.analyzeBracketLabel = document.getElementById("analyze-bracket-label");
  els.analyzeSuggestions = document.getElementById("analyze-suggestions");
  els.analyzeSuggestionsInfo = document.getElementById("analyze-suggestions-info");
  els.analyzeArchetypes = document.getElementById("analyze-archetypes");
  els.analyzeArchetypesInfo = document.getElementById("analyze-archetypes-info");
  els.analyzeThemes = document.getElementById("analyze-themes");
  els.analyzeThemesInfo = document.getElementById("analyze-themes-info");
  els.analyzeLegality = document.getElementById("analyze-legality");
  els.analyzeComposition = document.getElementById("analyze-composition");
  els.analyzeCurve = document.getElementById("analyze-curve");
  els.analyzeCurveInfo = document.getElementById("analyze-curve-info");
  els.analyzeTypes = document.getElementById("analyze-types");
  els.analyzeSources = document.getElementById("analyze-sources");
  els.analyzeSubtypes = document.getElementById("analyze-subtypes");
  els.analyzeSubtypesInfo = document.getElementById("analyze-subtypes-info");
  els.analyzeTokens = document.getElementById("analyze-tokens");
  els.analyzeTokensInfo = document.getElementById("analyze-tokens-info");
  els.analyzeManaBase = document.getElementById("analyze-mana-base");
  els.analyzeManaBaseInfo = document.getElementById("analyze-mana-base-info");
}

function _cacheGalleryElements() {
  els.galleryContent = document.getElementById("gallery-content");
}

function _cacheModalElements() {
  els.modal = document.getElementById("modal");
  els.modalImg = document.getElementById("modal-img");
  els.modalActions = document.getElementById("modal-actions");
}

function _cacheImportExportElements() {
  els.importName = document.getElementById("import-name");
  els.importText = document.getElementById("import-text");
  els.importPreview = document.getElementById("import-preview");
  els.importCancel = document.getElementById("import-cancel");
  els.importConfirm = document.getElementById("import-confirm");
  els.btnExport = document.getElementById("btn-export");
  els.ieModal = document.getElementById("ie-modal");
  els.ieModalClose = document.getElementById("ie-modal-close");
  els.ieModalTitle = document.getElementById("ie-modal-title");
  els.iePanelImport = document.getElementById("ie-panel-import");
  els.iePanelExport = document.getElementById("ie-panel-export");
  els.exportFormat = document.getElementById("export-format");
  els.exportDescription = document.getElementById("export-description");
  els.exportOutput = document.getElementById("export-output");
  els.exportCopy = document.getElementById("export-copy");
  els.exportDownload = document.getElementById("export-download");
  els.exportFeedback = document.getElementById("export-feedback");
}

/* Build once: which DOM zones receive drops, and which game zone
 * they resolve to. The lands block resolves to the same
 * `battlefield` game zone (renderBattlefield filters the array for
 * display). Must run after `_cachePlayElements` has populated the
 * zone refs. */
function _buildDropZones() {
  els.dropZones = [
    { el: els.hand, zone: "hand" },
    { el: els.battlefield, zone: "battlefield" },
    { el: els.lands, zone: "battlefield" },
    { el: els.graveyard, zone: "graveyard" },
    { el: els.commanderZone, zone: "command" },
  ];
}

// ============================================================
// Deck registry — single source: localStorage user decks.
// Defaults are seeded on first run (see init); after that, every deck
// is a normal user deck, fully editable.
// ============================================================
function allDecks() { return loadUserDecks(); }
function findDeck(id) { return allDecks().find((d) => d.id === id); }

// ============================================================
// Deck resolution (Scryfall + cache)
// ============================================================
function _identifiersOf(deckDef) {
  return [
    ...deckDef.commanders.map(makeIdentifier),
    ...deckDef.cards.map(makeIdentifier),
  ];
}

function _populateMaps(cards, byKey, byName) {
  /* byKey is per-printing, so distinct entries can never collide.
   * byName is per-name and CAN collide when the deck holds multiple
   * entries with the same name but different printings — e.g. a
   * default-printing Swamp + a user-picked Swamp from another set.
   * First-win is the right semantic: the first card we encounter
   * for a given name keeps the byName mapping, so a name-only entry
   * (no set/cn) resolves to its ORIGINAL printing rather than
   * borrowing the printing data from a more recent same-name entry.
   * Last-win would let a freshly-added "Swamp MOM #278" overwrite
   * the original "Swamp" mapping, making the original entry render
   * with the new art on next refresh. */
  for (const c of cards) {
    if (c.set && c.collector_number) byKey.set(cardKey(c), c);
    if (c.name && !byName.has(c.name.toLowerCase())) {
      byName.set(c.name.toLowerCase(), c);
    }
  }
}

/* Resolve a single entry, avoiding any (set, cn) already claimed by
 * an explicit entry elsewhere in the deck. Necessary because two
 * entries can share a name (e.g. Swamp default + Swamp MOM #278) and
 * the name-keyed map alone would have both entries resolve to the
 * same printing — see resolveEntry in scryfall.js for the simple
 * version this builds on. */
function _resolveEntryDistinct(entry, byKey, byName, usedPrintings) {
  if (entry.set && entry.collector_number) {
    const card = byKey.get(`set:${entry.set.toLowerCase()}:${entry.collector_number}`);
    if (card) return card;
  }
  const byNameCard = byName.get(entry.name.toLowerCase());
  if (!byNameCard) return null;
  const byNameKey = byNameCard.set && byNameCard.collector_number
    ? `${byNameCard.set.toLowerCase()}:${byNameCard.collector_number}`
    : null;
  if (!byNameKey || !usedPrintings.has(byNameKey)) return byNameCard;
  /* byName's pick is already claimed by an explicit-printing entry.
   * Scan byKey for an alternate same-name card whose printing isn't
   * taken — that's the printing the user implicitly meant for the
   * name-only entry. */
  const target = entry.name.toLowerCase();
  for (const card of byKey.values()) {
    if (card.name && card.name.toLowerCase() === target) {
      const key = `${card.set.toLowerCase()}:${card.collector_number}`;
      if (!usedPrintings.has(key)) return card;
    }
  }
  /* No untaken printing left — fall back to whatever byName had. The
   * two entries will visually duplicate, but better than rendering a
   * placeholder. */
  return byNameCard;
}

function _buildResolved(deckDef, byKey, byName, notFound) {
  /* Collect the (set, cn) tuples that explicit entries already claim
   * so name-only entries can route around them. We include both
   * commanders and main-deck cards — a commander with an explicit
   * printing shouldn't have a deck entry steal its art. */
  const usedPrintings = new Set();
  for (const e of [...deckDef.commanders, ...deckDef.cards]) {
    if (e.set && e.collector_number) {
      usedPrintings.add(`${e.set.toLowerCase()}:${e.collector_number}`);
    }
  }
  const commanders = deckDef.commanders.map((c) =>
    _resolveEntryDistinct(c, byKey, byName, usedPrintings) || makePlaceholder(c.name));
  const deck = [];
  for (const entry of deckDef.cards) {
    const card = _resolveEntryDistinct(entry, byKey, byName, usedPrintings)
      || makePlaceholder(entry.name);
    for (let i = 0; i < entry.qty; i++) deck.push(card);
  }
  return { def: deckDef, commanders, deck, notFound };
}

/* Synchronous resolution from the persistent card-cache. Returns null
 * if anything's missing — caller falls back to the async network path.
 * On a warm cache (typical F5 after the first load) this lets us skip
 * the "Chargement…" flash and render the deck instantly. */
function tryResolveSync(deckDef) {
  if (state.deckCache.has(deckDef.id)) return state.deckCache.get(deckDef.id);
  const ids = _identifiersOf(deckDef);
  const { found, missing } = lookupMany(ids);
  if (missing.length > 0) return null;
  const byKey = new Map();
  const byName = new Map();
  _populateMaps(found, byKey, byName);
  const resolved = _buildResolved(deckDef, byKey, byName, []);
  state.deckCache.set(deckDef.id, resolved);
  return resolved;
}

async function resolveDeck(deckDef) {
  const sync = tryResolveSync(deckDef);
  if (sync) return sync;

  // Cold path — at least one card not in the cache. Look up what we
  // have, then fetch the rest from Scryfall in one pass.
  const ids = _identifiersOf(deckDef);
  const { found, missing } = lookupMany(ids);
  const byKey = new Map();
  const byName = new Map();
  _populateMaps(found, byKey, byName);

  const fetched = await fetchScryfallCards(missing);
  for (const [k, v] of fetched.byKey) byKey.set(k, v);
  for (const [k, v] of fetched.byName) byName.set(k, v);
  cacheCards([...fetched.byKey.values()]);

  const resolved = _buildResolved(deckDef, byKey, byName, fetched.notFound);
  state.deckCache.set(deckDef.id, resolved);
  return resolved;
}

function showModal(card, actions) {
  state.focusBeforeModal = document.activeElement;

  const src = cardImage(card, "normal");
  if (src) {
    els.modalImg.src = src;
    els.modalImg.alt = card.name;
  } else {
    els.modalImg.removeAttribute("src");
    els.modalImg.alt = "";
  }

  els.modalActions.replaceChildren();
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    /* Same class set as the game-state bar's #btn-draw / #btn-new /
     * #btn-next-turn so the hover/active states are literally
     * identical — one source of truth for action buttons in the
     * play view. */
    btn.className = "btn btn-sm" + (action.primary ? " primary" : "");
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.fn();
      closeModal();
    });
    els.modalActions.appendChild(btn);
  }

  els.modal.classList.add("open");
  els.modal.focus();
}

function closeModal() {
  els.modal.classList.remove("open");
  // removeAttribute is the safe way to clear an <img> — empty string
  // would trigger a request for the page URL in some browsers.
  els.modalImg.removeAttribute("src");
  els.modalImg.alt = "";
  els.modalActions.replaceChildren();
  if (state.focusBeforeModal && document.contains(state.focusBeforeModal)) {
    state.focusBeforeModal.focus();
  }
  state.focusBeforeModal = null;
}

// ============================================================
// Deck selector + loading — populateDeckSelect / renderDeckDropdown
// / refreshDeckPill / updateDeleteButton live in js/app-header.js
// alongside the rest of the deck-pill machinery.
// ============================================================

/* Wire a trigger + menu pair as a dropdown:
 *   - clicking the trigger toggles the menu (skippable with
 *     autoToggle:false for triggers that need conditional logic —
 *     e.g., the account button opens the login overlay when anon
 *     instead of toggling its dropdown)
 *   - outside-click closes
 *   - Escape closes
 *   - aria-expanded stays in sync
 *
 * Returns { open, close, toggle, isOpen } for programmatic control.
 * When multiple dropdowns coexist, each one's outside-click listener
 * closes IT when a click lands outside ITS trigger/menu — clicking
 * one trigger while another is open implicitly closes the other,
 * no cross-dropdown coordination needed. Returns null if either
 * element is missing (defensive against legacy markup). */
function setupDropdown({ trigger, menu, autoToggle = true }) {
  if (!trigger || !menu) return null;
  const api = {
    isOpen: () => !menu.hidden,
    open: () => {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    },
    close: () => {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    },
    toggle: () => (api.isOpen() ? api.close() : api.open()),
  };
  if (autoToggle) {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      api.toggle();
    });
  }
  document.addEventListener("mousedown", (e) => {
    if (!api.isOpen()) return;
    if (trigger.contains(e.target)) return;
    if (menu.contains(e.target)) return;
    api.close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && api.isOpen()) api.close();
  });
  return api;
}

/* The persistent #deck-status banner was removed from the layout
 * (it surfaced low-value "1 introuvable: plain" type warnings that
 * cluttered every page). Kept as a console-only sink so call sites
 * don't NPE and so the messages are still grep-able when debugging.
 * For user-visible errors that DO matter, use flash() below — it's
 * already wired everywhere it should be. */
function setStatus(msg, kind = "") {
  if (!msg) return;
  if (kind === "error") console.warn("[deckrypt]", msg);
  else console.log("[deckrypt]", msg);
}

/* Transient toast notification. `kind` controls accent color + auto-
 * dismiss timing. Multiple flashes stack vertically (most recent at
 * the bottom). The container is aria-live="polite" so screen readers
 * announce each message without interrupting.
 *
 * Use this for ephemeral action feedback ("added X", "saved Y") —
 * NOT for persistent state (use setStatus or a dedicated UI for
 * that). Empty messages are no-ops. */
function flash(message, kind = "info") {
  if (!message || !els.flashContainer) return;
  const validKinds = new Set(["success", "info", "warning", "error"]);
  const k = validKinds.has(kind) ? kind : "info";
  const node = document.createElement("div");
  node.className = `flash flash-${k}`;
  node.setAttribute("role", k === "error" ? "alert" : "status");
  const text = document.createElement("span");
  text.className = "flash-text";
  text.textContent = message;
  node.appendChild(text);
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "flash-dismiss";
  dismiss.setAttribute("aria-label", "Fermer la notification");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => removeFlash(node));
  node.appendChild(dismiss);
  els.flashContainer.appendChild(node);
  // Errors linger longer (5s vs 3s) — they're more likely to need
  // reading and the user may want a moment to react.
  const ttl = k === "error" ? 5000 : 3000;
  const timer = setTimeout(() => removeFlash(node), ttl);
  /* Pausing the dismissal when the user hovers a flash mirrors what
   * most toast systems do — keeps a slow reader from missing the
   * message. Click on the dismiss button also clears the timer via
   * removeFlash's idempotency. */
  node.addEventListener("mouseenter", () => clearTimeout(timer));
}

function removeFlash(node) {
  if (!node || !node.parentNode || node.classList.contains("flash-leaving")) return;
  node.classList.add("flash-leaving");
  // Match the fade-out duration in CSS; if prefers-reduced-motion is
  // on the animation is no-op and we still remove after the same
  // tick budget.
  setTimeout(() => { if (node.parentNode) node.remove(); }, 220);
}

/* Reset the play view to an empty state — used when the user deletes
 * their last deck, or right after sign-in for a brand-new account
 * with no cloud decks yet. The commander zone gets a CTA that
 * triggers the import modal; the other zones keep a quiet
 * placeholder so the page doesn't feel screaming-empty. */
function clearActiveView() {
  state.resolved = null;
  state.game = null;
  els.commanderZone.replaceChildren(emptyDeckCta());
  for (const el of [els.hand, els.battlefield, els.lands, els.graveyard]) {
    el.replaceChildren(placeholderText("Aucun deck chargé."));
  }
  setStatus("Aucun deck. Importez-en un pour commencer.");
  renderGameBar();
  updateButtons();
}

/* Built once per call so the click handler captures the latest
 * openImportPanel. Used both by clearActiveView and the dropdown
 * helpers — the message stays the same, the visual treatment is
 * driven entirely by .empty-deck-cta in views.css. */
function emptyDeckCta() {
  const wrap = document.createElement("div");
  wrap.className = "empty-deck-cta";
  const title = document.createElement("div");
  title.className = "empty-deck-cta-title";
  title.textContent = "Aucun deck pour le moment";
  const sub = document.createElement("div");
  sub.className = "empty-deck-cta-sub";
  sub.textContent = "Importe ta première deck-liste pour commencer.";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn primary empty-deck-cta-btn";
  btn.textContent = "Importer ton premier deck";
  btn.addEventListener("click", () => openImportPanel());
  wrap.appendChild(title);
  wrap.appendChild(sub);
  wrap.appendChild(btn);
  return wrap;
}

async function switchDeck(deckId) {
  const myToken = ++state.switchToken;
  state.currentDeckId = deckId;
  updateDeleteButton();
  /* Keep the deck-pill dropdown's highlight (aria-current) in sync
   * with the active deck — otherwise the row that was current when
   * the menu was last built stays highlighted even after the user
   * switches to a different deck. */
  refreshDeckDropdownActive();
  const def = findDeck(deckId);
  if (!def) return;

  state.resolved = null;
  state.game = null;

  // Warm-cache fast path: tryResolveSync hits localStorage only, no
  // network. This is the common case on F5 after the first load and
  // it skips the "Chargement…" flash entirely.
  const sync = tryResolveSync(def);
  if (sync) {
    state.resolved = sync;
    renderCommanders();
    startNewGame();
    rerenderDeckViews();
    return;
  }

  // Cold path — show placeholders, then fetch.
  els.commanderZone.replaceChildren(placeholderText("Chargement des données Scryfall…"));
  els.hand.replaceChildren(placeholderText("Chargement…"));
  els.battlefield.replaceChildren(placeholderText("Chargement…"));
  els.lands.replaceChildren(placeholderText("Chargement…"));
  els.graveyard.replaceChildren(placeholderText("Chargement…"));
  setStatus("Chargement…");
  renderGameBar();
  updateButtons();
  // Pre-render the hidden views with skeletons so a tab switch mid-load
  // shows something rather than empty containers.
  showManageSkeleton();
  showAnalyzeSkeleton();

  try {
    const r = await resolveDeck(def);
    if (myToken !== state.switchToken) return; // stale: user already switched
    state.resolved = r;
    renderCommanders();
    startNewGame();
    rerenderDeckViews();
  } catch (err) {
    if (myToken !== state.switchToken) return;
    console.error(err);
    setStatus(`Erreur Scryfall : ${err.message}`, "error");
    els.commanderZone.replaceChildren(placeholderText("Échec du chargement."));
    els.battlefield.replaceChildren();
    els.lands.replaceChildren();
    els.hand.replaceChildren();
    els.graveyard.replaceChildren();
  }
}

async function deleteCurrentDeck() {
  const def = findDeck(state.currentDeckId);
  if (!def) return;
  const ok = await window.confirmDialog({
    title: "Supprimer le deck",
    message: `« ${def.name} » sera retiré de ton compte. Cette action est définitive.`,
    confirmLabel: "Supprimer",
    danger: true,
  });
  if (!ok) return;
  const result = window.sync.commitDeleteDeck(def.id);
  if (!result.ok) {
    setStatus("Échec de la suppression (localStorage indisponible).", "error");
    return;
  }
  const remaining = loadUserDecks();
  state.deckCache.delete(def.id);
  state.currentDeckId = remaining[0]?.id || null;
  populateDeckSelect();
  if (state.currentDeckId) switchDeck(state.currentDeckId);
  else clearActiveView();
}

/* Clone the active deck under a new id with " (copie)" appended to
 * the name. Commanders + cards are deep-copied so editing the clone
 * doesn't mutate the original; the new id is a timestamp suffix
 * (sufficient — id collisions would require sub-millisecond clicks
 * on the same machine, and findDeck would just return the first
 * match in that improbable case). */
function duplicateCurrentDeck() {
  const def = findDeck(state.currentDeckId);
  if (!def) return;
  const clone = {
    id: `${def.id}-copy-${Date.now()}`,
    name: `${def.name} (copie)`,
    format: def.format,
    commanders: def.commanders.map((c) => ({ ...c })),
    cards: def.cards.map((c) => ({ ...c })),
  };
  if (def.description) clone.description = def.description;
  const result = window.sync.commitDeck(clone);
  if (!result.ok) {
    setStatus("Échec de la duplication (localStorage indisponible).", "error");
    return;
  }
  populateDeckSelect();
  /* switchDeck calls refreshDeckDropdownActive which moves
   * `aria-current` to the clone's row — no need to pre-set
   * state.currentDeckId here. */
  switchDeck(clone.id);
  flash(`Deck "${clone.name}" créé`, "success");
}

// ============================================================
// Import UI
// ============================================================
function openImportPanel() {
  els.importName.value = "";
  els.importText.value = "";
  els.importPreview.replaceChildren();
  els.importPreview.textContent = "Colle une liste pour voir le récap.";
  /* Button stays enabled — validation is the gatekeeper, not a
   * disabled state. The user gets immediate inline feedback on
   * click instead of wondering why the button is gray. */
  els.importConfirm.disabled = false;
  /* Clear any leftover invalid flags from a prior failed attempt
   * and wire the auto-clear listeners (idempotent — first call
   * registers, later calls are no-ops via dataset guard). */
  window.formValidate.clearInvalid(els.importName);
  window.formValidate.clearInvalid(els.importText);
  window.formValidate.attachAutoClear(els.importName);
  window.formValidate.attachAutoClear(els.importText);
  openIeModal("import");
  els.importName.focus();
}
function closeImportPanel() { closeIeModal(); }

/* Import / Export modal — separate from the card-preview modal
 * because it owns editable content (textarea). Closed only by the
 * X button or Escape — backdrop clicks are intentionally ignored
 * so an accidental click outside doesn't wipe a pasted decklist.
 *
 * Single-panel modal: each entry point (deck-pill "Importer une
 * liste" / manage kebab "Exporter") picks which panel to show. The
 * dual-tab UI was dropped because the inactive tab was always noise
 * — the user is committed to one operation per modal open. The
 * title doubles as the context indicator. */
function openIeModal(mode = "import") {
  state.focusBeforeModal = document.activeElement;
  const isImport = mode === "import";
  els.ieModalTitle.textContent = isImport ? "Importer une liste" : "Exporter le deck";
  els.iePanelImport.hidden = !isImport;
  els.iePanelExport.hidden = isImport;
  if (!isImport) setupExportPanel();
  els.ieModal.hidden = false;
  els.ieModal.classList.add("open");
  els.ieModal.focus();
}

function closeIeModal() {
  els.ieModal.classList.remove("open");
  els.ieModal.hidden = true;
  if (state.focusBeforeModal && document.contains(state.focusBeforeModal)) {
    state.focusBeforeModal.focus();
  }
  state.focusBeforeModal = null;
}

/* (Re)populate the format select on first open, then render the
 * output for the currently-selected format. */
function setupExportPanel() {
  if (els.exportFormat.options.length === 0) {
    for (const fmt of EXPORT_FORMATS) {
      const opt = document.createElement("option");
      opt.value = fmt.key;
      opt.textContent = fmt.label;
      els.exportFormat.appendChild(opt);
    }
    els.exportFormat.value = "moxfield"; // sensible default
  }
  els.exportFeedback.textContent = "";
  refreshExportOutput();
}

function refreshExportOutput() {
  const def = findDeck(state.currentDeckId);
  if (!def) {
    els.exportOutput.value = "";
    els.exportDescription.textContent = "Aucun deck sélectionné.";
    return;
  }
  const fmtKey = els.exportFormat.value;
  const fmt = EXPORT_FORMATS.find((f) => f.key === fmtKey);
  els.exportDescription.textContent = fmt ? fmt.description : "";
  try {
    els.exportOutput.value = exportDeck(def, fmtKey);
  } catch (err) {
    els.exportOutput.value = "";
    els.exportDescription.textContent = `Erreur : ${err.message}`;
  }
}

async function onExportCopy() {
  if (!els.exportOutput.value) return;
  els.exportFeedback.textContent = "";
  try {
    await navigator.clipboard.writeText(els.exportOutput.value);
    els.exportFeedback.textContent = "Copié dans le presse-papier";
  } catch (err) {
    // Fallback: select the textarea content so the user can Ctrl+C.
    els.exportOutput.select();
    els.exportFeedback.textContent = "Sélectionné — Ctrl+C pour copier";
  }
  setTimeout(() => { els.exportFeedback.textContent = ""; }, 2500);
}

function onExportDownload() {
  const def = findDeck(state.currentDeckId);
  if (!def || !els.exportOutput.value) return;
  const fmtKey = els.exportFormat.value;
  const fmt = EXPORT_FORMATS.find((f) => f.key === fmtKey);
  const ext = fmt ? fmt.extension : "txt";
  // Slug the deck name to a file-safe filename.
  const slug = (def.name || "deck")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip Unicode combining accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "deck";
  const blob = new Blob([els.exportOutput.value], {
    type: ext === "json" ? "application/json" : "text/plain",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function refreshImportPreview() {
  const text = els.importText.value;
  els.importPreview.replaceChildren();

  if (!text.trim()) {
    els.importPreview.textContent = "Colle une liste pour voir le récap.";
    return;
  }
  const parsed = parseDecklist(text);
  const total = parsed.counts.commanders + parsed.counts.main;

  const summary = document.createElement("span");
  summary.className = "ok";
  let s = `${pluralFr(parsed.counts.commanders, "commandant")}, ${parsed.counts.main} cartes principales`;
  if (parsed.counts.sideboard) s += `, ${parsed.counts.sideboard} en sideboard (ignorées)`;
  s += `. Total deck : ${total}.`;
  summary.textContent = s;
  els.importPreview.appendChild(summary);

  for (const e of parsed.errors) {
    const errEl = document.createElement("span");
    errEl.className = "err";
    errEl.textContent = "⚠ " + e;
    els.importPreview.appendChild(errEl);
  }
}

async function confirmImport() {
  const name = els.importName.value.trim();
  const text = els.importText.value;
  const missingName = !name;
  const missingText = !text.trim();
  if (missingName || missingText) {
    if (missingName) window.formValidate.flagInvalid(els.importName);
    if (missingText) window.formValidate.flagInvalid(els.importText);
    let msg;
    if (missingName && missingText) msg = "Renseigne un nom de deck et colle ta liste.";
    else if (missingName) msg = "Renseigne un nom pour ce deck.";
    else msg = "Colle ta liste de cartes.";
    setStatus(msg, "error");
    (missingName ? els.importName : els.importText).focus();
    return;
  }
  const parsed = parseDecklist(text);
  if (parsed.cards.length === 0 && parsed.commanders.length === 0) {
    window.formValidate.flagInvalid(els.importText);
    setStatus("Aucune carte détectée dans la liste.", "error");
    els.importText.focus();
    return;
  }
  const id = "user-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const def = {
    id, name,
    format: "commander", // sensible default — user can change in Manage
    commanders: parsed.commanders,
    cards: parsed.cards,
  };

  els.importConfirm.disabled = true;
  setStatus("Vérification du deck via Scryfall…");
  try {
    await resolveDeck(def);
  } catch (err) {
    setStatus("Erreur Scryfall : " + err.message, "error");
    els.importConfirm.disabled = false;
    return;
  }

  if (!window.sync.commitDeck(def).ok) {
    setStatus("⚠ Sauvegarde impossible (localStorage plein ou indisponible). Le deck est chargé pour cette session uniquement.", "error");
  }

  closeImportPanel();
  populateDeckSelect();
  els.deckSelect.value = id;
  state.currentDeckId = id;
  switchDeck(id);
}

// ============================================================
// View toggle (Jouer / Gérer)
// ============================================================
/* Tab switching is now a pure visibility toggle — content is
 * pre-rendered by switchDeck (and on every commitDeckChange) so the
 * panels are always populated when the user clicks the tab. The
 * only async hook here is the FR translation fetch on first entry
 * to the manage view (cheap if cached, banner if not). */
function switchView(view) {
  const tabs = [
    { name: "play", tab: els.tabPlay, panel: els.viewPlay },
    { name: "manage", tab: els.tabManage, panel: els.viewManage },
    { name: "analyze", tab: els.tabAnalyze, panel: els.viewAnalyze },
    { name: "gallery", tab: els.tabGallery, panel: els.viewGallery },
  ];
  let activeTab = null;
  for (const t of tabs) {
    const active = t.name === view;
    t.panel.hidden = !active;
    t.tab.classList.toggle("active", active);
    t.tab.setAttribute("aria-selected", String(active));
    if (active) activeTab = t.tab;
  }
  /* The gallery is a full-width template — sidebar disappears and the
   * layout's two-column grid collapses to one. Toggling a body class
   * keeps the CSS aware without forcing every view to know about it. */
  document.body.classList.toggle("gallery-active", view === "gallery");
  if (view === "manage" && state.manageLang === "fr") {
    ensureFrenchTranslationsForCurrentDeck();
  }
}

// ============================================================
// State sync + skeletons (called from switchDeck / commit handlers)
// ============================================================

/* Pre-render Manage and Analyze on every deck-state change so a
 * subsequent tab switch is a pure visibility toggle (instant). The
 * cost is one extra render of each per resolve / commit, which is
 * cheap (~50 ms total) and pays for itself the first time the user
 * clicks a tab. The FR translation fetch fires only when the user
 * actually opens the manage view (not pre-emptively, to save API). */
function rerenderDeckViews() {
  if (!state.resolved) return;
  /* Share one cardCacheReader + one findDeck result across all view
   * renders. Both used to be re-fetched per-renderer, causing 3-4
   * `localStorage.getItem` + `JSON.parse` calls on the same data per
   * cycle — measurable in the F5 critical path once the cache grew
   * past a few hundred entries. The shared `ctx` is also the natural
   * hook for any future per-cycle memoization. */
  const def = findDeck(state.resolved.def.id);
  const ctx = {
    def,
    cacheReader: cardCacheReader(),
  };
  renderManageView(ctx);
  renderAnalyzeView();
  renderGalleryView(ctx);
  /* The header deck-pill shows the size + color pips of the active
   * deck. Pips depend on the resolved commanders, so we refresh
   * here whenever the resolved view is up to date. */
  refreshDeckPill();
  if (state.manageLang === "fr" && !els.viewManage.hidden) {
    ensureFrenchTranslationsForCurrentDeck();
  }
}

/* Skeleton helpers: cheap visual placeholders shown while the deck
 * resolves on a cold cache. Avoids the "empty container" flash if
 * the user lands directly on the Manage / Analyze tab. */
function showManageSkeleton() {
  els.manageCommanders.replaceChildren(makeSkeletonRows(2));
  els.manageCards.replaceChildren(makeSkeletonRows(8));
  els.manageMeta.textContent = "";
  els.manageCardsCount.textContent = "";
}

function showAnalyzeSkeleton() {
  for (const el of [
    els.analyzeBracket, els.analyzeLegality, els.analyzeArchetypes,
    els.analyzeSuggestions, els.analyzeThemes, els.analyzeCurve,
    els.analyzeTypes, els.analyzeSources, els.analyzeManaBase,
    els.analyzeSubtypes, els.analyzeTokens,
  ]) {
    el.replaceChildren(makeSkeletonBlock());
  }
}

function makeSkeletonRows(count) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "skeleton-row";
    frag.appendChild(row);
  }
  return frag;
}

function makeSkeletonBlock() {
  const block = document.createElement("div");
  block.className = "skeleton-block";
  return block;
}

function commitDeckChange(def) {
  if (!window.sync.commitDeck(def).ok) {
    setStatus("Sauvegarde impossible (localStorage indisponible).", "error");
    return false;
  }
  state.deckCache.delete(def.id);
  refreshResolved(def);
  return true;
}

/* The single point where state.resolved is brought back in sync with
 * a freshly-committed def. Everything that mutates the deck on disk
 * goes through commitDeckChange, so this is the only place we need
 * the sync logic — no scattered "patch state.resolved.def = def" or
 * similar band-aids. No-op when state.resolved tracks a different
 * deck or hasn't been initialised yet.
 *
 * Two paths:
 *   - Sync (printing change, qty edit, format flip, removal): all
 *     identifiers are already in the per-printing card-cache, so
 *     tryResolveSync returns a fresh resolved immediately.
 *   - Async (addByName / paste-add of a never-fetched card name):
 *     tryResolveSync returns null because the new identifier isn't
 *     cached. We fire `_refreshResolvedAsync` to fetch from Scryfall
 *     and re-render when the response lands.
 *
 * Both paths bump refreshToken so any in-flight async fetch from a
 * prior call is discarded when its response arrives — guarantees the
 * final state.resolved reflects the last commit, not a stale fetch. */
function refreshResolved(def) {
  if (!state.resolved || state.resolved.def.id !== def.id) return;
  const myToken = ++state.refreshToken;
  const fresh = tryResolveSync(def);
  if (fresh) {
    state.resolved = fresh;
    return;
  }
  void _refreshResolvedAsync(def.id, myToken);
}

async function _refreshResolvedAsync(deckId, myToken) {
  try {
    const def = findDeck(deckId);
    if (!def) return;
    const fresh = await resolveDeck(def);
    // Discard if a newer refresh has started, the user switched decks,
    // or state.resolved was nulled out (deck deletion, reset).
    if (myToken !== state.refreshToken) return;
    if (!state.resolved || state.resolved.def.id !== deckId) return;
    state.resolved = fresh;
    rerenderDeckViews();
  } catch (err) {
    if (myToken !== state.refreshToken) return;
    console.error(err);
    setStatus(`Erreur Scryfall : ${err.message}`, "error");
  }
}



// ============================================================
// Wire up + init
// ============================================================
function bindEvents() {
  els.tabPlay.addEventListener("click", () => switchView("play"));
  els.tabManage.addEventListener("click", () => switchView("manage"));
  els.tabAnalyze.addEventListener("click", () => switchView("analyze"));
  els.tabGallery.addEventListener("click", () => switchView("gallery"));
  els.langSwitchEn.addEventListener("click", () => setManageLanguage("en"));
  els.langSwitchFr.addEventListener("click", () => setManageLanguage("fr"));
  /* Format edit dropdown: trigger toggles the menu, each item sets the
   * deck format. setupDropdown handles outside-click, Escape, and the
   * aria-expanded sync on the trigger. */
  const formatDropdown = setupDropdown({
    trigger: els.formatTrigger,
    menu: els.formatMenu,
  });
  els.formatMenu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-format]");
    if (!item) return;
    setDeckFormat(item.dataset.format);
    if (formatDropdown) formatDropdown.close();
  });
  els.btnDraw.addEventListener("click", drawOne);
  els.btnNextTurn.addEventListener("click", advanceTurn);
  els.btnNew.addEventListener("click", startNewGame);
  els.btnDeleteDeck.addEventListener("click", deleteCurrentDeck);
  els.btnDuplicateDeck.addEventListener("click", duplicateCurrentDeck);
  els.btnImportToggle.addEventListener("click", openImportPanel);
  els.btnExport.addEventListener("click", () => openIeModal("export"));
  els.ieModalClose.addEventListener("click", closeIeModal);
  els.exportFormat.addEventListener("change", refreshExportOutput);
  els.exportCopy.addEventListener("click", onExportCopy);
  els.exportDownload.addEventListener("click", onExportDownload);
  els.importCancel.addEventListener("click", closeImportPanel);
  els.importConfirm.addEventListener("click", confirmImport);
  els.importText.addEventListener("input", refreshImportPreview);
  els.deckSelect.addEventListener("change", (e) => switchDeck(e.target.value));

  /* Manage view deck-summary "Lancer une partie" — switches to the
   * play view and restarts the game on the current deck. The former
   * "Pioche test" button was dropped: it called startNewGame()
   * without switching view, so the user redrew a hand they couldn't
   * see (the hand lives on the play view). */
  const btnPlayDeck = document.getElementById("btn-play-deck");
  if (btnPlayDeck) btnPlayDeck.addEventListener("click", () => {
    switchView("play");
    startNewGame();
  });

  /* Kebab menu (⋮) — holds Renommer + Dupliquer + Exporter + Supprimer
   * + future deck-level actions. setupDropdown wires open/close/
   * outside-click/Escape. */
  const kebabTrigger = document.getElementById("btn-deck-kebab");
  const kebabMenu = document.getElementById("deck-kebab-menu");
  const kebabDropdown = setupDropdown({ trigger: kebabTrigger, menu: kebabMenu });
  /* Close the menu after picking any action — same pattern as the
   * header deck-pill dropdown's import/delete handlers. */
  if (kebabDropdown) {
    kebabMenu.addEventListener("click", (e) => {
      if (e.target.closest(".dropdown-item")) kebabDropdown.close();
    });
  }
  /* Inline rename: kebab "Renommer" → swap h1 for an input.
   * Enter / blur commits, Escape cancels. The blur handler is
   * registered on the input itself; we use `e.preventDefault` on
   * Enter so the input doesn't submit a form. */
  const btnRenameDeck = document.getElementById("btn-rename-deck");
  const renameInput = document.getElementById("manage-deck-name-input");
  if (btnRenameDeck) btnRenameDeck.addEventListener("click", () => startRenameDeck());
  if (renameInput) {
    renameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); endRenameDeck(true); }
      else if (e.key === "Escape") { e.preventDefault(); endRenameDeck(false); }
    });
    renameInput.addEventListener("blur", () => endRenameDeck(true));
  }

  /* Inline description: click on the description text → swap to a
   * textarea + Save/Cancel buttons. Escape also cancels (same as
   * Annuler). Save persists via commitDeckChange. */
  const descDisplay = document.getElementById("manage-deck-description");
  const descInput = document.getElementById("manage-deck-description-input");
  const descSave = document.getElementById("btn-description-save");
  const descCancel = document.getElementById("btn-description-cancel");
  if (descDisplay) descDisplay.addEventListener("click", () => startEditDescription());
  if (descSave) descSave.addEventListener("click", () => endEditDescription(true));
  if (descCancel) descCancel.addEventListener("click", () => endEditDescription(false));
  if (descInput) {
    descInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); endEditDescription(false); }
    });
  }

  /* Header deck-pill dropdown setup lives in app-header.js. */
  setupHeaderDropdown();
  /* Account dropdown is set up in app-login.js — it owns the
   * trigger logic (anon → login overlay, authed → toggle menu). */

  // Click on the backdrop closes the modal; clicks on the inner content
  // (image, action buttons) don't propagate to the backdrop comparison.
  els.modal.addEventListener("click", (e) => {
    if (e.target === els.modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (els.modal.classList.contains("open")) closeModal();
    else if (els.ieModal.classList.contains("open")) closeIeModal();
    /* The dropdowns close themselves on Escape (setupDropdown wires
     * it), so no manual handling here. */
  });
}

function init() {
  cacheElements();
  buildBasicLandButtons();
  bindEvents();
  setupDropTargets();
  setupAddCardUI();
  setupNavIndicator();

  // Restore the user's last manage-view language preference. Done
  // before any render so the first paint is in the right language.
  try {
    const saved = localStorage.getItem(MANAGE_LANG_KEY);
    if (saved === "en" || saved === "fr") {
      state.manageLang = saved;
      els.langSwitchEn.classList.toggle("active", saved === "en");
      els.langSwitchFr.classList.toggle("active", saved === "fr");
      els.langSwitchEn.setAttribute("aria-pressed", String(saved === "en"));
      els.langSwitchFr.setAttribute("aria-pressed", String(saved === "fr"));
    }
  } catch (e) { /* localStorage blocked */ }

  // Login-obligatoire model: no default-deck seeding. The boot uses
  // a localStorage session hint (set by sync.js when Firebase confirms
  // a user, cleared on signOut). When the hint is present:
  //   - boot-theme.js skipped the auth-locked class — shell visible.
  //   - we optimistically render the user's last deck from the
  //     localStorage cache, so an F5 by a signed-in user sees zero
  //     flash. The auth handler below validates with Firebase and
  //     corrects if persistence has actually expired.
  // When the hint is absent: the shell is locked, no render needed.
  //
  // One-shot legacy wipe: existing installs may still carry the old
  // anon-mode user-decks-v1 + seeded-defaults flag. Drop them once so
  // a user who signs in fresh doesn't see ghost decks before cloud
  // takes over. Idempotent via the OBLIGATORY_LOGIN_FLAG below.
  const OBLIGATORY_LOGIN_FLAG = "mtg-hand-sim:obligatory-login-v1";
  try {
    if (!localStorage.getItem(OBLIGATORY_LOGIN_FLAG)) {
      localStorage.removeItem("mtg-hand-sim:user-decks-v1");
      localStorage.removeItem("mtg-hand-sim:defaults-seeded-v1");
      localStorage.setItem(OBLIGATORY_LOGIN_FLAG, "1");
    }
  } catch (e) { /* localStorage blocked — skip the wipe, no harm */ }

  // Optimistic boot render. Reads the hint set by sync.js — if we
  // had a recent session, populate immediately so the deck list and
  // last-loaded deck appear with the first paint, not after Firebase
  // resolves persistence ~50-200ms later.
  let hasSessionHint = false;
  try { hasSessionHint = localStorage.getItem("mtg-hand-sim:has-session-v1") === "1"; }
  catch (e) { /* localStorage blocked — fall back to non-optimistic boot */ }
  populateDeckSelect();
  if (hasSessionHint && state.currentDeckId) {
    switchDeck(state.currentDeckId);
  } else {
    clearActiveView();
  }

  /* Honour the user's "default view at open" preference set in
   * Settings → Préférences. Falls through to the markup's default
   * (Play) when no preference is saved. */
  try {
    const defaultView = localStorage.getItem("deckrypt-default-view");
    if (["play", "manage", "analyze", "gallery"].includes(defaultView) && defaultView !== "play") {
      switchView(defaultView);
    }
  } catch (e) { /* localStorage blocked */ }

  // Cache eviction is amortised once per session, scheduled off the
  // critical render path so F5 doesn't pay for it. resolveDeck used
  // to call evictExpired() inline — that added ~5–15 ms to every
  // page load for no UX benefit.
  setTimeout(() => evictExpired(), 1000);

  // Auth handler — runs ONCE when Firebase resolves persistence, then
  // again on every sign-in/out. The optimistic boot above may have
  // already rendered; this callback validates with Firebase and
  // either confirms (re-render is a no-op cache hit) or wipes (user
  // is actually signed out — clear UI, lock the shell via the class
  // toggle in app-login.js).
  //
  // Note: sync.js's onAuthChange does NOT replay until Firebase has
  // confirmed the initial state (authResolved flag) — that's what
  // prevents the "flash of login overlay" race for already-signed-in
  // users on F5.
  //
  // sync.js is an ES module and executes AFTER this classic-defer
  // script, so window.sync isn't ready when init() runs synchronously
  // — wait for DOMContentLoaded, which fires only once every deferred
  // + module script has executed.
  document.addEventListener("DOMContentLoaded", () => {
    if (!window.sync || typeof window.sync.onAuthChange !== "function") return;
    window.sync.onAuthChange(async (user) => {
      if (!user) {
        /* Sign-out, token expiration, or remote logout. sync.js has
         * already wiped the localStorage cache + the session hint;
         * here we clear in-memory state and re-render. The shell is
         * being re-locked by app-login.js in parallel, so nothing
         * the user can see flickers — only the in-memory state of a
         * future re-login is at risk if we leave it stale. */
        state.currentDeckId = null;
        state.resolved = null;
        state.deckCache.clear();
        populateDeckSelect();
        clearActiveView();
        return;
      }
      /* User confirmed by Firebase. If init() optimistically rendered
       * (hint was set), this is a reconciliation — populateDeckSelect
       * picks up any cloud-side change, the deckCache.delete forces a
       * fresh resolve in case cloud returned a different version of
       * the active deck, and switchDeck re-renders. Cache hits make
       * this visually invisible in the happy case. */
      try { await window.sync.loadAllDecks(); }
      catch (e) { console.warn("Cloud deck load failed (will retry on next sync trigger):", e); }
      populateDeckSelect();
      /* populateDeckSelect just ran and either kept a valid
       * currentDeckId or reset it to the first deck (or null if no
       * decks exist) — no need for a separate stillValid check. */
      if (state.currentDeckId) {
        state.deckCache.delete(state.currentDeckId);
        switchDeck(state.currentDeckId);
      } else {
        clearActiveView();
      }
    });
    /* Queue change observer — refreshes the manage deck-summary's
     * sync indicator from "Sync en attente (N)" to "Synchronisé"
     * (or back) every time the pending-write queue changes. Without
     * this the indicator would stay stuck on its initial render. */
    if (typeof window.sync.onQueueChange === "function") {
      window.sync.onQueueChange(() => {
        if (typeof renderDeckSummary !== "function") return;
        renderDeckSummary(findDeck(state.currentDeckId) || null);
      });
    }
    /* Online/offline transitions don't fire onQueueChange (the
     * queue itself doesn't mutate) but the sync indicator depends
     * on `navigator.onLine`. Re-render so the "Hors-ligne" pill
     * appears / disappears in lock-step with the connection state.
     * sync.js's own `online` listener triggers a drain in parallel
     * — that handles the recovery path. */
    const reRenderSummary = () => {
      if (typeof renderDeckSummary !== "function") return;
      renderDeckSummary(findDeck(state.currentDeckId) || null);
    };
    window.addEventListener("offline", reRenderSummary);
    window.addEventListener("online", reRenderSummary);
  });
}

// Auto-init in browser context. The presence-check skips this when the
// file is required by a unit test (no DOM — pure modules are tested instead).
if (typeof document !== "undefined" && document.getElementById("deck-select")) {
  init();
}
