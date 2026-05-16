/* Manage view — deck editor: card rows grouped by type, qty controls,
 * printing picker, remove buttons, format selector, EN/FR card-name
 * toggle, add-card UI (autocomplete + paste-add).
 *
 * Reads `state`, `els` and shared helpers: `placeholderText` +
 * `makeXIcon` from `dom-helpers.js`, `makeCardEl` from `app-play.js`,
 * `showModal` / `closeModal` / `commitDeckChange` /
 * `rerenderDeckViews` / `setStatus` / `findDeck` from `app.js`.
 * Load order: after dom-helpers.js, after app-play.js (for
 * `makeCardEl`), after app-manage-side.js (renderSideComposition /
 * renderSideBracket — split out when this file passed 1300 lines),
 * after pure modules, before app.js. */

const MANAGE_LANG_KEY = "mtg-hand-sim:manage-lang";

/* Set of English card names whose French translation is currently
 * being fetched. Drives the per-row "is-translating" spinner so the
 * user sees feedback on each card individually as batches land. */
const pendingTranslations = new Set();

/* Resolve an entry's display name to its French translation when the
 * manage-language toggle is on FR and a translation is cached.
 * Falls back silently to the English name. */
function getDisplayName(entry) {
  if (state.manageLang === "fr") {
    const fr = getTranslation(entry.name);
    if (fr) return fr;
  }
  return entry.name;
}

/* Toggle the manage view between EN and FR card names. The first
 * switch to FR may take a second or two while we batch-fetch
 * translations from Scryfall — subsequent toggles are instant since
 * everything's in localStorage. */
async function setManageLanguage(lang) {
  if (lang !== "en" && lang !== "fr") return;
  if (state.manageLang === lang) return;
  state.manageLang = lang;
  try { localStorage.setItem(MANAGE_LANG_KEY, lang); } catch (e) { /* non-fatal */ }
  els.langSwitchEn.classList.toggle("active", lang === "en");
  els.langSwitchFr.classList.toggle("active", lang === "fr");
  els.langSwitchEn.setAttribute("aria-pressed", String(lang === "en"));
  els.langSwitchFr.setAttribute("aria-pressed", String(lang === "fr"));

  if (!els.viewManage.hidden) renderManageView();
  if (lang === "fr") await ensureFrenchTranslationsForCurrentDeck();
}

/* Make sure every name in the current deck has a French entry in the
 * translation cache, then re-render the manage view. Driven by both
 * the FR toggle and any deck switch while FR is active. Surfaces a
 * spinner on the FR button so the user knows something's happening
 * (Scryfall search batches take ~1–2 s for a 100-card deck). */
async function ensureFrenchTranslationsForCurrentDeck() {
  if (state.manageLang !== "fr") return;
  const def = findDeck(state.currentDeckId);
  if (!def) return;
  const names = [
    ...def.commanders.map((c) => c.name),
    ...def.cards.map((c) => c.name),
  ];

  // Mark every name without a cached translation as pending so each
  // row shows its own "translating…" spinner until the batch lands.
  // Cached names skip the spinner entirely (instant translation).
  pendingTranslations.clear();
  for (const n of names) {
    if (!getTranslation(n)) pendingTranslations.add(n);
  }
  if (!els.viewManage.hidden) renderManageView();

  // Show the global banner only if the fetch is taking a noticeable
  // amount of time — avoids a flicker when every name is already
  // cached. Per-card spinners are the primary signal; the banner is
  // just a macro indicator for big decks.
  els.langSwitchFr.classList.add("is-loading");
  const bannerTimer = setTimeout(() => {
    els.translationBanner.hidden = false;
  }, 200);
  try {
    await fetchFrenchNames(names, (batch) => {
      // Each completed batch clears its names from pending and
      // re-renders so those rows get their FR text + lose the spinner.
      for (const n of batch) pendingTranslations.delete(n);
      if (state.manageLang === "fr" && !els.viewManage.hidden) renderManageView();
    });
  } finally {
    pendingTranslations.clear();
    clearTimeout(bannerTimer);
    els.translationBanner.hidden = true;
    els.langSwitchFr.classList.remove("is-loading");
  }
  if (state.manageLang === "fr" && !els.viewManage.hidden) renderManageView();
}

/* Inline rename for the active deck. Triggered by the kebab menu's
 * "Renommer" item — swaps the h1 for an input, focuses + selects
 * the current name, and commits on Enter / blur (Escape cancels).
 *
 * State machine guarded by `renameInProgress` so the blur handler
 * that fires AFTER an Enter commit doesn't run a second time on
 * the now-empty input. */
let renameInProgress = false;

