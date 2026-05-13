import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* The flash() helper is the app-wide toast system: stacking, auto-
 * dismiss, ARIA-live polite, accent-colored by kind. These tests
 * cover the manage-view action feedback (add via qty / draft, remove
 * via trash / qty) — the actual call sites — plus the generic
 * stacking + dismiss behavior. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.click("#tab-manage");
});

test("clicking '+' on a card row flashes a success message", async ({ page }) => {
  /* Pick any non-commander row in the seeded Sultai deck and bump
   * its qty. The flash should appear with the card name in it. */
  const row = page.locator("#manage-cards .card-row", { hasText: "Forest" }).first();
  await row.locator(".card-row-qty button", { hasText: "+" }).click();
  const flash = page.locator("#flash-container .flash").last();
  await expect(flash).toBeVisible();
  await expect(flash).toHaveClass(/flash-success/);
  await expect(flash).toContainText(/\+1 Forest/);
});

test("clicking '−' on a card row flashes the removal direction", async ({ page }) => {
  const row = page.locator("#manage-cards .card-row", { hasText: "Forest" }).first();
  await row.locator(".card-row-qty button", { hasText: "−" }).click();
  const flash = page.locator("#flash-container .flash").last();
  await expect(flash).toContainText(/−1 Forest/);
});

test("clicking the trash button flashes a removal message", async ({ page }) => {
  const row = page.locator("#manage-cards .card-row", { hasText: "Forest" }).first();
  await row.locator(".card-row-remove").click();
  const flash = page.locator("#flash-container .flash").last();
  await expect(flash).toBeVisible();
  await expect(flash).toContainText(/Forest retiré du deck/);
});

test("submitting the add-card draft flashes a confirmation", async ({ page }) => {
  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();
  await expect(page.locator("#add-card-draft-printing")).toBeEnabled();
  await page.locator("#add-card-draft-qty").fill("3");
  await page.click("#add-card-draft-submit");
  const flash = page.locator("#flash-container .flash").last();
  await expect(flash).toContainText(/\+3 Sol Ring ajoutés au deck/);
});

test("flashes stack: rapid actions produce multiple visible messages", async ({ page }) => {
  /* Two quick increments → two flashes, both visible. */
  const row = page.locator("#manage-cards .card-row", { hasText: "Forest" }).first();
  const plus = row.locator(".card-row-qty button", { hasText: "+" });
  await plus.click();
  await plus.click();
  await expect(page.locator("#flash-container .flash")).toHaveCount(2);
});

test("the × button dismisses a flash immediately", async ({ page }) => {
  const row = page.locator("#manage-cards .card-row", { hasText: "Forest" }).first();
  await row.locator(".card-row-qty button", { hasText: "+" }).click();
  const flash = page.locator("#flash-container .flash").last();
  await expect(flash).toBeVisible();
  await flash.locator(".flash-dismiss").click();
  /* The fade-out animation takes ~220ms; wait it out before the
   * locator should resolve to zero. */
  await expect(page.locator("#flash-container .flash")).toHaveCount(0, { timeout: 1000 });
});

test("paste-add of an empty textarea flashes an error", async ({ page }) => {
  await page.click("#add-card-paste-btn");
  const flash = page.locator("#flash-container .flash").last();
  await expect(flash).toHaveClass(/flash-error/);
  /* Two distinct messages now: "Colle une liste avant d'ajouter."
   * for empty textarea, "Aucune carte détectée dans le collage."
   * for non-empty but unparseable content. We assert the empty
   * case here. */
  await expect(flash).toContainText(/Colle une liste/);
});
