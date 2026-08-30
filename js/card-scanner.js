/* Camera card-scanner — app-side controller.
 *
 * The scanner UI + its engines live in a SEPARATE same-origin page
 * (scan.html) embedded here as a full-screen <iframe> overlay. OpenCV and
 * Tesseract both need 'unsafe-eval' (Emscripten); isolating them in
 * scan.html keeps the main app's strict default-src 'none' CSP intact —
 * see the CSP note in index.html. This file just opens/closes the overlay
 * and bridges the recognized card from the iframe back into the add-card
 * flow.
 *
 * Usage:
 *   window.cardScanner.open({ onPick: ({name, setcode, cn}) => { ... } });
 * onPick fires once the user confirms a match inside the iframe; the
 * overlay then closes and the iframe is torn down (stopping the camera).
 *
 * scan.html is loaded lazily on the first open() so its ~20 MB of engines
 * (OpenCV + Tesseract core + OCR model) never touches app boot. */

(function () {
  "use strict";

  const SCAN_URL = "scan.html";

  document.addEventListener("DOMContentLoaded", () => {
    const overlay = document.getElementById("scanner-overlay");
    const frame = document.getElementById("scanner-frame");
    if (!overlay || !frame) return;

    let onPickCb = null, previousFocus = null;

    function close() {
      overlay.hidden = true;
      // Tear down the iframe document → stops the camera and frees OpenCV.
      frame.src = "about:blank";
      onPickCb = null;
      if (previousFocus && document.contains(previousFocus) && typeof previousFocus.focus === "function") {
        previousFocus.focus();
      }
      previousFocus = null;
    }

    function deliver(card) {
      const cb = onPickCb;
      close();
      if (cb && card) cb({ name: card.name, setcode: card.setcode, cn: card.cn });
    }

    // Messages from the scan.html iframe (same-origin only).
    window.addEventListener("message", (e) => {
      if (e.origin !== window.location.origin) return;
      const msg = e.data;
      if (!msg || msg.type !== "deckrypt-scan") return;
      if (msg.action === "pick") deliver(msg.card);
      else if (msg.action === "close") close();
    });

    // Escape closes too. In production focus sits inside the iframe (which
    // posts its own 'close' on Escape); this parent handler covers the
    // case where the iframe content isn't loaded (e.g. e2e via the seam).
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) { e.preventDefault(); close(); }
    });

    window.cardScanner = {
      open({ onPick } = {}) {
        onPickCb = typeof onPick === "function" ? onPick : null;
        previousFocus = document.activeElement;
        overlay.hidden = false;
        overlay.focus();
        // Tests drive the pick via __deckryptScannerPick and skip the
        // ~10 MB iframe load; production always loads scan.html.
        if (!window.__deckryptScannerNoEngine) frame.src = SCAN_URL;
      },
    };

    // Test seam: simulate a recognized match without the iframe/OpenCV.
    // Mirrors window.__deckryptTestUser used elsewhere for e2e.
    window.__deckryptScannerPick = function (match) {
      if (onPickCb && match) deliver(match);
    };
  });
})();
