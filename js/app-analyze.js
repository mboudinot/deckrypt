/* Analyze view — bracket, composition, legality, archetypes,
 * suggestions, themes, mana curve, type breakdown, mana sources,
 * mana base, subtypes, tokens.
 *
 * Reads `state.resolved` (declared in app.js) and the `els.analyze*`
 * DOM nodes (populated by cacheElements). Calls shared helpers from
 * app-play.js (placeholderText, makeCardEl) and app.js (showModal).
 * Load order: after deck-analytics/deck-archetypes/deck-suggestions/
 * deck-mana-base/scryfall/util, after app-play.js, before app.js. */

/* The 8 colours used in the type-breakdown stacked bar. Mapped to the
 * primary types declared in deck-analytics. Tuned for legibility on the
 * dark theme — close to what the rest of the UI uses for the WUBRG pips
 * but distinct enough that no two adjacent slices read the same. */
const TYPE_COLORS = {
  Creature:     "#6ee7b7",  // green-ish
  Artifact:     "#9aa6b2",  // grey
  Enchantment:  "#f5e9c0",  // off-white
  Instant:      "#4ea8de",  // blue
  Sorcery:      "#ff8a73",  // red-ish
  Land:         "#a78bfa",  // purple (kept distinct from blue)
  Planeswalker: "#fbbf24",  // amber
  Battle:       "#ec4899",  // pink
};

/* Note: TYPE_LABELS_FR is defined in app-manage.js and shared across
 * classic scripts via the top-level script scope — we reuse it here
 * (same translation as the manage and gallery views). */

/* French labels for the most common MTG creature subtypes. Unknown
 * subtypes fall back to the original English (Scryfall's raw value) —
 * better partial coverage than no translation, and the user can extend
 * this map as new tribal commanders show up. */
const SUBTYPE_LABELS_FR = {
  Advisor: "Conseiller", Angel: "Ange", Archer: "Archer", Archon: "Archonte",
  Artificer: "Artificier", Assassin: "Assassin", Avatar: "Avatar", Barbarian: "Barbare",
  Bear: "Ours", Beast: "Bête", Berserker: "Berserker", Bird: "Oiseau",
  Boar: "Sanglier", Brushwagg: "Brushwagg", Cat: "Chat", Centaur: "Centaure",
  Cephalid: "Céphalide", Chimera: "Chimère", Citizen: "Citoyen", Cleric: "Clerc",
  Construct: "Construction", Crocodile: "Crocodile", Cyclops: "Cyclope",
  Demigod: "Demi-Dieu", Demon: "Démon", Devil: "Diable", Dinosaur: "Dinosaure",
  Djinn: "Djinn", Dog: "Chien", Dragon: "Dragon", Drake: "Drake",
  Dryad: "Dryade", Dwarf: "Nain", Efreet: "Éfrit", Elder: "Ancien",
  Eldrazi: "Eldrazi", Elemental: "Élémental", Elephant: "Éléphant", Elf: "Elfe",
  Faerie: "Fée", Fish: "Poisson", Fox: "Renard", Frog: "Grenouille",
  Fungus: "Champignon", Gargoyle: "Gargouille", Giant: "Géant", Gnome: "Gnome",
  Goat: "Chèvre", Goblin: "Gobelin", God: "Dieu", Golem: "Golem",
  Gorgon: "Gorgone", Griffin: "Griffon", Hag: "Sorcière", Halfling: "Halfelin",
  Harpy: "Harpie", Hippogriff: "Hippogriffe", Horror: "Horreur", Horse: "Cheval",
  Human: "Humain", Hydra: "Hydre", Hyena: "Hyène", Illusion: "Illusion",
  Imp: "Diablotin", Incarnation: "Incarnation", Insect: "Insecte", Jellyfish: "Méduse",
  Knight: "Chevalier", Kor: "Kor", Kraken: "Kraken", Lhurgoyf: "Lhurgoyf",
  Lich: "Liche", Lizard: "Lézard", Manticore: "Manticore", Mercenary: "Mercenaire",
  Merfolk: "Ondin", Minotaur: "Minotaure", Monk: "Moine", Monkey: "Singe",
  Moonfolk: "Lunarien", Mutant: "Mutant", Myr: "Myr", Naga: "Naga",
  Nightmare: "Cauchemar", Ninja: "Ninja", Noble: "Noble", Nymph: "Nymphe",
  Octopus: "Pieuvre", Ogre: "Ogre", Ooze: "Substance", Orc: "Orque",
  Otter: "Loutre", Ox: "Bœuf", Pegasus: "Pégase", Phoenix: "Phénix",
  Phyrexian: "Phyrexian", Pirate: "Pirate", Praetor: "Préteur", Rabbit: "Lapin",
  Rat: "Rat", Reflection: "Reflet", Rhino: "Rhinocéros", Rogue: "Voleur",
  Sable: "Zibeline", Salamander: "Salamandre", Samurai: "Samouraï", Sasquatch: "Sasquatch",
  Satyr: "Satyre", Scout: "Éclaireur", Serpent: "Serpent", Shade: "Ombre",
  Shaman: "Chamane", Shapeshifter: "Métamorphe", Sheep: "Mouton", Siren: "Sirène",
  Skeleton: "Squelette", Slith: "Slith", Sliver: "Slivoïde", Slug: "Limace",
  Snake: "Serpent", Soldier: "Soldat", Soltari: "Soltari", Specter: "Spectre",
  Spellshaper: "Façonneur de sorts", Sphinx: "Sphinx", Spider: "Araignée",
  Spike: "Pointe", Spirit: "Esprit", Squid: "Calmar", Squirrel: "Écureuil",
  Surrakar: "Surrakar", Survivor: "Survivant", Tetravite: "Tétravite", Thopter: "Thoptère",
  Thrull: "Thrull", Treefolk: "Sylvin", Troll: "Troll", Turtle: "Tortue",
  Unicorn: "Licorne", Vampire: "Vampire", Vedalken: "Védalken", Viashino: "Viashino",
  Volver: "Volver", Wall: "Mur", Warlock: "Sorcier", Warrior: "Guerrier",
  Werewolf: "Loup-garou", Whale: "Baleine", Wizard: "Magicien", Wolf: "Loup",
  Wolverine: "Carcajou", Wombat: "Wombat", Worm: "Ver", Wraith: "Apparition",
  Wurm: "Guivre", Yeti: "Yéti", Zombie: "Zombie",
  Autres: "Autres",
};

