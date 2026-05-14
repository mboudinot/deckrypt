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
 * don't actually fetch until the user opens the Galerie tab. */

/* Same `ctx` contract as renderManageView — reuse the shared def +
 * cacheReader from rerenderDeckViews when available, fall back to
 * fresh lookups otherwise. */
function renderGalleryView(ctx = null) {
  const def = ctx?.def || findDeck(state.currentDeckId);
  if (!def || !state.resolved) {
    els.galleryContent.replaceChildren(placeholderText("Aucun deck à afficher."));
    return;
  }

  /* Per-entry card-data lookup, identical contract to the manage view:
   *   1. card-cache hit by (set, cn) for entries with an explicit
   *      printing (so a freshly-picked edition is visible without
   *      waiting on a full re-resolve);
   *   2. fallback to a by-name map built from state.resolved. */
  const cacheReader = ctx?.cacheReader || cardCacheReader();
  /* Lower-case keys so a paste-add of "1 sol ring" still resolves
   * to Scryfall's canonical "Sol Ring" — see the matching comment
   * in app-manage.js for the full rationale. */
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

  els.galleryContent.replaceChildren();

  if (def.commanders.length > 0) {
    els.galleryContent.appendChild(
      makeGalleryGroup("Commandants", def.commanders, cardFor),
    );
  }

  /* Bucket the main-deck entries by primary type AND cache each
   * entry's CMC so the comparator below doesn't re-call `cardFor`
   * O(N log N) times. Same TYPE_ORDER + TYPE_LABELS_FR the manage
   * view uses — globals from app-manage.js. */
  const buckets = new Map(TYPE_ORDER.map((t) => [t, []]));
  const cmcs = new Map();
  for (const e of def.cards) {
    const card = cardFor(e);
    const t = card ? primaryTypeOf(card) : null;
    const key = t || "Inconnu";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
    cmcs.set(e, card && typeof card.cmc === "number" ? card.cmc : 99);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => (cmcs.get(a) - cmcs.get(b)) || a.name.localeCompare(b.name));
  }

  for (const [type, list] of buckets) {
    if (list.length === 0) continue;
    els.galleryContent.appendChild(
      makeGalleryGroup(TYPE_LABELS_FR[type] || type, list, cardFor),
    );
  }

  if (els.galleryContent.children.length === 0) {
    els.galleryContent.appendChild(placeholderText("Deck vide."));
  }
}

function makeGalleryGroup(label, entries, cardFor) {
  const section = document.createElement("section");
  section.className = "gallery-group";

  const title = document.createElement("h3");
  title.className = "gallery-group-title";
  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;
  title.appendChild(labelSpan);
  const count = document.createElement("strong");
  count.className = "gallery-group-count";
  count.textContent = entries.reduce((n, e) => n + (e.qty || 1), 0);
  title.appendChild(count);
  section.appendChild(title);

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
    const placeholder = document.createElement("span");
    placeholder.className = "gallery-tile-placeholder";
    placeholder.textContent = entry.name;
    tile.appendChild(placeholder);
    tile.disabled = true;
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
