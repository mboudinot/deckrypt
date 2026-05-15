/* Legal modal controller — Mentions légales, Politique de
 * confidentialité, Crédits. Same shell pattern as the settings
 * modal (modal-backdrop + nav + panels), but with a higher z-index
 * so it stacks above the login overlay (accessible from the
 * "conditions / confidentialité" line before authentication).
 *
 * Entry points:
 *   - Footer links (#legal-link-mentions / -privacy / -credits)
 *   - Login overlay terms line (same anchors)
 *   - URL hash (#legal-mentions / #legal-privacy / #legal-credits)
 *   - Programmatic: window.openLegal("mentions" | "privacy" | "credits")
 */

(function () {
  const VALID_TABS = new Set(["mentions", "privacy", "credits"]);

  document.addEventListener("DOMContentLoaded", () => {
    /* Footer copyright year — set once, declarative so we never ship a
     * stale year on January 1st. */
    const yearEl = document.getElementById("app-footer-year");
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    const modal = document.getElementById("legal-modal");
    if (!modal) return;
    const closeBtn = document.getElementById("btn-legal-close");
    const navItems = modal.querySelectorAll(".settings-nav-item[data-legal-tab]");
    const panels = modal.querySelectorAll(".settings-panel[data-legal-panel]");

    let restoreFocusTo = null;

    function switchTab(id) {
      if (!VALID_TABS.has(id)) return;
      for (const nav of navItems) {
        const active = nav.dataset.legalTab === id;
        nav.classList.toggle("active", active);
        nav.setAttribute("aria-selected", String(active));
      }
      for (const panel of panels) {
        panel.hidden = panel.dataset.legalPanel !== id;
      }
    }

    function openModal(tab = "mentions") {
      restoreFocusTo = document.activeElement;
      modal.hidden = false;
      switchTab(VALID_TABS.has(tab) ? tab : "mentions");
      requestAnimationFrame(() => {
        const firstTab = modal.querySelector(".settings-nav-item.active") || navItems[0];
        if (firstTab) firstTab.focus();
      });
    }

    function closeModal() {
      modal.hidden = true;
      /* Clear the hash so a reload doesn't re-open the modal. Use
       * replaceState so we don't pollute the history stack. */
      if (location.hash.startsWith("#legal-")) {
        history.replaceState(null, "", location.pathname + location.search);
      }
      if (restoreFocusTo && typeof restoreFocusTo.focus === "function") {
        restoreFocusTo.focus();
      }
    }

    for (const nav of navItems) {
      nav.addEventListener("click", () => switchTab(nav.dataset.legalTab));
    }

    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    /* Backdrop click closes the modal — the click target is the
     * .modal-backdrop element itself; clicks inside .settings-modal
     * bubble through a child and won't match. */
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (modal.hidden) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    });

    /* Footer + login-overlay links route through data-legal-open. */
    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-legal-open]");
      if (!trigger) return;
      e.preventDefault();
      openModal(trigger.getAttribute("data-legal-open"));
    });

    /* Hash routing — both initial load and live changes. Strip the
     * `legal-` prefix to get the tab id. */
    function syncFromHash() {
      const m = /^#legal-(mentions|privacy|credits)$/.exec(location.hash);
      if (m) openModal(m[1]);
    }
    window.addEventListener("hashchange", syncFromHash);
    syncFromHash();

    window.openLegal = openModal;
  });
})();
