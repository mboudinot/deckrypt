/* DOM helpers shared across views — anything that all four view
 * modules (`app-play`, `app-manage`, `app-analyze`, `app-gallery`)
 * reach for. Extracted from `app-play.js` so the cross-module
 * dependency stays explicit rather than relying on the historical
 * "app-play loads first → everyone else inherits the globals"
 * convention.
 *
 * Load order: BEFORE every `app-*.js` file (it provides functions
 * they call). `makeCardEl` lives in `app-play.js` still — it's only
 * used by the play view and depends on play-view drag handlers. */

/* Empty-state placeholder for a section that has no content yet
 * (a deck that isn't resolved, a zone with no cards, etc.).
 * Returns a centered muted-grey `<div>` ready to drop into any
 * container via `replaceChildren` or `appendChild`. */
function placeholderText(text) {
  const div = document.createElement("div");
  div.className = "placeholder-empty";
  div.textContent = text;
  return div;
}

/* X (close/remove) SVG built via DOM APIs rather than innerHTML —
 * avoids the pattern of "innerHTML with template literal" that's only
 * safe when the content is fully static, and trivially copy-pasted
 * into unsafe contexts later. Used by manage card-rows for the
 * "remove from deck" affordance and by the printing-picker's sticky
 * close button. */
const SVG_NS = "http://www.w3.org/2000/svg";
function makeXIcon(size = 14) {
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

  const a = document.createElementNS(SVG_NS, "line");
  a.setAttribute("x1", "6"); a.setAttribute("y1", "6");
  a.setAttribute("x2", "18"); a.setAttribute("y2", "18");
  svg.appendChild(a);
  const b = document.createElementNS(SVG_NS, "line");
  b.setAttribute("x1", "18"); b.setAttribute("y1", "6");
  b.setAttribute("x2", "6"); b.setAttribute("y2", "18");
  svg.appendChild(b);

  return svg;
}