function startRenameDeck() {
  const def = findDeck(state.currentDeckId);
  if (!def) return;
  const h1 = document.getElementById("manage-deck-name");
  const input = document.getElementById("manage-deck-name-input");
  if (!h1 || !input) return;
  renameInProgress = true;
  input.value = def.name;
  h1.hidden = true;
  input.hidden = false;
  /* requestAnimationFrame: focus + select after the input becomes
   * visible — focusing on `display:none` is a silent no-op. */
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

/* Description: click-to-edit, textarea + Save/Cancel buttons. Same
 * state-machine pattern as the rename flow — `descEditInProgress`
 * guards against the blur/double-fire race when Save is clicked. */
let descEditInProgress = false;
const DESCRIPTION_PLACEHOLDER = "Ajoute une description (mulligan rule, win con, notes de testing…)";

function refreshDeckDescription(def) {
  const display = document.getElementById("manage-deck-description");
  if (!display) return;
  const desc = (def?.description || "").trim();
  if (desc) {
    display.textContent = desc;
    display.classList.remove("is-empty");
  } else {
    display.textContent = DESCRIPTION_PLACEHOLDER;
    display.classList.add("is-empty");
  }
}

function startEditDescription() {
  const def = findDeck(state.currentDeckId);
  if (!def) return;
  const display = document.getElementById("manage-deck-description");
  const editor = document.getElementById("manage-deck-description-editor");
  const input = document.getElementById("manage-deck-description-input");
  if (!display || !editor || !input) return;
  descEditInProgress = true;
  input.value = def.description || "";
  display.hidden = true;
  editor.hidden = false;
  /* requestAnimationFrame because focusing on a still-hidden element
   * is a silent no-op. Cursor at end > select-all because edits tend
   * to be appends, not full replacements. */
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function endEditDescription(save) {
  if (!descEditInProgress) return;
  descEditInProgress = false;
  const display = document.getElementById("manage-deck-description");
  const editor = document.getElementById("manage-deck-description-editor");
  const input = document.getElementById("manage-deck-description-input");
  if (!display || !editor || !input) return;
  if (save) {
    const def = findDeck(state.currentDeckId);
    const newDesc = input.value.trim();
    const current = (def?.description || "").trim();
    if (def && newDesc !== current) {
      if (newDesc) def.description = newDesc;
      else delete def.description;
      commitDeckChange(def);
    }
  }
  editor.hidden = true;
  display.hidden = false;
  refreshDeckDescription(findDeck(state.currentDeckId));
}

function endRenameDeck(save) {
  if (!renameInProgress) return;
  renameInProgress = false;
  const h1 = document.getElementById("manage-deck-name");
  const input = document.getElementById("manage-deck-name-input");
  if (!h1 || !input) return;
  if (save) {
    const def = findDeck(state.currentDeckId);
    const newName = input.value.trim();
    if (def && newName && newName !== def.name) {
      def.name = newName;
      if (commitDeckChange(def)) {
        /* Refresh every surface that displays the name: deck-pill +
         * dropdown labels (populateDeckSelect) and the manage view's
         * h1 + meta (renderDeckSummary). commitDeckChange already
         * updated localStorage + state.resolved.def. */
        populateDeckSelect();
        renderDeckSummary(def);
      }
    }
  }
  input.hidden = true;
  h1.hidden = false;
}

/* Persist a format change (Commander / Format libre) on the active
 * deck and refresh the views that depend on it (the manage view's
 * selector display + the analyze view's legality and suggestions). */
function setDeckFormat(format) {
  if (format !== "commander" && format !== "limited") return;
  const def = findDeck(state.currentDeckId);
  if (!def) return;
  if (def.format === format) return;
  def.format = format;
  if (!commitDeckChange(def)) return;
  /* Sync the add-card draft's "Ajouter comme commandant" toggle in
   * case the draft is open when the user flips the format — Limited
   * has no commander zone, so the toggle has to disappear (and any
   * previously-checked state has to clear). */
  refreshAddCardDraftAsCommander();
  rerenderDeckViews();
}

/* Build a manage-view card row. Resolved Scryfall data is optional —
 * we render with the card name even if Scryfall hasn't been hit yet
 * (e.g. before the first switch to the play view).
 *
 * The body is a thin orchestrator: each section of the row is built
 * by its own `_buildCardRow*` helper below. Keeps this function
 * readable as a top-down list of "what's on a row" rather than 100
 * lines of mixed DOM scaffolding. */
function makeManageCardRow(entry, resolvedCard, opts) {
  const row = document.createElement("div");
  row.className = "card-row";
  if (state.recentlyAddedNames.has(entry.name)) {
    /* Brief flash to draw the eye after a paste/draft add. The class
     * carries a CSS animation that auto-fades to the normal style;
     * we don't need to clean it up here (state.recentlyAddedNames
     * gets cleared on the same timer). */
    row.classList.add("card-row--just-added");
  }
  /* Per-render displayName closure (bulk-translation-aware) so a
   * 100-card render doesn't read localStorage 100 times. */
  const labelText = opts.displayName ? opts.displayName(entry) : getDisplayName(entry);
  const isTranslating = state.manageLang === "fr" && pendingTranslations.has(entry.name);
  if (isTranslating) row.classList.add("is-translating");

  row.appendChild(_buildCardRowThumb(entry, resolvedCard));
  row.appendChild(_buildCardRowName(entry, resolvedCard, labelText, isTranslating));
  row.appendChild(_buildCardRowMana(resolvedCard));
  row.appendChild(_buildCardRowPrintingPill(entry, opts.kind));
  if (opts.kind === "card") row.appendChild(_buildCardRowQty(entry));
  row.appendChild(_buildCardRowRemove(entry, opts.kind));
  return row;
}

function _buildCardRowThumb(entry, resolvedCard) {
  const thumb = document.createElement("button");
  thumb.type = "button";
  thumb.className = "card-row-thumb";
  const imgSrc = resolvedCard ? cardImage(resolvedCard, "small") : null;
  if (imgSrc) {
    const img = document.createElement("img");
    img.src = imgSrc;
    img.alt = "";
    img.loading = "lazy";
    thumb.appendChild(img);
  } else {
    // Card hasn't been resolved by Scryfall (typo on import → "Inconnu"
    // bucket, or fetch still pending). The shared skeleton fill shows
    // the card name centered on a card-shaped placeholder — same look
    // as the play view's unresolved cards and the gallery's missing
    // tiles.
    appendSkeletonFill(thumb, entry.name);
  }
  if (resolvedCard) {
    thumb.title = `Agrandir ${entry.name}`;
    thumb.setAttribute("aria-label", `Agrandir ${entry.name}`);
    thumb.addEventListener("click", () => showModal(resolvedCard, []));
  } else {
    thumb.disabled = true;
    thumb.setAttribute("aria-label", `Image indisponible pour ${entry.name}`);
  }
  return thumb;
}

function _buildCardRowName(entry, resolvedCard, labelText, isTranslating) {
  const name = document.createElement("div");
  name.className = "card-row-name";
  const labelSpan = document.createElement("span");
  labelSpan.className = "card-row-name-label";
  labelSpan.textContent = labelText;
  name.appendChild(labelSpan);
  /* Game Changer chip — small amber pill next to the name on
   * Manage rows, mirroring the GC pin shown on Play cards. */
  if (resolvedCard && resolvedCard.game_changer === true) {
    const chip = document.createElement("span");
    chip.className = "gc-chip";
    chip.textContent = "GC";
    chip.title = "Game Changer";
    chip.setAttribute("aria-label", "Game Changer");
    name.appendChild(chip);
  }
  if (isTranslating) {
    const spinner = document.createElement("span");
    spinner.className = "card-row-spinner";
    spinner.setAttribute("aria-hidden", "true");
    name.appendChild(spinner);
  }
  return name;
}

/* Inline mana cost — one badge per `{…}` symbol in the card's
 * `mana_cost`. The colour-band gives an instant read of the card's
 * identity within its type group (which sorts by colour), the
 * generic-cost numbers make the curve scannable. Empty for lands
 * and cards without a cost. */
function _buildCardRowMana(resolvedCard) {
  const mana = document.createElement("span");
  mana.className = "mana-cost card-row-mana";
  if (resolvedCard && typeof resolvedCard.mana_cost === "string" && resolvedCard.mana_cost) {
    for (const sym of parseManaSymbols(resolvedCard.mana_cost)) {
      mana.appendChild(makeManaSymbol(sym));
    }
  }
  return mana;
}

function _buildCardRowPrintingPill(entry, kind) {
  const printing = document.createElement("button");
  printing.type = "button";
  printing.className = "card-row-printing";
  printing.textContent = entry.set
    ? `${entry.set.toUpperCase()} #${entry.collector_number || "?"}`
    : "édition par défaut";
  printing.title = "Changer l'édition";
  printing.addEventListener("click", () => openPrintingPicker(entry, kind));
  return printing;
}

function _buildCardRowQty(entry) {
  const qty = document.createElement("div");
  qty.className = "card-row-qty";
  const minus = document.createElement("button");
  minus.type = "button";
  minus.textContent = "−";
  minus.setAttribute("aria-label", "Retirer un exemplaire");
  minus.addEventListener("click", () => onQtyDelta(entry, -1));
  const value = document.createElement("span");
  value.textContent = entry.qty;
  const plus = document.createElement("button");
  plus.type = "button";
  plus.textContent = "+";
  plus.setAttribute("aria-label", "Ajouter un exemplaire");
  plus.addEventListener("click", () => onQtyDelta(entry, +1));
  qty.append(minus, value, plus);
  return qty;
}

function _buildCardRowRemove(entry, kind) {
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "card-row-remove";
  remove.title = "Retirer du deck";
  remove.setAttribute("aria-label", `Retirer ${entry.name} du deck`);
  remove.appendChild(makeXIcon(14));
  remove.addEventListener("click", () => onRemoveEntry(entry, kind));
  return remove;
}

/* `ctx` is optional but supplied by rerenderDeckViews — when it's
 * present we reuse its already-built `def` and `cacheReader` to avoid
 * re-parsing localStorage. Standalone calls (deck switches, language
 * toggles) fall through to fresh lookups. */
function renderManageView(ctx = null) {
  const def = ctx?.def || findDeck(state.currentDeckId);
  /* `.view-empty` flips the whole tab to the shared CTA — see
   * `.view-empty` rule in views.css. No need to reset the deck-name
   * h1 / meta / count: their parents are hidden by the class so the
   * text content is non-observable until a deck loads (and then the
   * happy path below repopulates it). */
  els.viewManage.classList.toggle("view-empty", !def);
  if (!def) return;
  els.manageDeckName.textContent = def.name;
  const totalCards = def.cards.reduce((n, c) => n + c.qty, 0);
  els.manageMeta.textContent =
    `${pluralFr(def.commanders.length, "commandant")} · ${totalCards} cartes principales`;
  els.manageCardsCount.textContent = `${pluralFr(def.cards.length, "ligne")} (${totalCards} au total)`;
  /* Format edit no longer uses a <select> — the deck-summary's
   * #manage-deck-format-label is set by renderDeckSummary below from
   * def.format, and clicking it opens a dropdown to switch. */

  /* Deck summary header (commander art + meta + actions) and the
   * side panel (composition + bracket). These depend on
   * state.resolved being populated; they degrade to a placeholder
   * shape when it isn't (cold load / never-resolved deck). */
  renderDeckSummary(def);
  renderSideComposition();
  renderSideBracket();

  const cacheReader = ctx?.cacheReader || cardCacheReader();
  const translate = state.manageLang === "fr" ? bulkTranslationLookup() : null;

  // Two layers for thumbnails:
  //   1. card-cache (per-printing) — picks up brand-new printings the
  //      user just selected from the picker; openPrintingPicker caches
  //      every fetched printing on the way in, so this hit is instant.
  //   2. state.resolved (per-name fallback) — covers cards we never
  //      re-fetched specifically for the manage view but Scryfall
  //      returned during the deck-level resolution.
  /* Case-insensitive name -> resolved card lookup. We key by lower-
   * case so a paste-add of "1 sol ring" (any casing the user fancies)
   * still matches Scryfall's canonical "Sol Ring" — otherwise the
   * row falls into the Inconnu bucket with no thumbnail. */
  const resolvedByName = new Map();
  if (state.resolved) {
    for (const c of [...state.resolved.commanders, ...state.resolved.deck]) {
      if (c.name) {
        const k = c.name.toLowerCase();
        if (!resolvedByName.has(k)) resolvedByName.set(k, c);
      }
    }
  }
  const resolveForEntry = (entry) => resolvedByName.get(entry.name.toLowerCase()) || null;
  const thumbFor = (entry) => {
    if (entry.set && entry.collector_number) {
      const cached = cacheReader.getByPrinting(entry.set, entry.collector_number);
      if (cached) return cached;
    }
    return resolveForEntry(entry);
  };
  const displayName = (entry) => {
    /* Canonicalise first, translate second. A paste-add of "1 island"
     * gives the entry name "island" (lowercase), but the FR cache is
     * keyed by Scryfall's "Island" — without this normalisation the
     * lookup misses and the row stays English on the EN→FR toggle.
     * Fallback to the entry's raw name while the async resolve is
     * still in flight (no resolved card yet). */
    const resolved = resolveForEntry(entry);
    const canonical = (resolved && resolved.name) || entry.name;
    if (translate) {
      const fr = translate(canonical);
      if (fr) return fr;
    }
    return canonical;
  };

  els.manageCommanders.replaceChildren();
  if (def.commanders.length === 0) {
    els.manageCommanders.appendChild(placeholderText("Aucun commandant."));
  } else {
    for (const e of def.commanders) {
      els.manageCommanders.appendChild(
        makeManageCardRow(e, thumbFor(e), { kind: "commander", displayName }),
      );
    }
  }

  els.manageCards.replaceChildren();
  if (def.cards.length === 0) {
    els.manageCards.appendChild(placeholderText("Aucune carte."));
  } else {
    appendCardGroupsByType(def.cards, thumbFor, displayName);
  }
}

/* Parse a Scryfall `mana_cost` string into an ordered list of raw
 * symbol payloads. "{2}{U}{B}" → ["2", "U", "B"]. Order matters for
 * rendering — the inline mana-cost reads like the printed card. */
function parseManaSymbols(cost) {
  const matches = (cost || "").match(/\{[^}]+\}/g) || [];
  return matches.map((s) => s.slice(1, -1));
}

/* Build one `<img>` element for a parsed mana symbol, pointing at
 * the self-hosted Scryfall SVG. Naming convention follows Scryfall's
 * own URLs (strip braces, drop slashes, uppercase): `{W}` → W.svg,
 * `{2/U}` → 2U.svg, `{W/P}` → WP.svg, etc. Full set (84 symbols
 * at time of writing) lives in `assets/mana-symbols/` with a
 * `manifest.json` describing each one — refreshable when WotC ships
 * a new symbol.
 *
 * The error handler is the forward-compat seam: if a new extension
 * introduces a symbol we haven't downloaded yet, the row renders a
 * neutral text-disc fallback instead of a broken-image icon. */
function makeManaSymbol(raw) {
  const inner = (raw || "").toUpperCase();
  const file = inner.replace(/\//g, "") + ".svg";
  const img = document.createElement("img");
  img.className = "mana-symbol";
  img.src = `assets/mana-symbols/${file}`;
  img.alt = inner;
  img.setAttribute("aria-label", inner);
  img.loading = "lazy";
  img.addEventListener("error", () => {
    const sp = document.createElement("span");
    sp.className = "mana-symbol mana-symbol-fallback";
    sp.textContent = inner;
    sp.setAttribute("aria-label", inner);
    img.replaceWith(sp);
  });
  return img;
}

/* Group the deck entries by primary type (Land / Creature / …),
 * sort each group by colour band (mono W→U→B→R→G → multi → colourless)
 * then CMC then name, and render with a typed header. The colour is
 * conveyed VISUALLY by the per-row `.mana-cost` pips on the right —
 * we don't write the colour in the group title.
 * Falls back to a single "Inconnu" bucket for cards we couldn't
 * resolve via Scryfall yet. */
const TYPE_ORDER = [
  "Land", "Creature", "Planeswalker", "Battle",
  "Artifact", "Enchantment", "Instant", "Sorcery", "Inconnu",
];
const TYPE_LABELS_FR = {
  Land: "Terrains",
  Creature: "Créatures",
  Planeswalker: "Arpenteurs",
  Battle: "Batailles",
  Artifact: "Artefacts",
  Enchantment: "Enchantements",
  Instant: "Éphémères",
  Sorcery: "Rituels",
  Inconnu: "Inconnu",
};

/* Sort key for colour-band ordering inside a type bucket:
 * 0..4 = mono W/U/B/R/G, 5 = multi, 6 = colourless, 7 = unknown. */
function colorSortKey(card) {
  if (!card || !Array.isArray(card.color_identity)) return 7;
  const ci = card.color_identity;
  if (ci.length === 0) return 6;
  if (ci.length >= 2) return 5;
  const idx = COLOR_ORDER.indexOf(ci[0]);
  return idx === -1 ? 7 : idx;
}

function appendCardGroupsByType(entries, thumbFor, displayName) {
  /* One pass: bucket each entry by type AND cache its sort keys
   * (colour band + CMC). The comparator below is called O(N log N)
   * times per bucket — without this memoisation each comparison
   * would re-call `thumbFor(a)` + `thumbFor(b)` and recompute the
   * colour key, ~6× the cost of the actual comparison. */
  const buckets = new Map(TYPE_ORDER.map((t) => [t, []]));
  const sortKeys = new Map();
  for (const e of entries) {
    const card = thumbFor(e);
    const t = card ? primaryTypeOf(card) : null;
    const key = t || "Inconnu";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
    sortKeys.set(e, {
      color: colorSortKey(card),
      cmc: card && typeof card.cmc === "number" ? card.cmc : 99,
    });
  }

  // Sort within each bucket: colour band → CMC → name (locale).
  for (const list of buckets.values()) {
    list.sort((a, b) => {
      const ka = sortKeys.get(a);
      const kb = sortKeys.get(b);
      if (ka.color !== kb.color) return ka.color - kb.color;
      if (ka.cmc !== kb.cmc) return ka.cmc - kb.cmc;
      return a.name.localeCompare(b.name);
    });
  }

  for (const [type, list] of buckets) {
    if (list.length === 0) continue;
    /* <details> gives us collapse/expand for free — open by default,
     * closed if the user previously chose to fold this type away.
     * `state.collapsedManageGroups` is updated on the toggle event so
     * re-renders (from edits) preserve the user's choice. */
    const group = document.createElement("details");
    group.className = "card-group";
    group.dataset.groupType = type;
    group.open = !state.collapsedManageGroups.has(type);

    const summary = document.createElement("summary");
    summary.className = "card-group-title";
    const label = document.createElement("span");
    label.className = "card-group-label";
    label.textContent = TYPE_LABELS_FR[type] || type;
    summary.appendChild(label);
    const count = document.createElement("strong");
    count.className = "card-group-count";
    count.textContent = list.reduce((n, e) => n + e.qty, 0);
    summary.appendChild(count);
    const chevron = document.createElement("span");
    chevron.className = "card-group-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▾";
    summary.appendChild(chevron);
    group.appendChild(summary);

    group.addEventListener("toggle", () => {
      if (group.open) state.collapsedManageGroups.delete(type);
      else state.collapsedManageGroups.add(type);
    });

    const rows = document.createElement("div");
    rows.className = "card-group-rows";
    for (const e of list) {
      rows.appendChild(makeManageCardRow(e, thumbFor(e), { kind: "card", displayName }));
    }
    group.appendChild(rows);

    els.manageCards.appendChild(group);
  }
}

function onQtyDelta(entry, delta) {
  const def = findDeck(state.currentDeckId);
  if (!def) return;
  const name = getDisplayName(entry);
  if (delta > 0) {
    addCard(def, { ...entry, qty: 1 });
  } else {
    removeCard(def, entry, 1);
  }
  if (commitDeckChange(def)) {
    rerenderDeckViews();
    /* The data layer already merged the change; reading qty back from
     * the (possibly removed) entry isn't reliable, so we phrase the
     * flash around the user's action — "+1 X" / "−1 X" — rather than
     * the resulting count. */
    flash(delta > 0 ? `+1 ${name}` : `−1 ${name}`, "success");
  }
}

function onRemoveEntry(entry, kind) {
  const def = findDeck(state.currentDeckId);
  if (!def) return;
  const name = getDisplayName(entry);
  if (kind === "commander") removeCommander(def, entry);
  else setQty(def, entry, 0);
  if (commitDeckChange(def)) {
    rerenderDeckViews();
    flash(`${name} retiré du deck`, "success");
  }
}

/* Printing picker — fetch every printing of the card name, render a
 * grid of thumbnails in the existing modal, click → swap printing. */
async function openPrintingPicker(entry, kind) {
  state.focusBeforeModal = document.activeElement;
  els.modalImg.removeAttribute("src");
  els.modalImg.alt = "";
  els.modalActions.replaceChildren();

  // Wrapper sets the picker's intrinsic width so the grid actually
  // breaks into multiple columns inside the modal-actions flex parent
  // (a bare grid would otherwise size to its content's min-width and
  // collapse to a single column).
  const picker = document.createElement("div");
  picker.className = "printing-picker";

  /* Sticky close (×) in the picker's top-right corner. The picker
   * fills most of the modal at full grid height, so the `.modal`
   * click-outside zone shrinks to a sliver — the user previously had
   * to scroll up to a tiny strip to dismiss. The sticky X gives a
   * predictable exit at all times. */
  const close = document.createElement("button");
  close.type = "button";
  close.className = "printing-picker-close";
  close.setAttribute("aria-label", "Fermer");
  close.appendChild(makeXIcon(18));
  close.addEventListener("click", closeModal);
  picker.appendChild(close);

  const title = document.createElement("h3");
  title.className = "printing-picker-title";
  // Show the FR name when the manage view is in FR mode — getDisplayName
  // falls back to English if no translation is cached.
  title.textContent = `Choisir l'édition de ${getDisplayName(entry)}`;
  picker.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "printing-grid";
  /* Fetch-stage loader — centered spinner + label, spans the whole
   * grid width via `grid-column: 1 / -1`. Replaced by the real tiles
   * once `searchPrintings` resolves. */
  const loader = document.createElement("div");
  loader.className = "printing-loader";
  const spinner = document.createElement("span");
  spinner.className = "printing-loader-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const loaderText = document.createElement("span");
  loaderText.textContent = "Chargement des éditions…";
  loader.append(spinner, loaderText);
  loader.setAttribute("role", "status");
  grid.appendChild(loader);
  picker.appendChild(grid);

  els.modalActions.appendChild(picker);
  els.modal.classList.add("open");
  els.modal.focus();

  let printings;
  try {
    printings = await searchPrintings(entry.name);
  } catch (err) {
    grid.replaceChildren(placeholderText(`Erreur Scryfall : ${err.message}`));
    return;
  }
  if (printings.length === 0) {
    grid.replaceChildren(placeholderText("Aucune édition trouvée."));
    return;
  }
  // Cache the freshly fetched printings — they'll be useful next time
  // the deck is resolved on the play view too.
  cacheCards(printings);

  grid.replaceChildren();
  for (const p of printings) {
    /* `<div role="button">` rather than `<button>` because Chromium
     * doesn't let a real `<button>` grow to contain the ::before
     * padding-bottom block we use to reserve the card's aspect ratio
     * (button's content area is an "intrinsic" rendering context).
     * Accessibility: same `role`, `tabindex`, Enter/Space activation
     * as a button, plus the aria-label. */
    const tile = document.createElement("div");
    tile.className = "printing-tile";
    tile.setAttribute("role", "button");
    tile.tabIndex = 0;
    tile.title = `${p.set_name || p.set?.toUpperCase()} · #${p.collector_number}`;
    tile.setAttribute(
      "aria-label",
      `Choisir ${p.name} ${p.set_name || p.set?.toUpperCase()} #${p.collector_number}`,
    );
    // Use "normal" (488×680) instead of "small" — at 280-320 px tile
    // width the small version visibly blurs.
    const src = cardImage(p, "normal");
    if (src) {
      /* Tiles start in `.is-loading` (shimmer animation), drop it on
       * the image's load/error so the flat surface bg takes over. With
       * 100+ printings of basic lands, images stream in over a few
       * seconds — the shimmer signals progress per tile. */
      tile.classList.add("is-loading");
      const img = document.createElement("img");
      img.src = src;
      img.alt = `${p.name} (${p.set?.toUpperCase()} #${p.collector_number})`;
      img.loading = "lazy";
      const stopShimmer = () => tile.classList.remove("is-loading");
      img.addEventListener("load", stopShimmer);
      img.addEventListener("error", stopShimmer);
      tile.appendChild(img);
    }
    const cap = document.createElement("span");
    cap.className = "printing-tile-cap";
    cap.textContent = `${(p.set || "?").toUpperCase()} · #${p.collector_number}`;
    tile.appendChild(cap);
    const activate = () => {
      applyPrintingChange(entry, kind, p.set, p.collector_number);
      closeModal();
    };
    tile.addEventListener("click", activate);
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
    grid.appendChild(tile);
  }
}

function applyPrintingChange(entry, kind, newSet, newCn) {
  const def = findDeck(state.currentDeckId);
  if (!def) return;
  if (kind === "commander") {
    changeCommanderPrinting(def, entry, newSet, newCn);
  } else {
    changePrinting(def, entry, newSet, newCn);
  }
  if (commitDeckChange(def)) rerenderDeckViews();
}

// ---- Add card UI -------------------------------------------------

let _autocompleteToken = 0;     // discard responses from stale input
let _autocompleteTimer = null;
let _draftName = null;           // name held in the draft slot, or null
let _draftPrintingsToken = 0;    // discard stale searchPrintings responses
let _draftPrintings = [];        // last loaded printings, kept so the
                                 // preview <img> can swap art on
                                 // select-change without re-fetching

function setupAddCardUI() {
  els.addCardInput.addEventListener("input", onAutocompleteInput);
  els.addCardInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      els.addCardSuggestions.hidden = true;
      els.addCardSuggestions.replaceChildren();
      cancelAddCardDraft();
    }
  });
  els.addCardInput.addEventListener("blur", () => {
    // Delay so a click on a suggestion still registers before we hide.
    setTimeout(() => { els.addCardSuggestions.hidden = true; }, 150);
  });
  /* Paste textarea: flag if user clicks "Ajouter depuis la liste"
   * without anything in it, or with content that yields zero cards.
   * Auto-clear listener attached once at setup. */
  window.formValidate.attachAutoClear(els.addCardPasteText);
  els.addCardPasteBtn.addEventListener("click", onPasteAdd);
  els.addCardDraftCancel.addEventListener("click", cancelAddCardDraft);
  els.addCardDraftSubmit.addEventListener("click", submitAddCardDraft);
  els.addCardDraftPrinting.addEventListener("change", () => {
    updateDraftPreview(els.addCardDraftPrinting.value);
  });
  if (els.addCardDraftRole) {
    els.addCardDraftRole.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-role]");
      if (!btn) return;
      setAddCardDraftRole(btn.dataset.role);
    });
  }
  // Enter in the qty field is the natural "validate" gesture.
  els.addCardDraftQty.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitAddCardDraft();
    }
  });
}

