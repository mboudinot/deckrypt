import { test, expect } from "@playwright/test";

/* Nothing else in the suite loads scan.html — card-scanner.spec.js skips it
 * via the __deckryptScannerNoEngine seam — so a broken <script> list here
 * would ship green. */

test("scan.html evaluates without throwing and exposes its script contract", async ({ page }) => {
  const errors = [];
  // pageerror only: Tesseract's core logs a benign CSP error (its wasm data:
  // URI is blocked, it falls back to base64) that a console assert would trip on.
  page.on("pageerror", (e) => errors.push(e.message));

  // domcontentloaded: the sync scripts have run; `load` would wait on opencv.js's 20 MB.
  await page.goto("/scan.html", { waitUntil: "domcontentloaded" });

  const globals = await page.evaluate(() => ({
    fetchScryfallCards: typeof fetchScryfallCards,
    cardImage: typeof cardImage,
    parseBottom: typeof parseBottom,
    cleanTitle: typeof cleanTitle,
  }));

  expect(globals).toEqual({
    fetchScryfallCards: "function",
    cardImage: "function",
    parseBottom: "function",
    cleanTitle: "function",
  });
  expect(errors).toEqual([]);
});
