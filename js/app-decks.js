/* "Mes decks" view — every deck as a tile: commander art, name, colours,
 * bracket, archetype + themes, and a conformity warning only when the
 * deck breaks a Commander rule. Rendered on entry (not pre-rendered: it
 * spans every deck, not the active one). Click a tile → open it in Gérer. */

/* Identifiers already sent to Scryfall from this view, so an unknown
 * card or a failed fetch doesn't re-request on every render. */
const _decksViewFetched = new Set();

function renderDecksView() {
  if (!els.viewDecks) return;
  const decks = loadUserDecks();
  els.viewDecks.classList.toggle("view-empty", decks.length === 0);
  els.decksGrid.replaceChildren();
  els.decksCount.textContent = decks.length ? pluralFr(decks.length, "deck") : "";
  if (decks.length === 0) return;

  const { resolvedById, missing } = _resolveDecksFromCache(decks);
  const colorsById = new Map([...resolvedById].map(([id, r]) => [id, colorIdentityOf(r.commanders)]));
  for (const def of sortDecksByColors(decks, colorsById)) {
    els.decksGrid.appendChild(_buildDeckTile(def, resolvedById.get(def.id) || null));
  }
  if (missing.length > 0) _fetchDecksViewCards(missing);
}

/* One cache read for every deck not already resolved (state.deckCache
 * holds the ones the app has opened). A card not yet asked of Scryfall
 * holds its deck back for a fetch; one already asked (unknown, failed
 * fetch) becomes a placeholder so the tile never stays a skeleton. */
function _resolveDecksFromCache(decks) {
  const resolvedById = new Map();
  const pending = [];
  for (const def of decks) {
    const cached = state.deckCache.get(def.id);
    if (cached) resolvedById.set(def.id, cached);
    else pending.push(def);
  }
  const missing = [];
  if (pending.length === 0) return { resolvedById, missing };

  const { found } = lookupMany(pending.flatMap(_identifiersOf));
  const byKey = new Map();
  const byName = new Map();
  _populateMaps(found, byKey, byName);
  for (const def of pending) {
    const uncached = _identifiersOf(def).filter((id) => !resolveEntry(id, byKey, byName));
    const toFetch = uncached.filter((id) => !_decksViewFetched.has(identifierKey(id)));
    if (toFetch.length > 0) {
      missing.push(...toFetch);
      continue;
    }
    const resolved = _buildResolved(def, byKey, byName, []);
    if (uncached.length === 0) state.deckCache.set(def.id, resolved);
    resolvedById.set(def.id, resolved);
  }
  return { resolvedById, missing };
}

async function _fetchDecksViewCards(missing) {
  const fresh = [...new Map(missing.map((id) => [identifierKey(id), id])).entries()]
    .filter(([key]) => !_decksViewFetched.has(key));
  if (fresh.length === 0) return;
  for (const [key] of fresh) _decksViewFetched.add(key);
  try {
    const { byKey } = await fetchScryfallCards(fresh.map(([, id]) => id));
    cacheCards([...byKey.values()]);
  } catch (err) {
    console.warn("Mes decks: card fetch failed", err);
  }
  if (!els.viewDecks.hidden) renderDecksView();
}

function _buildDeckTile(def, resolved) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "deck-tile";
  tile.dataset.deckId = def.id;
  tile.addEventListener("click", () => openDeckFromDecksView(def.id));

  const art = document.createElement("div");
  art.className = "deck-tile-art";
  // Partners side by side: each art is cropped to half the width.
  for (const cmdr of resolved?.commanders ?? []) {
    const src = cardImage(cmdr, "art_crop");
    if (!src) continue;
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    art.appendChild(img);
  }
  tile.appendChild(art);

  const body = document.createElement("div");
  body.className = "deck-tile-body";

  const head = document.createElement("div");
  head.className = "deck-tile-head";
  const pips = document.createElement("span");
  pips.className = "color-pips";
  pips.setAttribute("aria-hidden", "true");
  renderColorPips(pips, resolved ? colorIdentityOf(resolved.commanders) : []);
  const name = document.createElement("strong");
  name.className = "deck-tile-name";
  name.textContent = def.name;
  head.append(pips, name);
  body.appendChild(head);

  if (!resolved) {
    const skeleton = makeSkeletonBlock();
    skeleton.classList.add("deck-tile-skeleton");
    body.appendChild(skeleton);
    tile.appendChild(body);
    return tile;
  }

  const deck = [...resolved.commanders, ...resolved.deck];
  if (def.format !== "limited") {
    const b = bracketEstimate(deck);
    const bracket = document.createElement("div");
    bracket.className = "deck-tile-bracket";
    bracket.textContent = `Bracket ${b.minBracket} · ${b.label}`;
    body.appendChild(bracket);
  }

  const tags = [];
  const arch = detectArchetypes(resolved)[0];
  if (arch) tags.push(arch.label);
  for (const t of detectThemes(deck).slice(0, 3)) tags.push(t.label);
  if (tags.length > 0) {
    const list = document.createElement("div");
    list.className = "deck-tile-tags";
    for (const label of tags) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = label;
      list.appendChild(tag);
    }
    body.appendChild(list);
  }

  if (def.format !== "limited") {
    const failing = commanderRuleChecks(resolved).filter((r) => r.severity !== "ok");
    if (failing.length > 0) {
      const alert = document.createElement("div");
      alert.className = "deck-tile-alert";
      alert.classList.toggle("is-error", failing.some((r) => r.severity === "error"));
      alert.textContent = `⚠ Non conforme : ${failing.map((r) => r.label).join(", ")}`;
      body.appendChild(alert);
    }
  }

  tile.appendChild(body);
  return tile;
}

function openDeckFromDecksView(deckId) {
  if (els.deckSelect.value !== deckId) {
    els.deckSelect.value = deckId;
    els.deckSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  switchView("manage");
}