function onAutocompleteInput() {
  clearTimeout(_autocompleteTimer);
  const q = els.addCardInput.value;
  if (q.trim().length < 2) {
    els.addCardSuggestions.replaceChildren();
    els.addCardSuggestions.hidden = true;
    return;
  }
  _autocompleteTimer = setTimeout(async () => {
    const myToken = ++_autocompleteToken;
    let entries;
    try {
      entries = await autocompleteCardNamesMultilingual(q);
    } catch (err) {
      console.warn("Autocomplete failed", err);
      return;
    }
    if (myToken !== _autocompleteToken) return;
    renderSuggestions(entries);
  }, 250);
}

function renderSuggestions(entries) {
  els.addCardSuggestions.replaceChildren();
  if (entries.length === 0) {
    els.addCardSuggestions.hidden = true;
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    li.role = "option";
    /* Two-tier display: the French printed name (when available) as
     * the primary label — that's what the user typed — with the
     * English name below in a muted style. The English name remains
     * the identity (deck-edit stores English-keyed entries), so
     * clicking always passes `entry.name` to openAddCardDraft. */
    if (entry.frenchName) {
      const fr = document.createElement("span");
      fr.className = "suggestion-primary";
      fr.textContent = entry.frenchName;
      const en = document.createElement("span");
      en.className = "suggestion-secondary";
      en.textContent = entry.name;
      li.append(fr, en);
    } else {
      const primary = document.createElement("span");
      primary.className = "suggestion-primary";
      primary.textContent = entry.name;
      li.appendChild(primary);
    }
    // mousedown fires before the input's blur — so we don't lose the
    // selection to the blur handler hiding the list.
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      openAddCardDraft(entry.name);
    });
    els.addCardSuggestions.appendChild(li);
  }
  els.addCardSuggestions.hidden = false;
}

