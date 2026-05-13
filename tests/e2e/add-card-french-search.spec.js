import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* The add-card autocomplete searches both English and French. Typing
 * a French word (e.g. "foudre") returns matches via Scryfall's
 * `lang:fr name:` query; the suggestion shows the French label as
 * primary and the English oracle name in a muted secondary line.
 * Clicking adds the card by its English name (deck-edit is English-
 * keyed). */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.click("#tab-manage");
});

test("typing a French word surfaces English-named cards with FR labels", async ({ page }) => {
  await page.locator("#add-card-input").fill("foudre");
  /* The helper's lang:fr→en dictionary maps "foudre" → Lightning
   * Bolt. The English autocomplete returns nothing for "foudre"
   * (the mock only knows "sol*"), so this confirms the FR-search
   * branch is wired correctly. */
  const li = page.locator("#add-card-suggestions li").first();
  await expect(li).toBeVisible();
  await expect(li.locator(".suggestion-primary")).toHaveText("Foudre");
  await expect(li.locator(".suggestion-secondary")).toHaveText("Lightning Bolt");
});

test("typing an English word still works (no French label when absent)", async ({ page }) => {
  await page.locator("#add-card-input").fill("sol");
  /* "sol" returns Sol Ring, Sol, Solar Tide from English autocomplete.
   * None of those are in the FR dictionary so .suggestion-secondary
   * shouldn't appear. */
  const items = page.locator("#add-card-suggestions li");
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThanOrEqual(2);
  // No secondary line on any of these suggestions.
  await expect(items.locator(".suggestion-secondary")).toHaveCount(0);
});

test("clicking a French suggestion adds the English-named card", async ({ page }) => {
  await page.locator("#add-card-input").fill("foudre");
  await page.locator("#add-card-suggestions li", { hasText: "Foudre" }).first().click();
  /* The draft must show the English name (that's the identity stored
   * in deck.cards). The user typed "Foudre" but the deck entry is
   * Lightning Bolt — clicking "Foudre" carries through to the right
   * underlying card. */
  await expect(page.locator("#add-card-draft")).toBeVisible();
  await expect(page.locator("#add-card-draft-name")).toHaveText("Lightning Bolt");

  await page.click("#add-card-draft-submit");
  await expect(page.locator("#manage-cards .card-row", { hasText: "Lightning Bolt" })).toHaveCount(1);
});
