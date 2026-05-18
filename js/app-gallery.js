/* Gallery view — full-width visual layout of every card in the deck,
 * grouped by primary type. The sidebar disappears while this view is
 * active (see `.gallery-active` body class in switchView). One tile
 * per deck entry, with a qty badge when qty > 1. Clicking a tile
 * opens the shared preview modal at Scryfall's "normal" image size.
 *
 * Reads `state.resolved` and looks up the cached card-data for each
 * entry through cardCacheReader (same two-layer strategy as the
 * manage view, see renderManageView). Pre-rendered on every
 * rerenderDeckViews; the lazy <img loading="lazy"> means images
 * don't actually fetch until the user opens the Galerie tab.
 *
 * Toolbar (mirrors the claude.design view-gallery mockup): name
 * search + type chips + color chips, no sort chips. The mockup is
 * a flat grid; we keep the existing type-grouped panel layout and
 * just hide empty panels when filters narrow the deck — the user
 * explicitly asked to keep the type-grouped lecture. */

/* Module-local filter state. Ephemeral (not persisted), not on
 * `state` because nothing outside this file reads it. Reset whenever
 * the active deck changes — switching decks always lands on a clean
 * toolbar. `deckId` is the sentinel used to detect the deck switch. */
let galleryFilters = { deckId: null, search: "", type: "all", color: "all" };

/* Per-deck flag — set to the deck id once we've kicked off the FR
 * translation fetch for that deck. Lazy: fired the first time the
 * user actually types in the search box, NOT on render. Eager
 * pre-warming on render would side-effect the Manage view's FR
 * toggle UX (banner + per-card spinners rely on a cold cache when
 * the user first toggles FR). */
let _frFetchKickedDeckId = null;

/* Same `ctx` contract as renderManageView — reuse the shared def +
 * cacheReader from rerenderDeckViews when available, fall back to
 * fresh lookups otherwise. */