/* Selecting a suggestion opens the draft slot: the user picks an
 * edition + a quantity, then clicks "Ajouter au deck" to commit. The
 * printings list is fetched lazily and populates the <select> once
 * Scryfall responds; the user can submit before that (the entry then
 * lands without a specific printing, which is fine — `addCard` lets
 * Scryfall pick a default on next resolve). */
function openAddCardDraft(name) {
  _draftName = name;
  _draftPrintings = [];
  els.addCardSuggestions.hidden = true;
  els.addCardSuggestions.replaceChildren();
  els.addCardInput.value = "";          // make the draft the focus
  els.addCardDraftName.textContent = name;
  els.addCardDraftQty.value = "1";
  /* "Ajouter comme commandant" toggle: visible only for Commander-format
   * decks (Limited / Format libre have no commander zone). Reset to
   * unchecked on every open so the previous draft's choice doesn't
   * carry over silently. */
  refreshAddCardDraftAsCommander();
  els.addCardDraftPrinting.replaceChildren();
  const loading = document.createElement("option");
  loading.value = "";
  loading.textContent = "Chargement des éditions…";
  els.addCardDraftPrinting.appendChild(loading);
  els.addCardDraftPrinting.disabled = true;
  // Hide the preview until printings land (we don't know which art
  // to show yet). Avoids a stale image flash from a previous draft.
  els.addCardDraftPreview.removeAttribute("src");
  els.addCardDraftPreview.alt = "";
  els.addCardDraftPreview.hidden = true;
  els.addCardDraft.hidden = false;
  els.addCardDraftQty.focus();
  els.addCardDraftQty.select();

  /* Fetch printings asynchronously. If the user cancels or picks
   * another card before the response, discard via the token check. */
  const myToken = ++_draftPrintingsToken;
  searchPrintings(name)
    .then((printings) => {
      if (myToken !== _draftPrintingsToken || _draftName !== name) return;
      cacheCards(printings);
      populateDraftPrintings(printings);
    })
    .catch((err) => {
      if (myToken !== _draftPrintingsToken || _draftName !== name) return;
      console.warn("Printings fetch failed", err);
      populateDraftPrintings([]);
    });
}