const labelForSubtype = (s) => SUBTYPE_LABELS_FR[s] || s;

function renderAnalyzeView() {
  const resolved = state.resolved;
  if (!resolved || (resolved.commanders.length === 0 && resolved.deck.length === 0)) {
    [els.analyzeBracket, els.analyzeCurve, els.analyzeTypes,
     els.analyzeSubtypes, els.analyzeTokens,
     els.analyzeSuggestions, els.analyzeThemes, els.analyzeLegality,
     els.analyzeArchetypes, els.analyzeManaBase]
      .forEach((el) => el.replaceChildren(placeholderText("Aucun deck à analyser.")));
    els.analyzeComposition.replaceChildren();
    [els.analyzeCurveInfo, els.analyzeTypesInfo, els.analyzeSubtypesInfo,
     els.analyzeTokensInfo, els.analyzeSuggestionsInfo, els.analyzeThemesInfo,
     els.analyzeArchetypesInfo, els.analyzeManaBaseInfo]
      .forEach((el) => { el.textContent = ""; });
    return;
  }
  // The deck for analysis = main cards + commanders. Commanders count
  // toward CMC curve, type breakdown, and bracket evaluation.
  const fullDeck = [...resolved.commanders, ...resolved.deck];

  renderBracket(fullDeck);
  renderCompositionPanel(resolved);
  renderLegalityPanel(resolved);
  renderArchetypesPanel(resolved);
  renderSuggestionsPanel(resolved);
  renderThemesPanel(fullDeck);
  renderManaCurveChart(fullDeck);
  renderTypeChart(fullDeck);
  renderManaBasePanel(fullDeck);
  renderSubtypesPanel(fullDeck);
  renderTokensPanel(fullDeck);
}

