/* Reusable confirm dialog — replaces window.confirm() for destructive
 * or otherwise-irreversible operations.
 *
 * Usage:
 *   const ok = await window.confirmDialog({
 *     title: "Supprimer le deck",
 *     message: 'Le deck "Sultai" sera perdu. Continuer ?',
 *     confirmLabel: "Supprimer",
 *     danger: true,
 *   });
 *   if (!ok) return;
 *
 * Closure semantics:
 *   - Enter (when focus is on Confirm) — confirms.
 *   - Escape — cancels.
 *   - Backdrop click — cancels (the operation is destructive by
 *     design, dismissing should be the safe outcome).
 *   - X button — n/a (this dialog has no X; the two buttons cover
 *     both paths).
 *
 * On destructive prompts (danger:true), the Cancel button gets
 * initial focus rather than Confirm — so a stray Enter doesn't
 * commit. */

(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("confirm-modal");
    const titleEl = document.getElementById("confirm-modal-title");
    const messageEl = document.getElementById("confirm-modal-message");
    const okBtn = document.getElementById("confirm-modal-ok");
    const cancelBtn = document.getElementById("confirm-modal-cancel");
    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) return;

    let currentResolve = null;
    let previousFocus = null;

    function settle(value) {
      if (!currentResolve) return;
      const r = currentResolve;
      currentResolve = null;
      modal.classList.remove("open");
      modal.hidden = true;
      if (previousFocus && document.contains(previousFocus)
          && typeof previousFocus.focus === "function") {
        previousFocus.focus();
      }
      previousFocus = null;
      r(value);
    }

    okBtn.addEventListener("click", () => settle(true));
    cancelBtn.addEventListener("click", () => settle(false));
    modal.addEventListener("click", (e) => {
      /* Backdrop = the modal itself; clicks on .confirm-modal-content
       * (or anything inside) don't propagate up to here as e.target. */
      if (e.target === modal) settle(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && currentResolve) {
        e.preventDefault();
        settle(false);
      }
    });

    window.confirmDialog = function confirmDialog(opts = {}) {
      return new Promise((res) => {
        /* If another confirm is in flight, cancel it first — UI shows
         * one modal at a time. Practically this won't happen, but the
         * safety net is cheap. */
        if (currentResolve) settle(false);
        currentResolve = res;
        titleEl.textContent = opts.title || "Confirmation";
        messageEl.textContent = opts.message || "";
        okBtn.textContent = opts.confirmLabel || "Confirmer";
        cancelBtn.textContent = opts.cancelLabel || "Annuler";
        okBtn.classList.toggle("danger", !!opts.danger);
        previousFocus = document.activeElement;
        modal.hidden = false;
        modal.classList.add("open");
        /* Defer focus so the modal has a frame to render — focusing
         * on a display:none subtree fails silently. Cancel gets
         * focus on danger prompts so a stray Enter doesn't commit. */
        requestAnimationFrame(() => {
          (opts.danger ? cancelBtn : okBtn).focus();
        });
      });
    };
  });
})();
