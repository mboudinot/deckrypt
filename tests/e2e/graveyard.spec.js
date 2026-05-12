import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* Helper: discard the first card from the hand via the per-card
 * modal's "Défausser" action. Faster and more deterministic in tests
 * than synthesizing a drag event. */
async function discardFirstHandCard(page) {
  await page.locator("#hand .card").first().click();
  await page.locator(".modal-actions button", { hasText: "Défausser" }).click();
  // Modal closes synchronously after the action callback.
  await expect(page.locator("#modal")).not.toHaveClass(/open/);
}

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await page.goto("/index.html");
  await page.locator("#hand .card").first().waitFor();
});

test("empty graveyard renders the placeholder, no stack class", async ({ page }) => {
  await expect(page.locator("#graveyard")).not.toHaveClass(/has-stack/);
  await expect(page.locator("#graveyard")).toContainText(/Cimetière vide/);
});

test("one card → top rendered alone, no stack pseudo-cards", async ({ page }) => {
  await discardFirstHandCard(page);
  await expect(page.locator("#graveyard .card")).toHaveCount(1);
  await expect(page.locator("#graveyard")).not.toHaveClass(/has-stack/);
});

test("two cards → has-stack class added (depth via ::before)", async ({ page }) => {
  await discardFirstHandCard(page);
  await discardFirstHandCard(page);
  await expect(page.locator("#graveyard .card")).toHaveCount(1);
  await expect(page.locator("#graveyard")).toHaveClass(/has-stack/);
  await expect(page.locator("#graveyard")).not.toHaveClass(/has-deep-stack/);
});

test("three+ cards → has-deep-stack class added (depth via ::after)", async ({ page }) => {
  for (let i = 0; i < 3; i++) await discardFirstHandCard(page);
  await expect(page.locator("#graveyard")).toHaveClass(/has-deep-stack/);
});

test("clicking the pile opens the graveyard modal with all cards", async ({ page }) => {
  await discardFirstHandCard(page);
  await discardFirstHandCard(page);
  await page.locator("#graveyard .card").click();
  await expect(page.locator(".graveyard-grid")).toBeVisible();
  await expect(page.locator(".graveyard-tile")).toHaveCount(2);
  await expect(page.locator(".graveyard-picker-title")).toContainText(/2 cartes/);
});

test("→ Main returns the card from the modal and refreshes the grid", async ({ page }) => {
  await discardFirstHandCard(page);
  await discardFirstHandCard(page);
  const handBefore = await page.locator("#hand .card").count();

  await page.locator("#graveyard .card").click();
  await page.locator(".graveyard-tile").first().locator("button", { hasText: "Main" }).click();

  // Hand grew by one, modal still open with 1 tile remaining.
  await expect(page.locator("#hand .card")).toHaveCount(handBefore + 1);
  await expect(page.locator(".graveyard-tile")).toHaveCount(1);
});

test("→ Champ moves the card to the battlefield and refreshes the grid", async ({ page }) => {
  await discardFirstHandCard(page);
  await discardFirstHandCard(page);

  await page.locator("#graveyard .card").click();
  await page.locator(".graveyard-tile").first().locator("button", { hasText: "Champ" }).click();

  // It either lands in #battlefield (non-land) or #lands (land), so
  // checking the union covers both cases.
  const onTable = await page.locator("#battlefield .card, #lands .card").count();
  expect(onTable).toBeGreaterThan(0);
  await expect(page.locator(".graveyard-tile")).toHaveCount(1);
});

test("emptying the graveyard via actions closes the modal", async ({ page }) => {
  await discardFirstHandCard(page);
  await page.locator("#graveyard .card").click();
  await page.locator(".graveyard-tile").first().locator("button", { hasText: "Main" }).click();
  await expect(page.locator("#modal")).not.toHaveClass(/open/);
  await expect(page.locator("#graveyard")).toContainText(/Cimetière vide/);
});