function renderManaBasePanel(deck) {
  const manaBase = analyzeManaBase(deck);
  els.analyzeManaBase.replaceChildren();

  els.analyzeManaBaseInfo.textContent = manaBase.lands === 0
    ? "—"
    : `${pluralFr(manaBase.lands, "terrain")}`;

  if (manaBase.lands === 0) {
    els.analyzeManaBase.appendChild(placeholderText("Aucun terrain dans le deck."));
    return;
  }

  // Top row: aggregate counters. Four categories of "special" lands,
  // each with a one-glance count.
  const counters = document.createElement("div");
  counters.className = "mana-base-counters";
  for (const [label, count, tooltip] of [
    ["Multicolores", manaBase.multicolor, "Terrains produisant 2 couleurs ou plus"],
    ["Fetch / tutors", manaBase.fetches, "Terrains qui cherchent un autre terrain en bibliothèque"],
    ["Slow lands", manaBase.slow, "Terrains qui arrivent engagés sans condition d'untap"],
    ["Utilitaires", manaBase.utility, "Terrains avec une capacité au-delà de produire du mana"],
  ]) {
    const tile = document.createElement("div");
    tile.className = "mana-base-counter";
    tile.title = tooltip;
    const num = document.createElement("strong");
    num.textContent = count;
    const lab = document.createElement("span");
    lab.textContent = label;
    tile.append(num, lab);
    counters.appendChild(tile);
  }
  els.analyzeManaBase.appendChild(counters);

  // Per-colour fixing rows: ratio bar + sources / symbols counter.
  if (manaBase.perColor.length === 0) {
    const note = document.createElement("div");
    note.className = "mana-base-note";
    note.textContent = "Aucun coût coloré détecté.";
    els.analyzeManaBase.appendChild(note);
    return;
  }
  const list = document.createElement("div");
  list.className = "mana-base-rows";
  for (const row of manaBase.perColor) {
    const r = document.createElement("div");
    r.className = `mana-base-row mana-base-${row.status}`;
    // Hover tooltip names the spell that drives the threshold —
    // gives the user something actionable when status is "low".
    if (row.dominant) {
      const pipsLabel = row.color.repeat(row.dominant.pips);
      r.title = `Sort le plus exigeant en ${row.color} : ${row.dominant.name} (${pipsLabel} à CMC ${row.dominant.cmc}) → ${row.needed} sources visées.`;
    } else if (row.status === "info") {
      r.title = `${row.sources} source${row.sources > 1 ? "s" : ""} ${row.color} sans sort de cette couleur.`;
    }

    const dot = document.createElement("span");
    dot.className = `pip-dot dot-${row.color.toLowerCase()}`;
    r.appendChild(dot);

    const bar = document.createElement("div");
    bar.className = "mana-base-bar";
    const fill = document.createElement("div");
    fill.className = `mana-base-bar-fill f-${row.color.toLowerCase()}`;
    // Cap the visual at 100 % — over-sourced isn't a failure mode.
    const ratio = row.needed > 0 ? Math.min(100, (row.sources / row.needed) * 100) : 100;
    fill.style.width = `${Math.round(ratio)}%`;
    bar.appendChild(fill);
    r.appendChild(bar);

    const meta = document.createElement("div");
    meta.className = "mana-base-meta";
    const num = document.createElement("strong");
    num.textContent = row.sources;
    const sep = document.createElement("span");
    sep.className = "mana-base-sep";
    if (row.needed > 0) {
      sep.textContent = ` / ${row.needed} source${row.needed > 1 ? "s" : ""}`;
    } else {
      sep.textContent = " · couleur non utilisée";
    }
    meta.append(num, sep);
    r.appendChild(meta);

    list.appendChild(r);
  }
  els.analyzeManaBase.appendChild(list);

  const note = document.createElement("p");
  note.className = "mana-base-note";
  note.textContent = "Pour chaque couleur, on vérifie si le deck a assez de terrains pour caster ses sorts au bon moment. Une barre ambre signale qu'il manque des sources.";
  els.analyzeManaBase.appendChild(note);
}

function renderArchetypesPanel(resolved) {
  const archs = detectArchetypes(resolved);
  els.analyzeArchetypes.replaceChildren();
  if (archs.length === 0) {
    els.analyzeArchetypes.appendChild(placeholderText(
      "Profil mixte — aucune orientation dominante détectée.",
    ));
    els.analyzeArchetypesInfo.textContent = "profil mixte";
    return;
  }
  const top = archs.slice(0, 3); // show at most 3
  els.analyzeArchetypesInfo.textContent = `${top[0].label} (${Math.round(top[0].confidence * 100)} %)`;

  for (const a of top) {
    const row = document.createElement("div");
    row.className = "archetype-row";

    const head = document.createElement("div");
    head.className = "archetype-head";
    const label = document.createElement("strong");
    label.textContent = a.label;
    head.appendChild(label);
    const pct = document.createElement("span");
    pct.className = "archetype-percent";
    pct.textContent = `${Math.round(a.confidence * 100)} %`;
    head.appendChild(pct);
    row.appendChild(head);

    const bar = document.createElement("div");
    bar.className = "archetype-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuenow", String(Math.round(a.confidence * 100)));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const fill = document.createElement("div");
    fill.className = "archetype-bar-fill";
    fill.style.width = `${Math.round(a.confidence * 100)}%`;
    bar.appendChild(fill);
    row.appendChild(bar);

    els.analyzeArchetypes.appendChild(row);
  }
}

