import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* Adding a card by name (paste-add or autocomplete) introduces an
 * identifier that may not be in the per-printing card-cache yet:
 * tryResolveSync(def) returns null, and refreshResolved falls back
 * to an async resolveDeck. The Analyze view must reflect the new
 * card once the fetch lands — without the user having to reload. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
});

test("paste-add of a never-fetched card updates the Analyze composition without reload", async ({ page }) => {
  /* Baseline: confirm the seeded Sultai deck reports 1 commander +
   * 99 cards (= 100). The Analyze view is pre-rendered, so we can
   * read it without clicking the tab first. */
  await page.click("#tab-analyze");
  await expect(page.locator("#analyze-composition")).toContainText(/total\s*:\s*100/);

  /* Paste-add a card name the deck doesn't already contain. The
   * /cards/collection mock will hand back valid data for any
   * identifier, so the async resolveDeck succeeds. */
  await page.click("#tab-manage");
  await page.locator("#add-card-paste-text").fill("1 Counterspell");
  await page.click("#add-card-paste-btn");

  /* Switch to Analyze and wait for the count to climb to 101. The
   * sync render after commit shows 100 still (the new card isn't in
   * state.resolved yet); the async refresh swaps state.resolved and
   * re-renders, taking the count to 101. */
  await page.click("#tab-analyze");
  await expect(page.locator("#analyze-composition")).toContainText(/total\s*:\s*101/);
});

test("two paste-adds in quick succession both land in Analyze (race condition)", async ({ page }) => {
  /* The second add bumps refreshToken, which discards the first
   * async fetch when it eventually lands. The second fetch (built
   * from the latest def) is the one that updates state.resolved.
   * Net effect: both cards must be present in the final count. */
  await page.click("#tab-manage");
  await page.locator("#add-card-paste-text").fill("1 Counterspell");
  await page.click("#add-card-paste-btn");
  await page.locator("#add-card-paste-text").fill("1 Brainstorm");
  await page.click("#add-card-paste-btn");

  await page.click("#tab-analyze");
  await expect(page.locator("#analyze-composition")).toContainText(/total\s*:\s*102/);
});
