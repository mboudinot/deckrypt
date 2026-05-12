import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* Header layout regression: the three view tabs (Jouer / Gérer /
 * Analyser) must be vertically aligned with the "+ Importer un deck"
 * button, the import button must sit on the right edge of the row,
 * and the active-tab pill must slide between tabs on click. Unit
 * tests can't catch any of these — they're pure layout/animation. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
});

test("tabs and import button share the same vertical center", async ({ page }) => {
  await page.goto("/index.html");
  const tabsBox = await page.locator(".view-tabs").boundingBox();
  const importBox = await page.locator("#btn-import-toggle").boundingBox();
  const tabsCenter = tabsBox.y + tabsBox.height / 2;
  const importCenter = importBox.y + importBox.height / 2;
  // Allow 1px tolerance for sub-pixel rounding across platforms.
  expect(Math.abs(tabsCenter - importCenter)).toBeLessThanOrEqual(1);
});

test("import button sits to the right of the view tabs", async ({ page }) => {
  await page.goto("/index.html");
  const tabsBox = await page.locator(".view-tabs").boundingBox();
  const importBox = await page.locator("#btn-import-toggle").boundingBox();
  const header = await page.locator(".header-actions").boundingBox();
  expect(importBox.x).toBeGreaterThan(tabsBox.x + tabsBox.width);
  // Import button must hug the right edge of the header row.
  const rightGap = (header.x + header.width) - (importBox.x + importBox.width);
  expect(rightGap).toBeLessThanOrEqual(2);
});

test("active-tab indicator slides under the clicked tab", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();

  const indicator = page.locator(".view-tab-indicator");
  await expect(indicator).toBeAttached();

  /* On load, the indicator sits under #tab-play. The check is on the
   * rendered geometry — we compare the indicator's left edge to each
   * tab's left edge (both in viewport coordinates). */
  const initial = await indicator.boundingBox();
  const playBox = await page.locator("#tab-play").boundingBox();
  expect(Math.abs(initial.x - playBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(initial.width - playBox.width)).toBeLessThanOrEqual(1);

  await page.click("#tab-manage");
  /* Wait out the 280ms CSS transition before measuring. */
  await page.waitForTimeout(350);
  const afterManage = await indicator.boundingBox();
  const manageBox = await page.locator("#tab-manage").boundingBox();
  expect(Math.abs(afterManage.x - manageBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterManage.width - manageBox.width)).toBeLessThanOrEqual(1);

  await page.click("#tab-analyze");
  await page.waitForTimeout(350);
  const afterAnalyze = await indicator.boundingBox();
  const analyzeBox = await page.locator("#tab-analyze").boundingBox();
  expect(Math.abs(afterAnalyze.x - analyzeBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterAnalyze.width - analyzeBox.width)).toBeLessThanOrEqual(1);
});