/* Themes panel: a row of toggleable pills, one per detected theme,
 * and a single shared card-grid panel below. Clicking a pill makes
 * it active and reveals its matching cards in the panel; clicking
 * the same pill again closes it; clicking a different pill swaps
 * the panel content.
 *
 * The pills are plain <button aria-pressed> rather than ARIA tabs:
 * tabs require arrow-key navigation and a strict tablist semantic,
 * and "toggle a chip" is a closer mental model for the user. */
function renderThemesPanel(deck) {
  const themes = detectThemes(deck);
  els.analyzeThemes.replaceChildren();
  if (themes.length === 0) {
    els.analyzeThemes.appendChild(placeholderText("Aucun thème dominant détecté."));
    els.analyzeThemesInfo.textContent = "";
    return;
  }
  els.analyzeThemesInfo.textContent = pluralFr(themes.length, "thème");

  const pillsRow = document.createElement("div");
  pillsRow.className = "themes-list";

  const panel = document.createElement("div");
  panel.className = "theme-panel";
  panel.hidden = true;

  /* Cache each theme's grid the first time it's opened. Re-selecting
   * is then a cheap detach/attach — no rebuild and no re-fetch of
   * thumbnail images (the <img> nodes are preserved). */
  const gridCache = new Map();
  let activeKey = null;
  let activePill = null;

  const buildGrid = (theme) => {
    const grid = document.createElement("div");
    grid.className = "cards theme-panel-cards";
    for (const c of theme.cards) {
      grid.appendChild(makeCardEl(c, {
        ariaLabel: `${c.name}, agrandir`,
        onActivate: () => showModal(c, []),
      }));
    }
    return grid;
  };

  const deselect = () => {
    if (activePill) {
      activePill.setAttribute("aria-pressed", "false");
      activePill.classList.remove("active");
    }
    activeKey = null;
    activePill = null;
    panel.hidden = true;
    panel.replaceChildren();
  };

  const select = (theme, pill) => {
    if (activeKey === theme.key) { deselect(); return; }
    deselect();
    let grid = gridCache.get(theme.key);
    if (!grid) {
      grid = buildGrid(theme);
      gridCache.set(theme.key, grid);
    }
    panel.replaceChildren(grid);
    panel.hidden = false;
    pill.setAttribute("aria-pressed", "true");
    pill.classList.add("active");
    activeKey = theme.key;
    activePill = pill;
  };

  for (const t of themes) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "theme-pill";
    pill.dataset.themeKey = t.key;
    pill.setAttribute("aria-pressed", "false");
    pill.append(t.label + " ");
    const num = document.createElement("strong");
    num.textContent = t.count;
    pill.appendChild(num);
    pill.addEventListener("click", () => select(t, pill));
    pillsRow.appendChild(pill);
  }

  els.analyzeThemes.append(pillsRow, panel);
}

/* Composition summary above the legality rules: commander count, deck
 * count, total. For Commander decks we also flash a badge when the
 * total drifts from the expected 100 (rules: 1 commander + 99 cards).
 * Limited and unknown formats just show the breakdown — no badge. */
