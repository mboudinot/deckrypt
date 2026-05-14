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
  const observer = new MutationObserver(() => {
    if (!nav.matches(":hover")) positionOnActive();
  });
  for (const tab of tabs) {
    observer.observe(tab, { attributes: true, attributeFilter: ["class"] });
  }

  /* Theme switch changes .nav padding/gap and .nav-tab padding, so
   * tab widths and offsets shift. The pixel-pinned indicator otherwise
   * straddles two tabs until the next hover repositions it.
   *
   * Double-rAF: the first frame lets the browser apply the theme CSS
   * change, the second runs after the resulting layout pass so our
   * getBoundingClientRect reads reflect the new geometry. A single
   * rAF can fire before the layout pass on slower runners (caught by
   * CI as a 7px miss vs the 2px tolerance), leaving the indicator
   * pinned to the old measurement with nothing to retrigger it. */
  const themeObserver = new MutationObserver(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const hovered = nav.querySelector(".nav-tab:hover");
      positionOn(hovered || nav.querySelector(".nav-tab.active"));
    }));
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-direction"],
  });

  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      if (!nav.matches(":hover")) positionOnActive();
    });
  });
}
