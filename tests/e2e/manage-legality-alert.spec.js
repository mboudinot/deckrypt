import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Commander-conformity warning in the manage deck-summary. Fed by the
 * same commanderRuleChecks as the analyze legality panel: hidden while
 * every rule passes, lists the failing rule(s) otherwise, and jumps to
 * Analyser on click. The seeded Sultai deck is a clean 1+99. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-manage");
});

const forestPlus = (page) => page.locator("#manage-cards .card-row", { hasText: "Forest" })
  .first().locator(".card-row-qty button", { hasText: "+" });

test("alert stays hidden on a conformant commander deck", async ({ page }) => {
  await expect(page.locator("#manage-deck-bracket")).toBeVisible();
  await expect(page.locator("#manage-deck-legality-alert")).toBeHidden();
});

test("breaking the card count surfaces the failing rule, in error colour", async ({ page }) => {
  await forestPlus(page).click();
  const alert = page.locator("#manage-deck-legality-alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Deck non conforme au format Commander");
  await expect(alert).toContainText(/Compte de cartes : 101 cartes — 1 en trop/);
  await expect(alert).toHaveClass(/is-error/);
});

test("clicking the alert opens the analyze legality panel", async ({ page }) => {
  await forestPlus(page).click();
  await page.click("#manage-deck-legality-alert");
  await expect(page.locator("#view-analyze")).toBeVisible();
  await expect(page.locator("#analyze-legality .legality-row.legality-error")).toHaveCount(1);
});

test("format libre never shows the commander warning", async ({ page }) => {
  await forestPlus(page).click();
  await expect(page.locator("#manage-deck-legality-alert")).toBeVisible();
  await page.click("#manage-deck-format-trigger");
  await page.click('#manage-deck-format-menu [data-format="limited"]');
  await expect(page.locator("#manage-deck-legality-alert")).toBeHidden();
});