function renderCompositionPanel(resolved) {
  const wrap = els.analyzeComposition;
  wrap.replaceChildren();
  const cmdN = resolved.commanders.length;
  const deckN = resolved.deck.length;
  const total = cmdN + deckN;
  const format = deckFormatOf(resolved);

  const counts = document.createElement("div");
  counts.className = "composition-counts";
  const parts = [];
  if (cmdN > 0 || format === "commander") {
    parts.push({ label: pluralFr(cmdN, "commandant"), value: cmdN });
  }
  parts.push({ label: pluralFr(deckN, "carte"), value: deckN });
  parts.push({ label: `total : ${total}`, value: total });
  parts.forEach((p, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "·";
      counts.appendChild(sep);
    }
    const span = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = String(p.value);
    // For the "total" entry the value is already inside the label, so
    // we render the label as-is. For the others we render `value` then
    // the singular/plural noun (e.g., "1 commandant").
    if (p.label.startsWith("total")) {
      span.textContent = p.label;
    } else {
      span.append(strong, " ", p.label.replace(/^\d+\s+/, ""));
    }
    counts.appendChild(span);
  });
  wrap.appendChild(counts);

  /* No badge here anymore. The card count + conformity check moved
   * into the legality rules list below, where each criterion gets
   * its own row (count / colour identity / singleton) with explicit
   * pass/fail status — easier to scan and self-explanatory. */
}

function renderLegalityPanel(resolved) {
  const format = deckFormatOf(resolved);
  els.analyzeLegality.replaceChildren();

  if (format !== "commander") {
    els.analyzeLegality.appendChild(placeholderText(
      "Format libre — pas de règle de singleton ni d'identité de couleur appliquée.",
    ));
    return;
  }

  /* Three rules, always rendered for commander format. Each has its
   * own status (ok / warning / error) and a one-line detail. The
   * user wanted explicit per-rule visibility rather than a bundled
   * "Identité et singleton OK" verdict, so a quick glance tells them
   * exactly which criterion passes or fails. */
  const rules = [];

  // 1. Card-count rule. Commander = 1 commander + 99 cards = 100.
  const cmdN = resolved.commanders.length;
  const deckN = resolved.deck.length;
  const total = cmdN + deckN;
  if (total === 100) {
    rules.push({
      label: "Compte de cartes",
      severity: "ok",
      detail: `${total} cartes (${cmdN} commandant${cmdN > 1 ? "s" : ""} + ${deckN}).`,
    });
  } else {
    const diff = total - 100;
    rules.push({
      label: "Compte de cartes",
      severity: "error",
      detail: diff > 0
        ? `${total} cartes — ${diff} en trop (cible 100).`
        : `${total} cartes — ${-diff} manquante${-diff > 1 ? "s" : ""} (cible 100).`,
    });
  }

  // 2. Commander-zone validity. Each card declared as a commander must
  // be a Legendary Creature, Legendary Planeswalker with the "can be
  // your commander" clause, or a Background enchantment.
  const badCmds = invalidCommanders(resolved);
  if (badCmds.length === 0) {
    rules.push({
      label: "Commander valide",
      severity: "ok",
      detail: cmdN === 0
        ? "Aucun commandant déclaré."
        : `${pluralFr(cmdN, "commandant")} légendaire${cmdN > 1 ? "s" : ""}.`,
    });
  } else {
    rules.push({
      label: "Commander valide",
      severity: "error",
      detail: `${pluralFr(badCmds.length, "carte")} ne peut pas servir de commandant : ${badCmds.join(", ")}.`,
    });
  }

  // 3. Format legality. Scryfall's `card.legalities.commander` tells us
  // banned vs not-legal vs legal. Most decks have 0 issues here, but
  // ban-list churn means it's worth a check — a deck saved months ago
  // might run a now-banned card.
  const { banned, notLegal } = commanderLegalityIssues([...resolved.commanders, ...resolved.deck]);
  if (banned.length === 0 && notLegal.length === 0) {
    rules.push({
      label: "Légalité en Commander",
      severity: "ok",
      detail: "Toutes les cartes sont légales.",
    });
  } else {
    const parts = [];
    if (banned.length > 0) {
      parts.push(`${pluralFr(banned.length, "carte")} bannie${banned.length > 1 ? "s" : ""} : ${banned.slice(0, 5).join(", ")}${banned.length > 5 ? "…" : ""}`);
    }
    if (notLegal.length > 0) {
      parts.push(`${pluralFr(notLegal.length, "non-légale")}${notLegal.length > 1 ? "s" : ""} : ${notLegal.slice(0, 5).join(", ")}${notLegal.length > 5 ? "…" : ""}`);
    }
    rules.push({
      label: "Légalité en Commander",
      severity: "error",
      detail: parts.join(" · "),
    });
  }

  // 4. Color identity. Scryfall's `color_identity` array on each card
  // makes this a clean structured check (see colorIdentityIssues in
  // deck-suggestions.js). Passing = every deck card's identity is a
  // subset of the commander's.
  const offColor = colorIdentityIssues(resolved);
  if (offColor.length === 0) {
    rules.push({
      label: "Identité de couleur",
      severity: "ok",
      detail: "Toutes les cartes respectent l'identité du commandant.",
    });
  } else {
    rules.push({
      label: "Identité de couleur",
      severity: "error",
      detail: `${pluralFr(offColor.length, "carte")} hors identité : ${offColor.slice(0, 5).join(", ")}${offColor.length > 5 ? "…" : ""}`,
    });
  }

  // 5. Singleton (excluding basic lands, which are exempt).
  const dups = singletonViolations(resolved.deck);
  if (dups.length === 0) {
    rules.push({
      label: "Singleton",
      severity: "ok",
      detail: "Aucune carte non-basique en double.",
    });
  } else {
    const txt = dups.slice(0, 5).map((d) => `${d.name} ×${d.qty}`).join(", ");
    rules.push({
      label: "Singleton",
      severity: "warning",
      detail: `${pluralFr(dups.length, "carte non-basique")} en double : ${txt}${dups.length > 5 ? "…" : ""}`,
    });
  }

  for (const r of rules) {
    const row = document.createElement("div");
    row.className = `legality-row legality-${r.severity}`;
    const icon = document.createElement("span");
    icon.className = "legality-icon";
    icon.textContent = r.severity === "ok" ? "✓" : "⚠";
    row.appendChild(icon);
    const body = document.createElement("div");
    body.className = "legality-body";
    const label = document.createElement("strong");
    label.textContent = r.label;
    body.appendChild(label);
    const detail = document.createElement("span");
    detail.className = "legality-detail";
    detail.textContent = r.detail;
    body.appendChild(detail);
    row.appendChild(body);
    els.analyzeLegality.appendChild(row);
  }
}

