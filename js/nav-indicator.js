/* Sliding indicator under the top nav.
 *
 * A single absolutely-positioned <span> tracks the active tab and
 * slides between siblings on hover. The visual (pill in Studio,
 * 2px underline in Editorial) is carried by the indicator; the
 * native .nav-tab.active rules in components.css are the fallback
 * when this script is absent (no .has-indicator class on .nav).
 *
 * Active-class changes are detected via MutationObserver rather
 * than coupling to switchView(), so clicks, keyboard nav, or any
 * future programmatic switch updates the indicator without extra
 * wiring.
 *
 * Exposed: window-global function setupNavIndicator(), called by
 * app.js init() per the project's load-order pattern (see
 * project_app_js_size memory).
 */
function setupNavIndicator() {
  const nav = document.querySelector(".nav");
  if (!nav) return;
  const tabs = Array.from(nav.querySelectorAll(".nav-tab"));
  if (tabs.length === 0) return;

  const indicator = document.createElement("span");
  indicator.className = "nav-indicator";
  indicator.setAttribute("aria-hidden", "true");
  nav.insertBefore(indicator, nav.firstChild);
  nav.classList.add("has-indicator");

  function positionOn(tab) {
    if (!tab) return;
    const navRect = nav.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    indicator.style.width = `${tabRect.width}px`;
    indicator.style.transform = `translateX(${tabRect.left - navRect.left}px)`;
  }

  function positionOnActive() {
    positionOn(nav.querySelector(".nav-tab.active"));
  }

  /* requestAnimationFrame gives the inline-flex layout a chance to
   * resolve before we measure — offsetLeft / getBoundingClientRect
   * can return 0 immediately after the indicator's insert into the
   * flex container, especially under a defer-script load order. */
  requestAnimationFrame(positionOnActive);

  for (const tab of tabs) {
    tab.addEventListener("mouseenter", () => positionOn(tab));
  }
  /* Listening on the whole nav (not per-tab) avoids races between
   * a leave-from-A and an enter-on-B firing in either order. */
  nav.addEventListener("mouseleave", positionOnActive);

  /* Re-sync when .active moves (clicks, keyboard, switchView, etc).
   * Skip while the pointer is inside the nav so the indicator stays
   * on the hover target instead of snapping back. */
  /* Active-class flips (click, keyboard, programmatic switchView)
   * don't necessarily resize the nav, so ResizeObserver wouldn't
   * catch them — we still need a MutationObserver on the tabs. */
  const classObserver = new MutationObserver(() => {
    if (!nav.matches(":hover")) positionOnActive();
  });
  for (const tab of tabs) {
    classObserver.observe(tab, { attributes: true, attributeFilter: ["class"] });
  }

  /* ResizeObserver covers every reflow that shifts tab geometry:
   *   - theme switch (Studio ↔ Editorial change .nav padding/gap and
   *     .nav-tab padding/font-size);
   *   - web-font load completion (Fraunces in Editorial swaps in from
   *     the Georgia fallback after Google Fonts arrives, changing
   *     text metrics and therefore tab widths — caught by CI as a
   *     theme-switch flake before this observer was wired in);
   *   - viewport resize that reflows nav contents.
   *
   * ResizeObserver fires AFTER the layout pass by contract, so no
   * rAF dance is needed — the measurements we read inside the
   * callback are guaranteed up-to-date. */
  const sizeObserver = new ResizeObserver(() => {
    const hovered = nav.querySelector(".nav-tab:hover");
    positionOn(hovered || nav.querySelector(".nav-tab.active"));
  });
  sizeObserver.observe(nav);
}
