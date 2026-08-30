import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Camera card-scanner integration (js/card-scanner.js). The real pipeline
 * (camera + OpenCV rectification + Tesseract OCR) can't run in headless
 * Chromium, so these specs:
 *   - force navigator.mediaDevices.getUserMedia present/absent to drive
 *     the trigger button's visibility (it only shows where a camera is);
 *   - set window.__deckryptScannerNoEngine so open() skips the ~20 MB
 *     engine fetch (tests drive the match directly);
 *   - simulate a recognized match via window.__deckryptScannerPick and
 *     assert the add-card draft opens pre-set to the scanned edition.
 *
 * Scope: this file covers the DOM/handoff wiring only. The OCR text
 * parsing (parseBottom / cleanTitle) is pure and unit-tested in
 * tests/scan-parse.test.js; the CV and camera layers are exercised by
 * hand on a real device via ./dev-remote.sh. */

const FORCE_CAMERA = () => {
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
  }
  // Reject if ever called — tests never actually start the camera, they
  // use the __deckryptScannerPick seam. We only need the method to exist
  // so setupAddCardUI reveals the button.
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error("no camera in test"));
  // The button is gated on a coarse (touch) pointer — fake it so the
  // mobile-only button is revealed in headless Chromium (a fine pointer).
  const realMM = window.matchMedia.bind(window);
  window.matchMedia = (q) => (q === "(pointer: coarse)" ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : realMM(q));
  window.__deckryptScannerNoEngine = true;
};

async function bootManage(page, init) {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  if (init) await page.addInitScript(init);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-manage");
}

test("scan button is hidden when no camera is available", async ({ page }) => {
  await bootManage(page, () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });
  await expect(page.locator("#scan-card-btn")).toBeHidden();
});

test("scan button is shown when a camera is available", async ({ page }) => {
  await bootManage(page, FORCE_CAMERA);
  await expect(page.locator("#scan-card-btn")).toBeVisible();
});

test("scan button stays hidden on desktop even with a webcam (fine pointer)", async ({ page }) => {
  // A desktop webcam exposes getUserMedia, but the scanner is mobile-only.
  await bootManage(page, () => {
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
    }
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error("no camera in test"));
    // Leave matchMedia untouched → headless Chromium reports a fine pointer.
  });
  await expect(page.locator("#scan-card-btn")).toBeHidden();
});

/* The scanner UI lives in the scan.html iframe; with NoEngine the iframe
 * isn't loaded, so the overlay is just its frame. We assert on the overlay
 * shell + the iframe element rather than the (iframe-internal) intro. */
test("clicking the scan button opens the scanner overlay", async ({ page }) => {
  await bootManage(page, FORCE_CAMERA);
  await expect(page.locator("#scanner-overlay")).toBeHidden();
  await page.click("#scan-card-btn");
  await expect(page.locator("#scanner-overlay")).toBeVisible();
  await expect(page.locator("#scanner-frame")).toBeAttached();
});

test("the scanner closes via Escape and via the iframe close message", async ({ page }) => {
  await bootManage(page, FORCE_CAMERA);

  // Escape (parent handler; in prod the iframe also posts its own close).
  await page.click("#scan-card-btn");
  await expect(page.locator("#scanner-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#scanner-overlay")).toBeHidden();

  // The scan.html "Annuler"/"Fermer" buttons post a close message — drive
  // the same path the iframe would.
  await page.click("#scan-card-btn");
  await expect(page.locator("#scanner-overlay")).toBeVisible();
  await page.evaluate(() => {
    window.postMessage({ type: "deckrypt-scan", action: "close" }, window.location.origin);
  });
  await expect(page.locator("#scanner-overlay")).toBeHidden();
});

test("a recognized match opens the draft pre-set to the scanned edition", async ({ page }) => {
  await bootManage(page, FORCE_CAMERA);

  await page.click("#scan-card-btn");
  await expect(page.locator("#scanner-overlay")).toBeVisible();

  /* The helper's printings mock returns two editions for any card:
   * cmd:1 (Commander) and lea:2 (Alpha). The scanner hands back an
   * uppercase setcode "CMD"; the bridge lowercases it to "cmd:1". */
  await page.evaluate(() => {
    window.__deckryptScannerPick({ name: "Sol Ring", setcode: "CMD", cn: "1" });
  });

  // Scanner closes, draft opens with the matched card name.
  await expect(page.locator("#scanner-overlay")).toBeHidden();
  await expect(page.locator("#add-card-draft")).toBeVisible();
  await expect(page.locator("#add-card-draft-name")).toHaveText("Sol Ring");

  // Once printings land, the scanned edition (cmd:1) is pre-selected
  // rather than the default placeholder.
  const select = page.locator("#add-card-draft-printing");
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("cmd:1");
});

test("a scan-preselected edition does not leak into a later typed draft", async ({ page }) => {
  await bootManage(page, FORCE_CAMERA);

  // First: scan → cmd:1 pre-selected.
  await page.click("#scan-card-btn");
  await page.evaluate(() => {
    window.__deckryptScannerPick({ name: "Sol Ring", setcode: "CMD", cn: "1" });
  });
  await expect(page.locator("#add-card-draft-printing")).toHaveValue("cmd:1");
  await page.click("#add-card-draft-cancel");

  // Then: type a name → default placeholder ("" value), not cmd:1.
  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();
  const select = page.locator("#add-card-draft-printing");
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("");
});
