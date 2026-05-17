/* Sliding indicator under a row of segmented controls.
 *
 * A single absolutely-positioned <span> tracks the active item and
 * slides between siblings on hover. The visual (pill / underline /
 * chip-bg, depending on the surface) is carried by the indicator;
 * the native `.active` rules in CSS are the fallback when this
 * script is absent (no `.has-indicator` class on the container).
 *
 * `setupSlidingIndicator(container, opts)` is the generic helper —
 * used by both the top nav (pill / underline under .nav-tab) and the
 * gallery toolbar chip groups (pill under .gallery-chip). Active-
 * class changes are observed via MutationObserver so clicks /
 * keyboard / programmatic switches all re-anchor the indicator
 * without extra wiring.
 *
 * Exposed: window-globals `setupNavIndicator` (called once from
 * app.js init) and `setupSlidingIndicator` (called per chip group
 * by app-gallery.js after each toolbar rebuild). */
function setupSlidingIndicator(container, opts = {}) {
  if (!container) return;
  const itemSelector = opts.itemSelector || ".nav-tab";
  const indicatorClass = opts.indicatorClass || "nav-indicator";
  const activeClass = opts.activeClass || "active";

  const items = Array.from(container.querySelectorAll(itemSelector));
  if (items.length === 0) return;

  const indicator = document.createElement("span");
  indicator.className = indicatorClass;
  indicator.setAttribute("aria-hidden", "true");
  container.insertBefore(indicator, container.firstChild);
  container.classList.add("has-indicator");

  function positionOn(item) {
    if (!item) return;
    const cRect = container.getBoundingClientRect();
    const iRect = item.getBoundingClientRect();
    indicator.style.width = `${iRect.width}px`;
    indicator.style.transform = `translateX(${iRect.left - cRect.left}px)`;
  }

  function positionOnActive() {
    positionOn(container.querySelector(`${itemSelector}.${activeClass}`));
  }

  /* requestAnimationFrame gives the inline-flex layout a chance to
   * resolve before we measure — offsetLeft / getBoundingClientRect
   * can return 0 immediately after the indicator's insert into the
   * flex container, especially under a defer-script load order. */
  requestAnimationFrame(positionOnActive);

  for (const item of items) {
    item.addEventListener("mouseenter", () => positionOn(item));
  }
  /* Listening on the whole container (not per-item) avoids races
   * between a leave-from-A and an enter-on-B firing in either order. */
  container.addEventListener("mouseleave", positionOnActive);

  /* Active-class flips (click, keyboard, programmatic switchView)
   * don't necessarily resize the container, so ResizeObserver
   * wouldn't catch them — we still need a MutationObserver on the
   * items. Skip while the pointer is inside the container so the
   * indicator stays on the hover target instead of snapping back. */
  const classObserver = new MutationObserver(() => {
    if (!container.matches(":hover")) positionOnActive();
  });
  for (const item of items) {
    classObserver.observe(item, { attributes: true, attributeFilter: ["class"] });
  }

  /* ResizeObserver covers every reflow that shifts item geometry
   * (theme switch, web-font load completion, viewport resize). It
   * fires AFTER the layout pass by contract, so no rAF dance needed
   * — the measurements we read are guaranteed up-to-date. */
  const sizeObserver = new ResizeObserver(() => {
    const hovered = container.querySelector(`${itemSelector}:hover`);
    positionOn(hovered || container.querySelector(`${itemSelector}.${activeClass}`));
  });
  sizeObserver.observe(container);
}

function setupNavIndicator() {
  setupSlidingIndicator(document.querySelector(".nav"), {
    itemSelector: ".nav-tab",
    indicatorClass: "nav-indicator",
  });
}
