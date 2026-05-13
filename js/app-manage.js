/* Manage view — deck editor: card rows grouped by type, qty controls,
 * printing picker, remove buttons, format selector, EN/FR card-name
 * toggle, add-card UI (autocomplete + paste-add).
 *
 * Reads `state`, `els` and shared helpers (`placeholderText`,
 * `makeCardEl`, `makeTrashIcon`, `showModal`, `closeModal`,
 * `commitDeckChange`, `rerenderDeckViews`, `setStatus`, `findDeck`).
 * Load order: after app-play.js (for placeholderText / makeTrashIcon),
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
  rerenderDeckViews();
}

/* Build a manage-view card row. Resolved Scryfall data is optional —
 * we render with the card name even if Scryfall hasn't been hit yet
 * (e.g. before the first switch to the play view). */
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
  }
  if (resolvedCard) {
    thumb.title = `Agrandir ${entry.name}`;
    thumb.setAttribute("aria-label", `Agrandir ${entry.name}`);
    thumb.addEventListener("click", () => showModal(resolvedCard, []));
  } else {
    // Card hasn't been resolved by Scryfall yet (or not at all). The
    // button stays in the tab order for consistency but does nothing.
    thumb.disabled = true;
    thumb.setAttribute("aria-label", `Image indisponible pour ${entry.name}`);
  }
  row.appendChild(thumb);

  const name = document.createElement("div");
  name.className = "card-row-name";
  // Accept a per-render displayName closure (bulk-translation-aware)
  // so a 100-card render doesn't read localStorage 100 times.
  name.textContent = opts.displayName ? opts.displayName(entry) : getDisplayName(entry);
  if (state.manageLang === "fr" && pendingTranslations.has(entry.name)) {
    row.classList.add("is-translating");
    const spinner = document.createElement("span");
    spinner.className = "card-row-spinner";
    spinner.setAttribute("aria-hidden", "true");
    name.appendChild(spinner);
  }
  row.appendChild(name);

  const printing = document.createElement("button");
  printing.type = "button";
  printing.className = "card-row-printing";
  printing.textContent = entry.set
    ? `${entry.set.toUpperCase()} #${entry.collector_number || "?"}`
    : "édition par défaut";
  printing.title = "Changer l'édition";
  printing.addEventListener("click", () => openPrintingPicker(entry, opts.kind));
  row.appendChild(printing);

  if (opts.kind === "card") {
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
    row.appendChild(qty);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "card-row-remove ghost icon-only";
  remove.title = "Retirer du deck";
  remove.setAttribute("aria-label", `Retirer ${entry.name} du deck`);
  remove.appendChild(makeTrashIcon(14));
  remove.addEventListener("click", () => onRemoveEntry(entry, opts.kind));
  row.appendChild(remove);

  return row;
}

/* `ctx` is optional but supplied by rerenderDeckViews — when it's
 * present we reuse its already-built `def` and `cacheReader` to avoid
 * re-parsing localStorage. Standalone calls (deck switches, language
 * toggles) fall through to fresh lookups. */
function renderManageView(ctx = null) {
  const def = ctx?.def || findDeck(state.currentDeckId);
  if (!def) {
    els.manageDeckName.textContent = "—";
    els.manageMeta.textContent = "Aucun deck sélectionné.";
    els.manageCommanders.replaceChildren(placeholderText("—"));
    els.manageCards.replaceChildren(placeholderText("—"));
    els.manageCardsCount.textContent = "";
    return;
  }
  els.manageDeckName.textContent = def.name;
  const totalCards = def.cards.reduce((n, c) => n + c.qty, 0);
  els.manageMeta.textContent =
    `${pluralFr(def.commanders.length, "commandant")} · ${totalCards} cartes principales`;
  els.manageCardsCount.textContent = `${pluralFr(def.cards.length, "ligne")} (${totalCards} au total)`;
  // Format selector: explicit field on the deck, fallback to commander
  // for legacy decks saved before the field existed.
  els.formatSelect.value = def.format || "commander";

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
    if (translate) {
      const fr = translate(entry.name);
      if (fr) return fr;
    }
    /* Prefer the canonical Scryfall name when we have it — so a
     * paste-add of "1 sol ring" displays as "Sol Ring" instead of
     * the user's lowercase typing. Fallback to the entry's raw name
     * while the async resolve is still in flight. */
    const resolved = resolveForEntry(entry);
    return (resolved && resolved.name) || entry.name;
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

/* Group the deck entries by primary type (Land / Creature / …),
 * sort each group by CMC then name, and render with a typed header.
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

function appendCardGroupsByType(entries, thumbFor, displayName) {
  // Build per-type buckets in the canonical display order.
  const buckets = new Map(TYPE_ORDER.map((t) => [t, []]));
  for (const e of entries) {
    const card = thumbFor(e);
    const t = card ? primaryTypeOf(card) : null;
    const key = t || "Inconnu";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }

  // Sort within each bucket: CMC ascending, then name (locale).
  const cmcOf = (entry) => {
    const c = thumbFor(entry);
    return c && typeof c.cmc === "number" ? c.cmc : 99;
  };
  for (const list of buckets.values()) {
    list.sort((a, b) => (cmcOf(a) - cmcOf(b)) || a.name.localeCompare(b.name));
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

  const title = document.createElement("h3");
  title.className = "printing-picker-title";
  // Show the FR name when the manage view is in FR mode — getDisplayName
  // falls back to English if no translation is cached.
  title.textContent = `Choisir l'édition de ${getDisplayName(entry)}`;
  picker.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "printing-grid";
  grid.appendChild(placeholderText("Chargement des éditions…"));
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
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "printing-tile";
    tile.title = `${p.set_name || p.set?.toUpperCase()} · #${p.collector_number}`;
    // Use "normal" (488×680) instead of "small" — at our 170-200px
    // tile width the small version visibly blurs.
    const src = cardImage(p, "normal");
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = `${p.name} (${p.set?.toUpperCase()} #${p.collector_number})`;
      img.loading = "lazy";
      tile.appendChild(img);
    }
    const cap = document.createElement("span");
    cap.className = "printing-tile-cap";
    cap.textContent = `${(p.set || "?").toUpperCase()} · #${p.collector_number}`;
    tile.appendChild(cap);
    tile.addEventListener("click", () => {
      applyPrintingChange(entry, kind, p.set, p.collector_number);
      closeModal();
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
  const rawQty = parseInt(els.addCardDraftQty.value, 10);
  const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
  const entry = { name: _draftName, qty };
  const printingValue = els.addCardDraftPrinting.value;
  if (printingValue) {
    const sep = printingValue.indexOf(":");
    if (sep > 0) {
      entry.set = printingValue.slice(0, sep);
      entry.collector_number = printingValue.slice(sep + 1);
    }
  }
  addCard(def, entry);
  if (commitDeckChange(def)) {
    const displayName = getDisplayName({ name: _draftName });
    markRecentlyAdded([_draftName]);
    cancelAddCardDraft();
    rerenderDeckViews();
    flash(qty > 1
      ? `+${qty} ${displayName} ajoutés au deck`
      : `${displayName} ajouté au deck`, "success");
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