function populateDraftPrintings(printings) {
  /* Keep _draftPrintings in the original released-desc order so the
   * "Édition par défaut" preview can still surface the most recent
   * print (consistent with what Scryfall returns at resolve time
   * when no set/cn is stored). The <select> options are sorted
   * alphabetically by set name though — way easier to scan when a
   * card has 50+ printings spanning two decades. */
  _draftPrintings = printings;
  els.addCardDraftPrinting.replaceChildren();
  const def = document.createElement("option");
  def.value = "";
  def.textContent = printings.length === 0
    ? "Édition par défaut (aucune trouvée)"
    : "Édition par défaut";
  els.addCardDraftPrinting.appendChild(def);
  /* Two-level sort: set name alphabetically, then collector number
   * numerically within the same set so OTJ #279 sits above OTJ #280
   * (the released-desc fallback would have put 280 above 279). CNs
   * can be alphanumeric ("100★", "★1") — we extract the leading
   * integer for the numeric compare and tiebreak on the raw string
   * so two non-numeric CNs stay alphabetically ordered. */
  const cnNum = (cn) => {
    const n = parseInt(cn, 10);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };
  const sorted = [...printings].sort((a, b) => {
    const an = (a.set_name || a.set || "").toLowerCase();
    const bn = (b.set_name || b.set || "").toLowerCase();
    const cmp = an.localeCompare(bn, "fr");
    if (cmp !== 0) return cmp;
    const ai = cnNum(a.collector_number);
    const bi = cnNum(b.collector_number);
    if (ai !== bi) return ai - bi;
    return String(a.collector_number || "").localeCompare(String(b.collector_number || ""));
  });
  for (const p of sorted) {
    const opt = document.createElement("option");
    opt.value = `${p.set}:${p.collector_number}`;
    const setLabel = (p.set || "?").toUpperCase();
    const setName = p.set_name ? ` — ${p.set_name}` : "";
    opt.textContent = `${setLabel} #${p.collector_number}${setName}`;
    els.addCardDraftPrinting.appendChild(opt);
  }
  els.addCardDraftPrinting.disabled = false;
  // Initial preview = "Édition par défaut" → falls back to the first
  // _draftPrintings entry (released-desc, so the most recent print).
  updateDraftPreview("");
}

