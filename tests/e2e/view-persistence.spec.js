import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

async function boot(page) {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
}

test("F5 stays on the view the tab was showing", async ({ page }) => {
  await boot(page);
  await page.click("#tab-analyze");
  await page.reload();
  await expect(page.locator("#view-analyze")).toBeVisible();
  await expect(page.locator("#tab-analyze")).toHaveClass(/active/);
});

test("F5 on « Mes decks » stays there", async ({ page }) => {
  await boot(page);
  await page.click("#btn-deck-pill");
  await page.click("#btn-open-decks");
  await page.reload();
  await expect(page.locator("#view-decks")).toBeVisible();
  await expect(page.locator(".deck-tile")).toHaveCount(1);
});

test("a reload beats the default-view preference, a new tab still honours it", async ({ page, context }) => {
  await boot(page);
  await page.evaluate(() => localStorage.setItem("deckrypt-default-view", "manage"));
  await page.click("#tab-gallery");
  await page.reload();
  await expect(page.locator("#view-gallery")).toBeVisible();

  const fresh = await context.newPage();
  await mockScryfall(fresh);
  await mockAuth(fresh);
  await fresh.goto("/index.html");
  await expect(fresh.locator("#view-manage")).toBeVisible();
  await expect(fresh.locator("#view-gallery")).toBeHidden();
});