function renderSuggestionsPanel(resolved) {
  const list = suggestions(resolved);
  els.analyzeSuggestions.replaceChildren();
  if (list.length === 0) {
    els.analyzeSuggestions.appendChild(placeholderText("Aucune suggestion."));
    els.analyzeSuggestionsInfo.textContent = "";
    return;
  }
  const okCount = list.filter((s) => s.status === "ok").length;
  els.analyzeSuggestionsInfo.textContent = `${okCount}/${list.length} dans la cible`;

  for (const s of list) {
    const row = document.createElement("div");
    row.className = `suggestion-row suggestion-${s.status}`;

    const icon = document.createElement("span");
    icon.className = "suggestion-icon";
    icon.textContent = s.status === "ok" ? "✓"
      : s.status === "low" || s.status === "high" ? "⚠"
      : "ℹ";
    row.appendChild(icon);

    const body = document.createElement("div");
    body.className = "suggestion-body";

    const head = document.createElement("div");
    head.className = "suggestion-head";
    const label = document.createElement("strong");
    label.textContent = s.label;
    head.appendChild(label);
    const value = document.createElement("span");
    value.className = "suggestion-value";
    const current = document.createElement("strong");
    current.className = "suggestion-current";
    current.textContent = String(s.current);
    value.appendChild(current);
    if (s.target) {
      const target = document.createElement("span");
      target.className = "suggestion-target";
      target.textContent = ` / ${s.target}`;
      value.appendChild(target);
    }
    head.appendChild(value);
    body.appendChild(head);

    const advice = document.createElement("span");
    advice.className = "suggestion-advice";
    advice.textContent = s.advice;
    body.appendChild(advice);

    row.appendChild(body);
    els.analyzeSuggestions.appendChild(row);
  }
}