/* Swap the preview <img> to the art of the chosen printing. Looks
 * up the card object in the locally-kept printings list (the same
 * list driving the <select>), so no re-fetch is needed. For the
 * empty "Édition par défaut" value we fall back to the first
 * (= most recent) printing — the user gets immediate visual
 * feedback even before they pick. */
function updateDraftPreview(printingValue) {
  let card = null;
  if (printingValue) {
    const sep = printingValue.indexOf(":");
    if (sep > 0) {
      const setCode = printingValue.slice(0, sep);
      const cn = printingValue.slice(sep + 1);
      card = _draftPrintings.find((p) => p.set === setCode && p.collector_number === cn);
    }
  } else {
    card = _draftPrintings[0] || null;
  }
  const src = card ? cardImage(card, "normal") : null;
  if (src) {
    els.addCardDraftPreview.src = src;
    els.addCardDraftPreview.alt = card.name
      ? `Aperçu de ${card.name} (${(card.set || "").toUpperCase()} #${card.collector_number})`
      : "Aperçu";
    els.addCardDraftPreview.hidden = false;
  } else {
    els.addCardDraftPreview.removeAttribute("src");
    els.addCardDraftPreview.alt = "";
    els.addCardDraftPreview.hidden = true;
  }
}

function cancelAddCardDraft() {
  _draftName = null;
  _draftPrintings = [];
  _draftPrintingsToken++;   // discard any in-flight printings fetch
  els.addCardDraft.hidden = true;
  els.addCardDraftPreview.removeAttribute("src");
  els.addCardDraftPreview.alt = "";
  els.addCardDraftPreview.hidden = true;
  els.addCardInput.focus();
}

function submitAddCardDraft() {
  if (!_draftName) return;
  const def = findDeck(state.currentDeckId);
  if (!def) {
    flash("Sélectionne un deck avant d'ajouter une carte.", "error");
    return;
  }
  /* The active role drives the routing. Non-commander decks never
   * surface the "Commandant" tab so this can only be "card" there. */
  const asCommander = def.format === "commander" && _getDraftRole() === "commander";
  const rawQty = parseInt(els.addCardDraftQty.value, 10);
  const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
  const entry = { name: _draftName };
  const printingValue = els.addCardDraftPrinting.value;
  if (printingValue) {
    const sep = printingValue.indexOf(":");
    if (sep > 0) {
      entry.set = printingValue.slice(0, sep);
      entry.collector_number = printingValue.slice(sep + 1);
    }
  }
  if (asCommander) {
    const added = addCommander(def, entry);
    if (!added) {
      flash(`${getDisplayName({ name: _draftName })} est déjà commandant.`, "error");
      return;
    }
  } else {
    addCard(def, { ...entry, qty });
  }
  if (commitDeckChange(def)) {
    const displayName = getDisplayName({ name: _draftName });
    markRecentlyAdded([_draftName]);
    cancelAddCardDraft();
    rerenderDeckViews();
    let msg;
    if (asCommander) msg = `${displayName} ajouté comme commandant`;
    else if (qty > 1) msg = `+${qty} ${displayName} ajoutés au deck`;
    else msg = `${displayName} ajouté au deck`;
    flash(msg, "success");
  }
}