function renderGalleryView(ctx = null) {
  const def = ctx?.def || findDeck(state.currentDeckId);
  const isEmpty = !def || !state.resolved;
  els.viewGallery.classList.toggle("view-empty", isEmpty);
  if (isEmpty) return;

  /* Per-entry card-data lookup, identical contract to the manage view:
   *   1. card-cache hit by (set, cn) for entries with an explicit
   *      printing (so a freshly-picked edition is visible without
   *      waiting on a full re-resolve);
   *   2. fallback to a by-name map built from state.resolved. */
  const cacheReader = ctx?.cacheReader || cardCacheReader();
  const resolvedByName = new Map();
  for (const c of [...state.resolved.commanders, ...state.resolved.deck]) {
    if (c.name) {
      const k = c.name.toLowerCase();
      if (!resolvedByName.has(k)) resolvedByName.set(k, c);
    }
  }
  const cardFor = (entry) => {
    if (entry.set && entry.collector_number) {
      const cached = cacheReader.getByPrinting(entry.set, entry.collector_number);
      if (cached) return cached;
    }
    return resolvedByName.get(entry.name.toLowerCase()) || null;
  };

  /* Empty deck (def exists but no commanders + no cards): skip the
   * toolbar entirely and show the historical "Deck vide." placeholder.
   * Filters on a zero-card deck would be nonsensical. */
  if (def.commanders.length === 0 && def.cards.length === 0) {
    els.galleryToolbar.replaceChildren();
    els.galleryContent.replaceChildren(placeholderText("Deck vide."));
    return;
  }

  if (galleryFilters.deckId !== state.currentDeckId) {
    galleryFilters = {
      deckId: state.currentDeckId,
      search: "",
      type: "all",
      color: "all",
    };
  }

  /* Walk the deck once to figure out which type chips and color chips
   * are worth showing (no point offering "Sorcery" if the deck has
   * none). Multi = ≥ 2 colors; Inco = 0 colors. */
  const allEntries = [...def.commanders, ...def.cards];
  const typesPresent = new Set();
  const monoColorsPresent = new Set();
  let hasMulti = false;
  let hasColorless = false;
  let hasUnknown = false;
  for (const e of allEntries) {
    const card = cardFor(e);
    if (!card) { hasUnknown = true; continue; }
    const t = primaryTypeOf(card);
    if (t) typesPresent.add(t);
    const cols = Array.isArray(card.colors) ? card.colors : [];
    if (cols.length === 0) hasColorless = true;
    else if (cols.length === 1) monoColorsPresent.add(cols[0]);
    else hasMulti = true;
  }

  const orderedTypes = TYPE_ORDER.filter((t) => typesPresent.has(t));
  if (hasUnknown) orderedTypes.push("Inconnu");
  const orderedMonoColors = ["W", "U", "B", "R", "G"].filter((c) => monoColorsPresent.has(c));

  /* refs.counter is the live <strong> that applyFilters() updates on
   * every chip click / keystroke; refs.chips is the flat list of all
   * chip buttons keyed by (group, value) so we can flip .active
   * without rebuilding the toolbar (which would steal focus from the
   * search input). */
  const refs = buildToolbar({
    orderedTypes,
    orderedMonoColors,
    hasMulti,
    hasColorless,
    totalCount: countQty(def.commanders) + countQty(def.cards),
    onChange: applyFilters,
    onSearchInput: () => maybeKickGalleryFrFetch(def, cardFor, applyFilters),
  });

  function applyFilters() {
    const search = galleryFilters.search.trim().toLowerCase();
    const typeFilter = galleryFilters.type;
    const colorFilter = galleryFilters.color;
    /* FR translations come from the same cache the Manage view fills
     * on its EN/FR toggle (js/translations.js). The lookup is keyed
     * by the canonical Scryfall name, so we canonicalise via cardFor
     * before consulting the cache — same rule as renderManageView,
     * see project_translations_fr memory. */
    const translate = bulkTranslationLookup();

    const matches = (entry) => {
      const card = cardFor(entry);
      if (search) {
        const canonical = card?.name || entry.name;
        const enHit = canonical.toLowerCase().includes(search);
        const fr = translate(canonical);
        const frHit = fr ? fr.toLowerCase().includes(search) : false;
        if (!enHit && !frHit) return false;
      }
      if (typeFilter !== "all") {
        const t = card ? primaryTypeOf(card) : "Inconnu";
        if (t !== typeFilter) return false;
      }
      if (colorFilter !== "all") {
        const cols = card && Array.isArray(card.colors) ? card.colors : null;
        if (colorFilter === "colorless") {
          if (!cols || cols.length !== 0) return false;
        } else if (colorFilter === "multi") {
          if (!cols || cols.length < 2) return false;
        } else {
          if (!cols || cols.length !== 1 || cols[0] !== colorFilter) return false;
        }
      }
      return true;
    };

    const filteredCommanders = def.commanders.filter(matches);
    const filteredCards = def.cards.filter(matches);

    els.galleryContent.replaceChildren();

    if (filteredCommanders.length > 0) {
      els.galleryContent.appendChild(
        makeGalleryGroup("Commandants", filteredCommanders, cardFor),
      );
    }

    /* Bucket the filtered main-deck entries by primary type, same
     * comparator as before (colour band → CMC → name). TYPE_ORDER +
     * TYPE_LABELS_FR + colorSortKey come from app-manage.js. */
    const buckets = new Map(TYPE_ORDER.map((t) => [t, []]));
    const sortKeys = new Map();
    for (const e of filteredCards) {
      const card = cardFor(e);
      const t = card ? primaryTypeOf(card) : null;
      const key = t || "Inconnu";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(e);
      sortKeys.set(e, {
        color: colorSortKey(card),
        cmc: card && typeof card.cmc === "number" ? card.cmc : 99,
      });
    }
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
      els.galleryContent.appendChild(
        makeGalleryGroup(TYPE_LABELS_FR[type] || type, list, cardFor),
      );
    }

    if (els.galleryContent.children.length === 0) {
      els.galleryContent.appendChild(
        placeholderText("Aucune carte ne correspond aux filtres."),
      );
    }

    const filteredCount = countQty(filteredCommanders) + countQty(filteredCards);
    refs.counter.textContent = String(filteredCount);

    for (const chip of refs.chips) {
      const active = galleryFilters[chip.dataset.group] === chip.dataset.value;
      chip.classList.toggle("active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  applyFilters();
}

/* Kick the lazy FR fetch when the user first types in the search.
 * One-shot per deck; gated on a non-empty search so we don't spend
 * API calls when the user only clicks chips. Pre-warming on render
 * would clobber the Manage view's banner + per-card spinner UX,
 * which both depend on a cold cache at FR-toggle time. */
function maybeKickGalleryFrFetch(def, cardFor, onArrival) {
  if (galleryFilters.search === "") return;
  if (_frFetchKickedDeckId === state.currentDeckId) return;
  if (typeof fetchFrenchNames !== "function") return;
  _frFetchKickedDeckId = state.currentDeckId;
  const allNames = [];
  for (const e of [...def.commanders, ...def.cards]) {
    const card = cardFor(e);
    allNames.push(card?.name || e.name);
  }
  fetchFrenchNames(allNames, () => {
    if (galleryFilters.search) onArrival();
  });
}

function countQty(entries) {
  let n = 0;
  for (const e of entries) n += e.qty || 1;
  return n;
}

/* Build the toolbar DOM in place inside `els.galleryToolbar`. Returns
 * { counter, chips } — counter is the live <strong> updated on filter
 * change, chips is the flat list of every chip button so we can
 * toggle .active without rebuilding (and stealing focus from search). */
function buildToolbar({ orderedTypes, orderedMonoColors, hasMulti, hasColorless, totalCount, onChange, onSearchInput }) {
  els.galleryToolbar.replaceChildren();
  const chips = [];

  const searchWrap = document.createElement("div");
  searchWrap.className = "gallery-toolbar-search";
  const icon = document.createElement("span");
  icon.className = "gallery-toolbar-search-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Recherche par nom…";
  input.value = galleryFilters.search;
  input.setAttribute("aria-label", "Recherche par nom");
  input.addEventListener("input", () => {
    galleryFilters.search = input.value;
    onChange();
    if (typeof onSearchInput === "function") onSearchInput();
  });
  /* Inline clear button — shown only when the input has content
   * (CSS via `:placeholder-shown + .clear`). Tap-friendly on mobile
   * and a faster wipe than triple-tap-and-delete on desktop. */
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "gallery-toolbar-search-clear";
  clear.setAttribute("aria-label", "Effacer la recherche");
  clear.appendChild(makeXIcon(12));
  clear.addEventListener("click", () => {
    input.value = "";
    galleryFilters.search = "";
    onChange();
    input.focus();
  });
  searchWrap.append(icon, input, clear);
  els.galleryToolbar.appendChild(searchWrap);

  const typeGroup = makeChipGroup("Filtrer par type");
  typeGroup.appendChild(makeChip(chips, "type", "all", "Tous types", onChange));
  for (const t of orderedTypes) {
    typeGroup.appendChild(makeChip(chips, "type", t, TYPE_LABELS_FR[t] || t, onChange));
  }
  els.galleryToolbar.appendChild(typeGroup);

  const colorGroup = makeChipGroup("Filtrer par couleur");
  colorGroup.appendChild(makeChip(chips, "color", "all", "Toutes", onChange));
  for (const c of orderedMonoColors) {
    /* Mono : label texte (W/U/B/R/G) + pip dot. Le label est wrappé
     * par makeChip dans `.gallery-chip-text` pour pouvoir être caché
     * sur mobile (le CSS @media bascule en pip-only ; aria-label +
     * title gardent l'a11y intacte). */
    const chip = makeChip(chips, "color", c, c, onChange);
    chip.classList.add("gallery-chip-mono");
    const name = COLOR_NAMES[c] || c;
    chip.setAttribute("aria-label", name);
    chip.title = name;
    const dot = document.createElement("span");
    dot.className = `pip-dot dot-${c.toLowerCase()}`;
    chip.prepend(dot);
    colorGroup.appendChild(chip);
  }
  if (hasMulti) colorGroup.appendChild(makeChip(chips, "color", "multi", "Multi", onChange));
  if (hasColorless) colorGroup.appendChild(makeChip(chips, "color", "colorless", "Inco.", onChange));
  els.galleryToolbar.appendChild(colorGroup);

  const counterWrap = document.createElement("span");
  counterWrap.className = "gallery-toolbar-count";
  const counter = document.createElement("strong");
  counter.className = "num";
  counter.textContent = String(totalCount);
  counterWrap.append(counter, ` / ${totalCount} cartes`);
  els.galleryToolbar.appendChild(counterWrap);

  /* Sliding pill on hover, same mechanic as the top nav. Wired
   * after both chip groups are populated and attached so the
   * initial getBoundingClientRect inside setupSlidingIndicator
   * sees real layout. The ResizeObserver inside also handles the
   * gallery-was-hidden case (becomes visible → groups gain a box
   * → indicator repositions to the active chip). */
  const indicatorOpts = { itemSelector: ".gallery-chip", indicatorClass: "chip-indicator" };
  setupSlidingIndicator(typeGroup, indicatorOpts);
  setupSlidingIndicator(colorGroup, indicatorOpts);

  return { counter, chips };
}

function makeChipGroup(ariaLabel) {
  const group = document.createElement("div");
  group.className = "gallery-toolbar-chips";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", ariaLabel);
  return group;
}

function makeChip(chips, group, value, label, onChange) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gallery-chip";
  btn.dataset.group = group;
  btn.dataset.value = value;
  /* Label wrappé pour que le @media mobile puisse cacher le texte
   * sur les chips mono (cf. .gallery-chip-mono) sans bouger le pip. */
  const text = document.createElement("span");
  text.className = "gallery-chip-text";
  text.textContent = label;
  btn.appendChild(text);
  btn.addEventListener("click", () => {
    galleryFilters[group] = value;
    onChange();
  });
  chips.push(btn);
  return btn;
}

function makeGalleryGroup(label, entries, cardFor) {
  const section = document.createElement("section");
  section.className = "panel gallery-group";

  const head = document.createElement("div");
  head.className = "panel-head";
  const title = document.createElement("h3");
  title.textContent = label;
  head.appendChild(title);
  const total = entries.reduce((n, e) => n + (e.qty || 1), 0);
  const meta = document.createElement("span");
  meta.className = "panel-meta";
  meta.textContent = `${total} carte${total > 1 ? "s" : ""}`;
  head.appendChild(meta);
  section.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "gallery-grid";
  for (const entry of entries) {
    grid.appendChild(makeGalleryTile(entry, cardFor(entry)));
  }
  section.appendChild(grid);
  return section;
}

function makeGalleryTile(entry, card) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "gallery-tile";
  tile.title = entry.name;
  tile.setAttribute("aria-label", `Agrandir ${entry.name}`);

  const src = card ? cardImage(card, "normal") : null;
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = entry.name;
    img.loading = "lazy";
    img.decoding = "async";
    tile.appendChild(img);
    tile.addEventListener("click", () => showModal(card, []));
  } else {
    /* Unresolved card (typo on import, Scryfall couldn't find it).
     * Same shared skeleton fill as the play view + manage rows so the
     * gallery tile reads the same as those surfaces. */
    appendSkeletonFill(tile, entry.name);
    tile.disabled = true;
  }

  if (card && card.game_changer === true) {
    const gc = document.createElement("span");
    gc.className = "gc-mark";
    gc.textContent = "GC";
    gc.title = "Game Changer";
    gc.setAttribute("aria-label", "Game Changer");
    tile.appendChild(gc);
  }

  const qty = entry.qty || 1;
  if (qty > 1) {
    const badge = document.createElement("span");
    badge.className = "gallery-tile-qty";
    badge.textContent = `×${qty}`;
    badge.setAttribute("aria-hidden", "true");
    tile.appendChild(badge);
  }

  return tile;
}
