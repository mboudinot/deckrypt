/* Manage view — side panel renderers (Composition + Bracket).
 *
 * Split out of app-manage.js when that file passed 1300 lines (per
 * the CLAUDE.md backlog note). These two renderers don't touch the
 * main column at all — they consume `state.resolved` and write to
 * `#manage-side-composition` / `#manage-side-bracket`. Lives in its
 * own file so the main `app-manage.js` stays focused on the deck
 * editor (rows, add-card, summary header).
 *
 * Reads `state.resolved` and the global helpers from
 * `deck-suggestions.js` (count{Lands,Ramp,Draw,Interaction,BoardWipes})
 * and `deck-analytics.js` (`bracketEstimate`).
 * Load order: AFTER deck-suggestions + deck-analytics, BEFORE
 * app-manage.js — `renderManageView` in app-manage.js calls both
 * functions defined here. */

const COMPOSITION_ROWS = [
  { label: "Terrains",     count: (cards) => countLands(cards) },
  { label: "Rampe",        count: (cards) => countRamp(cards) },
  { label: "Pioche",       count: (cards) => countDraw(cards) },
  { label: "Interaction",  count: (cards) => countInteraction(cards) },
  { label: "Board wipes",  count: (cards) => countBoardWipes(cards) },
];

function renderSideComposition() {
  const el = document.getElementById("manage-side-composition");
  if (!el) return;
  el.replaceChildren();
  if (!state.resolved) {
    const p = document.createElement("p");
    p.className = "manage-side-placeholder";
    p.textContent = "Chargement…";
    el.appendChild(p);
    return;
  }
  const cards = state.resolved.deck || [];
  const total = cards.length || 1;
  for (const row of COMPOSITION_ROWS) {
    const n = row.count(cards);
    const wrap = document.createElement("div");
    wrap.className = "composition-row";
    const head = document.createElement("div");
    head.className = "composition-row-head";
    const lab = document.createElement("span");
    lab.className = "label";
    lab.textContent = row.label;
    const val = document.createElement("span");
    val.className = "value num";
    val.textContent = String(n);
    head.appendChild(lab);
    head.appendChild(val);
    wrap.appendChild(head);
    const bar = document.createElement("div");
    bar.className = "composition-row-bar";
    const fill = document.createElement("div");
    fill.className = "composition-row-bar-fill";
    fill.style.width = Math.min(100, (n / total) * 100) + "%";
    bar.appendChild(fill);
    wrap.appendChild(bar);
    el.appendChild(wrap);
  }
}

function renderSideBracket() {
  const el = document.getElementById("manage-side-bracket");
  const labelEl = document.getElementById("manage-side-bracket-label");
  if (!el || !labelEl) return;
  el.replaceChildren();
  if (!state.resolved || typeof bracketEstimate !== "function") {
    labelEl.textContent = "—";
    const p = document.createElement("p");
    p.className = "manage-side-placeholder";
    p.textContent = "Chargement…";
    el.appendChild(p);
    return;
  }
  const fullDeck = [...state.resolved.commanders, ...state.resolved.deck];
  const result = bracketEstimate(fullDeck);
  labelEl.textContent = `min ${result.minBracket}`;

  const head = document.createElement("div");
  head.className = "manage-side-bracket-head";
  const num = document.createElement("span");
  num.className = "bracket-large";
  num.textContent = String(result.minBracket);
  head.appendChild(num);
  const info = document.createElement("div");
  const lab = document.createElement("div");
  lab.className = "label";
  lab.textContent = result.label;
  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = `${result.gameChangerCount} Game Changer${result.gameChangerCount > 1 ? "s" : ""} détecté${result.gameChangerCount > 1 ? "s" : ""}`;
  info.appendChild(lab);
  info.appendChild(sub);
  head.appendChild(info);
  el.appendChild(head);

  const verdict = document.createElement("p");
  verdict.className = "manage-side-bracket-verdict";
  verdict.textContent = result.note;
  el.appendChild(verdict);
}