function renderBracket(deck) {
  const est = bracketEstimate(deck);

  els.analyzeBracket.replaceChildren();
  const badge = document.createElement("div");
  badge.className = "bracket-circle";
  badge.textContent = est.minBracket;
  els.analyzeBracket.appendChild(badge);

  const meta = document.createElement("div");
  meta.className = "bracket-meta";
  const label = document.createElement("strong");
  label.className = "bracket-info-title";
  label.textContent = est.label;
  meta.appendChild(label);

  const gcs = gameChangers(deck);
  if (gcs.length === 0) {
    const empty = document.createElement("span");
    empty.className = "gc-count";
    empty.textContent = "Aucun Game Changer dans le deck.";
    meta.appendChild(empty);
  } else {
    /* Native <details>/<summary> gives us keyboard handling, open
     * state and ARIA semantics for free. Card thumbnails are built
     * lazily on the first toggle and memoized — a deck with 8 GCs
     * still doesn't pay the makeCardEl cost until the user opens
     * the accordion. */
    const details = document.createElement("details");
    details.className = "gc-details";
    const summary = document.createElement("summary");
    summary.className = "gc-summary";
    const countText = document.createElement("span");
    countText.className = "gc-count";
    countText.textContent = `${pluralFr(gcs.length, "Game Changer")} repéré${gcs.length > 1 ? "s" : ""}`;
    summary.appendChild(countText);
    const chevron = document.createElement("span");
    chevron.className = "gc-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▾";
    summary.appendChild(chevron);
    details.appendChild(summary);

    const cards = document.createElement("div");
    cards.className = "cards gc-cards";
    details.appendChild(cards);
    details.addEventListener("toggle", () => {
      if (!details.open || cards.dataset.populated === "true") return;
      cards.dataset.populated = "true";
      for (const c of gcs) {
        cards.appendChild(makeCardEl(c, {
          ariaLabel: `${c.name}, agrandir`,
          onActivate: () => showModal(c, []),
        }));
      }
    });
    meta.appendChild(details);
  }

  const note = document.createElement("span");
  note.className = "note";
  note.textContent = est.note;
  meta.appendChild(note);

  els.analyzeBracket.appendChild(meta);
}

function renderManaCurveChart(deck) {
  const curve = manaCurve(deck);
  const total = Object.values(curve).reduce((a, b) => a + b, 0);
  els.analyzeCurveInfo.textContent = total === 0
    ? "—"
    : `${pluralFr(total, "sort")} (terrains exclus)`;
  const max = Math.max(1, ...Object.values(curve));

  els.analyzeCurve.replaceChildren();
  for (const key of ["0", "1", "2", "3", "4", "5", "6", "7+"]) {
    const col = document.createElement("div");
    col.className = "mana-curve-col";

    const bar = document.createElement("div");
    bar.className = "mana-curve-bar";
    bar.style.height = `${Math.max(2, (curve[key] / max) * 100)}%`;
    bar.title = `CMC ${key} : ${curve[key]}`;
    const value = document.createElement("span");
    value.className = "mana-curve-bar-value";
    value.textContent = curve[key];
    bar.appendChild(value);
    col.appendChild(bar);

    const lab = document.createElement("span");
    lab.className = "mana-curve-label";
    lab.textContent = key;
    col.appendChild(lab);

    els.analyzeCurve.appendChild(col);
  }
}

function renderTypeChart(deck) {
  const counts = cardTypeBreakdown(deck);
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  els.analyzeTypesInfo.textContent = pluralFr(total, "carte");

  els.analyzeTypes.replaceChildren();

  const bar = document.createElement("div");
  bar.className = "type-chart-bar";
  for (const t of Object.keys(counts)) {
    if (counts[t] === 0) continue;
    const seg = document.createElement("div");
    seg.className = "type-chart-segment";
    seg.style.flex = `${counts[t]} 0 0`;
    seg.style.background = TYPE_COLORS[t];
    seg.title = `${(TYPE_LABELS_FR[t] || t)} : ${counts[t]} (${Math.round((counts[t] / total) * 100)} %)`;
    bar.appendChild(seg);
  }
  els.analyzeTypes.appendChild(bar);

  const legend = document.createElement("div");
  legend.className = "type-chart-legend";
  for (const t of Object.keys(counts)) {
    if (counts[t] === 0) continue;
    const row = document.createElement("div");
    row.className = "type-chart-legend-row";
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = TYPE_COLORS[t];
    row.appendChild(sw);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = (TYPE_LABELS_FR[t] || t);
    row.appendChild(name);
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = counts[t];
    row.appendChild(num);
    legend.appendChild(row);
  }
  els.analyzeTypes.appendChild(legend);
}

function renderSubtypesPanel(deck) {
  const subs = creatureSubtypes(deck, 12);
  els.analyzeSubtypesInfo.textContent = subs.length === 0
    ? "—"
    : pluralFr(subs.filter((s) => s.subtype !== "Autres").length, "type") + " représenté" + (subs.length > 1 ? "s" : "");
  els.analyzeSubtypes.replaceChildren();
  if (subs.length === 0) {
    els.analyzeSubtypes.appendChild(placeholderText("Aucune créature dans le deck."));
    return;
  }
  for (const { subtype, count } of subs) {
    const pill = document.createElement("span");
    pill.className = "subtype-pill";
    pill.append(labelForSubtype(subtype) + " ");
    const num = document.createElement("span");
    num.className = "count";
    num.textContent = count;
    pill.appendChild(num);
    els.analyzeSubtypes.appendChild(pill);
  }
}

