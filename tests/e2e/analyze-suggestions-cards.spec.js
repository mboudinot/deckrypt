import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");
});

test("each improvement row hides its cards behind a toggle", async ({ page }) => {
  const landsRow = page.locator("#analyze-suggestions .suggestion-row").first();
  const toggle = landsRow.locator(".suggestion-toggle");
  await expect(toggle).toHaveText(/Voir les cartes \(\d+\)/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(landsRow.locator(".suggestion-cards")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveText("Masquer les cartes");
  await expect(landsRow.locator(".suggestion-cards .card").first()).toBeVisible();

  await toggle.click();
  await expect(landsRow.locator(".suggestion-cards")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("clicking a revealed card opens the preview modal", async ({ page }) => {
  const landsRow = page.locator("#analyze-suggestions .suggestion-row").first();
  await landsRow.locator(".suggestion-toggle").click();
  await landsRow.locator(".suggestion-cards .card").first().click();
  await expect(page.locator("#modal")).toHaveClass(/open/);
});