/* Read the currently-active role from the segmented control. Falls
 * back to "card" if the toggle is hidden (non-commander decks) or
 * malformed. */
function _getDraftRole() {
  const active = els.addCardDraftRole?.querySelector("button.active");
  return active?.dataset.role === "commander" ? "commander" : "card";
}

/* Sync segmented-control visibility + Quantité field + submit label
 * with the current deck's format. Commander decks see the segmented
 * toggle; the rest only see "Ajouter au deck" with Quantité as the
 * sole knob. Called on draft open and on format change. */
function refreshAddCardDraftAsCommander() {
  if (!els.addCardDraftRole) return;
  const def = findDeck(state.currentDeckId);
  const isCommanderDeck = def?.format === "commander";
  els.addCardDraftRole.hidden = !isCommanderDeck;
  /* Always reset to "card" on (re)open so the previous draft's
   * choice doesn't carry over silently — commander mode is the
   * explicit minority case. */
  setAddCardDraftRole("card");
}

function setAddCardDraftRole(role) {
  if (!els.addCardDraftRole) return;
  const next = role === "commander" ? "commander" : "card";
  for (const btn of els.addCardDraftRole.querySelectorAll("button")) {
    const on = btn.dataset.role === next;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", String(on));
  }
  /* Commanders are unique — hide Quantité + force value to 1 so the
   * submit can't accidentally pick up a leftover quantity. */
  if (els.addCardDraftQtyLabel) els.addCardDraftQtyLabel.hidden = (next === "commander");
  if (next === "commander" && els.addCardDraftQty) els.addCardDraftQty.value = "1";
  if (els.addCardDraftSubmit) {
    els.addCardDraftSubmit.textContent = (next === "commander")
      ? "Ajouter comme commandant"
      : "Ajouter au deck";
  }
}

function onPasteAdd() {
  const def = findDeck(state.currentDeckId);
  if (!def) {
    flash("Sélectionne un deck avant d'ajouter des cartes.", "error");
    return;
  }
  const text = els.addCardPasteText.value;
  if (!text.trim()) {
    window.formValidate.flagInvalid(els.addCardPasteText);
    flash("Colle une liste avant d'ajouter.", "error");
    els.addCardPasteText.focus();
    return;
  }
  const parsed = parseDecklist(text);
  if (parsed.cards.length === 0 && parsed.commanders.length === 0) {
    window.formValidate.flagInvalid(els.addCardPasteText);
    flash("Aucune carte détectée dans le collage.", "error");
    els.addCardPasteText.focus();
    return;
  }
  for (const e of parsed.cards) addCard(def, e);
  for (const e of parsed.commanders) addCommander(def, e);
  if (commitDeckChange(def)) {
    els.addCardPasteText.value = "";
    markRecentlyAdded([...parsed.cards, ...parsed.commanders].map((c) => c.name));
    rerenderDeckViews();
    const n = parsed.cards.length + parsed.commanders.length;
    flash(`${pluralFr(n, "ligne")} ajoutée${n > 1 ? "s" : ""} au deck`, "success");
  }
}

/* Schedule the highlight class on every row whose name matches one
 * of `names`. Clearing the set is intentionally deferred until well
 * after the CSS fade completes — anything sooner would re-render
 * away the highlight before the user spots it. */
function markRecentlyAdded(names) {
  for (const n of names) state.recentlyAddedNames.add(n);
  setTimeout(() => {
    for (const n of names) state.recentlyAddedNames.delete(n);
  }, RECENTLY_ADDED_TTL_MS);
}

/* ============================================================
 * Deck summary header (commander art + name + meta + actions).
 *
 * Leans on the same resolved deck data the rest of the view
 * consumes — when state.resolved is null we render a minimal
 * placeholder so the page doesn't look broken on cold load.
 *
 * Side-panel renderers (`renderSideComposition`, `renderSideBracket`)
 * live in `js/app-manage-side.js` — split out when this file
 * crossed 1300 lines.
 * ============================================================ */

function renderDeckSummary(def) {
  const artEl = document.getElementById("manage-deck-art");
  const nameEl = document.getElementById("manage-deck-name");
  const formatEl = document.getElementById("manage-deck-format-label");
  const sizeEl = document.getElementById("manage-deck-size");
  const pipsEl = document.getElementById("manage-deck-pips");
  const archEl = document.getElementById("manage-deck-archetype");
  if (!artEl) return; // legacy markup, refonte not applied

  /* Tags row elements — kept hidden when there's nothing meaningful to
   * surface (no deck, no resolved data) so we don't paint empty pills. */
  const bracketEl = document.getElementById("manage-deck-bracket");
  const bracketNumEl = document.getElementById("manage-deck-bracket-num");
  const bracketLabelEl = document.getElementById("manage-deck-bracket-label");
  const countTagEl = document.getElementById("manage-deck-count-tag");
  const rlTagEl = document.getElementById("manage-deck-rl-tag");
  const rlCountEl = document.getElementById("manage-deck-rl-count");
  const syncTagEl = document.getElementById("manage-deck-sync-tag");
  const syncLabelEl = document.getElementById("manage-deck-sync-label");

  if (!def) {
    artEl.replaceChildren();
    nameEl.textContent = "—";
    refreshDeckDescription(null);
    formatEl.textContent = "—";
    sizeEl.textContent = "0";
    pipsEl.replaceChildren();
    archEl.textContent = "—";
    if (bracketEl) bracketEl.hidden = true;
    if (countTagEl) countTagEl.hidden = true;
    if (rlTagEl) rlTagEl.hidden = true;
    if (syncTagEl) syncTagEl.hidden = true;
    return;
  }
  /* Local alias for `state.resolved` (Scryfall-enriched commanders +
   * deck arrays). The deck-count reduce is also lifted out: the size
   * pill and the count tag both need it, no point computing twice. */
  const resolved = state.resolved;
  const cmdrCount = def.commanders?.length || 0;
  const deckCount = def.cards.reduce((s, c) => s + (c.qty || 0), 0);

  nameEl.textContent = def.name;
  refreshDeckDescription(def);
  formatEl.textContent = (def.format === "limited") ? "Format libre" : "Commander";
  sizeEl.textContent = String(cmdrCount + deckCount);

  /* Each section below is a thin call to a `_render*Tag` helper. The
   * tags row (count / bracket / RL / sync) deliberately degrades
   * piecewise: count works from `def` alone; the other three need
   * `resolved` and stay hidden until it's populated. */
  _renderCommanderArt(artEl, resolved);
  _renderCommanderPips(pipsEl, resolved);
  _renderArchetypeLabel(archEl, resolved);
  _renderCountTag(countTagEl, def, cmdrCount, deckCount);
  _renderBracketTag(bracketEl, bracketNumEl, bracketLabelEl, resolved);
  _renderRlTag(rlTagEl, rlCountEl, resolved);
  if (syncTagEl) refreshSyncTag(syncTagEl, syncLabelEl);
}