/* Tokens are fetched in two waves: any IDs already in the persistent
 * card-cache render immediately; the rest go to Scryfall in one batch.
 * Failures are silent — the tile shows just the name. */
async function renderTokensPanel(deck) {
  const ids = extractTokenIds(deck);
  els.analyzeTokens.replaceChildren();
  if (ids.length === 0) {
    els.analyzeTokensInfo.textContent = "—";
    els.analyzeTokens.appendChild(placeholderText("Aucun jeton produit."));
    return;
  }

  /* Try the local card-cache first — tokens fetched on a previous
   * render landed there via cacheCards below. If every required ID
   * is cached, we render synchronously and skip the Scryfall round-
   * trip entirely. Without this every rerenderDeckViews would re-
   * fetch tokens from the network. */
  const reader = cardCacheReader();
  const fromCache = [];
  const missingIds = [];
  for (const id of ids) {
    const card = reader.getById(id);
    if (card) fromCache.push(card);
    else missingIds.push(id);
  }

  let tokens;
  if (missingIds.length === 0) {
    tokens = dedupeByOracle(fromCache);
  } else {
    /* `ids.length` over-counts when several cards point at different
     * printings of the same token — show a neutral placeholder until
     * we have the post-dedupe count. */
    els.analyzeTokensInfo.textContent = "Chargement…";
    els.analyzeTokens.appendChild(placeholderText("Chargement des jetons…"));
    let result;
    try {
      result = await fetchScryfallCards(missingIds.map((id) => ({ id })));
    } catch (err) {
      els.analyzeTokensInfo.textContent = "—";
      els.analyzeTokens.replaceChildren(placeholderText(`Erreur Scryfall : ${err.message}`));
      return;
    }
    const fetched = [...result.byKey.values()];
    cacheCards(fetched);
    // Multiple cards can reference different printings of the same
    // token (e.g. five Meren cards each pointing at a different Zombie
    // printing). Their Scryfall IDs differ but they share an oracle_id
    // — collapse so the panel shows one tile per distinct token.
    tokens = dedupeByOracle([...fromCache, ...fetched]);
  }

  /* Counter follows the panel: tiles are deduped by oracle_id, so the
   * meta count must use `tokens.length`, not `ids.length`. */
  els.analyzeTokensInfo.textContent = tokens.length === 0
    ? "—"
    : pluralFr(tokens.length, "jeton") + " distinct" + (tokens.length > 1 ? "s" : "");

  els.analyzeTokens.replaceChildren();
  if (tokens.length === 0) {
    els.analyzeTokens.appendChild(placeholderText("Jetons introuvables sur Scryfall."));
    return;
  }
  /* Pull French names from the shared translations cache (same Scryfall
   * `lang:fr` pipeline as the manage view's EN/FR switch). Async fetch
   * resolves names not yet cached; we render with whatever's available
   * now and re-render once translations land. */
  const tokenNames = tokens.map((t) => t.name);
  const renderTokens = () => {
    const tr = bulkTranslationLookup();
    els.analyzeTokens.replaceChildren();
    for (const t of tokens) {
      const frName = tr(t.name) || t.name;
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "token-tile";
      tile.title = frName;
      tile.addEventListener("click", () => showModal(t, []));
      const src = cardImage(t, "normal");
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = frName;
        img.loading = "lazy";
        tile.appendChild(img);
      }
      const cap = document.createElement("span");
      cap.className = "token-tile-cap";
      cap.textContent = frName;
      tile.appendChild(cap);
      els.analyzeTokens.appendChild(tile);
    }
  };
  renderTokens();
  fetchFrenchNames(tokenNames).then(() => {
    /* Only re-render if the user is still on this deck — avoids
     * clobbering a render kicked off by a deck switch that landed
     * while we were waiting on Scryfall. */
    if (els.analyzeTokens.firstChild && els.analyzeTokens.firstChild.classList?.contains("token-tile")) {
      renderTokens();
    }
  });
}
