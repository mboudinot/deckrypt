import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* Two regressions in one suite:
 *
 *   1. Typing the French name of a basic land ("marais") must surface
 *      the basic Swamp. Scryfall's lang:fr search alone buries Swamp
 *      behind dozens of "Marais X" themed cards, so we pin the five
 *      basic lands locally and prepend them to the suggestions.
 *
 *   2. Adding a Swamp with an explicit printing to a deck that
 *      already holds a Swamp without one must NOT make the original
 *      entry "borrow" the new printing's art. byKey/byName resolution
 *      used to do that — see _resolveEntryDistinct in app.js. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await page.goto("/index.html");
  await page.click("#tab-manage");
});

test("typing 'marais' surfaces the basic Swamp as a suggestion", async ({ page }) => {
  await page.locator("#add-card-input").fill("marais");
  const items = page.locator("#add-card-suggestions li");
  await expect(items.first()).toBeVisible();
  /* The first suggestion is the basic Swamp, paired with its French
   * name. Any Scryfall-returned matches come after. */
  await expect(items.first().locator(".suggestion-primary")).toHaveText("Marais");
  await expect(items.first().locator(".suggestion-secondary")).toHaveText("Swamp");
});

test("typing 'forêt' or 'foret' surfaces Forest (accent-insensitive)", async ({ page }) => {
  await page.locator("#add-card-input").fill("foret");
  await expect(page.locator("#add-card-suggestions li").first()
    .locator(".suggestion-secondary")).toHaveText("Forest");
});

test("adding Swamp MOM to a deck with a default Swamp keeps both printings distinct", async ({ page }) => {
  /* The seeded Sultai deck has Swamp without set/cn. Add a new Swamp
   * with the CMD printing through the autocomplete + draft flow.
   * Before the fix, the original Swamp would silently inherit the
   * newly chosen printing. */
  await page.locator("#add-card-input").fill("swamp");
  await page.locator("#add-card-suggestions li", { hasText: "Swamp" }).first().click();
  await expect(page.locator("#add-card-draft-printing")).toBeEnabled();
  await page.locator("#add-card-draft-printing").selectOption("cmd:1");
  await page.click("#add-card-draft-submit");

  /* Manage view should now show two Swamp rows with DIFFERENT
   * printings — the original (default) plus the new CMD one. */
  const swampRows = page.locator("#manage-cards .card-row", { hasText: "Swamp" });
  await expect(swampRows).toHaveCount(2);
  const printings = await swampRows.locator(".card-row-printing").allTextContents();
  const normalized = printings.map((p) => p.trim());
  // One row carries CMD #1, the other carries "édition par défaut".
  expect(normalized.some((p) => /CMD\s+#1/.test(p))).toBe(true);
  expect(normalized.some((p) => /défaut/i.test(p))).toBe(true);
});