/* Commander art: prefer `art_crop` (Scryfall's illustration-only
 * crop — no card frame, name, or text box) for a clean "visual"
 * effect matching the mockup. Fall back to `normal` when art_crop
 * isn't on the cached object (older cache entries) or to the front
 * face for double-faced cards.
 *
 * Partner / partners-with decks: render ONE <img> per commander,
 * stacked vertically (CSS handles the equal split via flex). Sultai
 * (Ukkima + Cazur) is the canonical 2-commander case. */
function _renderCommanderArt(artEl, resolved) {
  artEl.replaceChildren();
  const commanders = (resolved && resolved.commanders) || [];
  const pickArt = (uris) => uris && (uris.art_crop || uris.normal);
  for (const cmdr of commanders) {
    const url = pickArt(cmdr.image_uris)
      || (cmdr.card_faces && cmdr.card_faces[0] && pickArt(cmdr.card_faces[0].image_uris));
    if (!url) continue;
    const img = document.createElement("img");
    img.src = url;
    img.alt = cmdr.name || "";
    img.loading = "lazy";
    artEl.appendChild(img);
  }
}

/* Color pips: union of commanders' color_identity, rendered in
 * canonical WUBRG order. */
function _renderCommanderPips(pipsEl, resolved) {
  pipsEl.replaceChildren();
  if (!resolved) return;
  const colors = new Set();
  for (const c of resolved.commanders) {
    if (Array.isArray(c.color_identity)) for (const cid of c.color_identity) colors.add(cid);
  }
  for (const c of ["W", "U", "B", "R", "G"]) {
    if (!colors.has(c)) continue;
    const p = document.createElement("span");
    p.className = `pip-dot dot-${c.toLowerCase()}`;
    p.setAttribute("aria-label", c);
    pipsEl.appendChild(p);
  }
}

/* Top archetype label, when one stands out (≥ 35 % confidence).
 * Falls back to "Profil mixte" otherwise. */
function _renderArchetypeLabel(archEl, resolved) {
  let archLabel = "Profil mixte";
  if (resolved && typeof detectArchetypes === "function") {
    const archs = detectArchetypes(resolved);
    const top = archs.find((a) => a.confidence >= 0.35) || archs[0];
    if (top) archLabel = top.label;
  }
  archEl.textContent = archLabel;
}

/* Count tag — works from def alone (no resolved needed). Shown
 * always, format depends on deck.format (commander vs limited). */
function _renderCountTag(countTagEl, def, cmdrCount, deckCount) {
  if (!countTagEl) return;
  const target = (def.format === "limited") ? 40 : 99;
  countTagEl.textContent = cmdrCount > 0
    ? `${deckCount} + ${cmdrCount} commandant${cmdrCount > 1 ? "s" : ""}`
    : `${deckCount} / ${target}`;
  countTagEl.hidden = false;
}

/* Bracket tag — needs resolved (Scryfall flags + analytics). Hidden
 * until bracketEstimate is available AND resolved data is in. */
function _renderBracketTag(bracketEl, bracketNumEl, bracketLabelEl, resolved) {
  if (!bracketEl) return;
  if (!resolved || typeof bracketEstimate !== "function") {
    bracketEl.hidden = true;
    return;
  }
  const allCards = [...resolved.commanders, ...resolved.deck];
  const b = bracketEstimate(allCards);
  bracketNumEl.textContent = String(b.minBracket);
  bracketLabelEl.textContent = b.label;
  bracketEl.hidden = false;
}

/* Reserved List tag — needs resolved (Scryfall's `reserved` flag).
 * Counts distinct printings: the user cares about how many lines
 * are RL, not the expanded total. Hidden when the count is 0. */
function _renderRlTag(rlTagEl, rlCountEl, resolved) {
  if (!rlTagEl) return;
  if (!resolved) {
    rlTagEl.hidden = true;
    return;
  }
  const rlCount = (resolved.deck || []).filter((c) => c && c.reserved === true).length
    + (resolved.commanders || []).filter((c) => c && c.reserved === true).length;
  if (rlCount > 0) {
    rlCountEl.textContent = String(rlCount);
    rlTagEl.hidden = false;
  } else {
    rlTagEl.hidden = true;
  }
}

/* Sync indicator state machine — negative-space design: the tag is
 * HIDDEN by default and surfaces only when there's something the
 * user can act on (or worry about). Two cases trigger it:
 *
 *   offline → "Hors-ligne" (grey dot). Immediate.
 *   queue non-empty for ≥ 3 s → "Sync en attente (N)" (amber dot).
 *
 * The 3 s grace period suppresses the brief flash that happens on
 * every normal save (queue grows then drains in < 1 s in test mode,
 * < 500 ms in prod). Without the grace the tag would blink amber
 * on every keystroke — noisy and not actionable.
 *
 * Module-level state tracks "when did the queue become non-empty?"
 * so we can compute elapsed time on each render. A setTimeout
 * re-triggers renderDeckSummary at the 3 s mark so the tag appears
 * even without further queue mutations. */
let syncPendingSinceTs = null;
let syncPendingTimer = null;
const SYNC_PENDING_GRACE_MS = 3000;

function refreshSyncTag(tag, label) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const user = window.sync?.currentUser?.();
  const queue = (user && window.syncQueue?.readQueue) ? window.syncQueue.readQueue(user.uid) : [];

  /* Reset visual classes — caller can decide which (if any) to add. */
  tag.classList.remove("is-pending", "is-offline");

  if (offline) {
    tag.classList.add("is-offline");
    label.textContent = "Hors-ligne";
    tag.hidden = false;
    return;
  }
  if (queue.length === 0) {
    /* Happy path: queue is empty → silence. Clear any pending grace
     * timer so a future enqueue starts a fresh window. */
    syncPendingSinceTs = null;
    if (syncPendingTimer) {
      clearTimeout(syncPendingTimer);
      syncPendingTimer = null;
    }
    tag.hidden = true;
    return;
  }
  /* Queue non-empty: figure out how long it's been so. */
  if (syncPendingSinceTs === null) syncPendingSinceTs = Date.now();
  const elapsed = Date.now() - syncPendingSinceTs;
  if (elapsed >= SYNC_PENDING_GRACE_MS) {
    tag.classList.add("is-pending");
    label.textContent = `Sync en attente (${queue.length})`;
    tag.hidden = false;
    return;
  }
  /* Within the grace period — stay silent. Schedule a re-check at
   * the exact moment the grace expires; if the queue drains before
   * then, the next renderDeckSummary will reset the timer. */
  tag.hidden = true;
  if (!syncPendingTimer) {
    syncPendingTimer = setTimeout(() => {
      syncPendingTimer = null;
      const def = findDeck(state.currentDeckId);
      if (def) renderDeckSummary(def);
    }, SYNC_PENDING_GRACE_MS - elapsed);
  }
}

/* renderSideComposition + renderSideBracket moved to js/app-manage-side.js */
