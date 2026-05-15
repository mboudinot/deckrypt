import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Legal modal: footer triggers, hash routing, tab switching, and the
 * critical stack-above-login-overlay behaviour. The last bit is what
 * makes the "conditions / confidentialité" line in the login overlay
 * actually clickable before authentication — a regression of the
 * z-index value would leave the modal rendered behind the overlay,
 * so we exercise it explicitly. */

test.describe("legal modal — authenticated state", () => {
  test.beforeEach(async ({ page }) => {
    await mockScryfall(page);
    await mockAuth(page);
    await seedSultaiDeck(page);
    await page.goto("/index.html");
    await page.locator("#commander-zone .card").first().waitFor();
  });

  test("legal modal is hidden by default", async ({ page }) => {
    await expect(page.locator("#legal-modal")).toBeHidden();
  });

  test("footer renders three legal links with the current year", async ({ page }) => {
    const footer = page.locator(".app-footer");
    await expect(footer).toBeVisible();
    await expect(footer.locator("a")).toHaveCount(3);
    /* The year is populated by JS — check it isn't left blank. */
    const year = await page.locator("#app-footer-year").textContent();
    expect(year).toMatch(/^\d{4}$/);
  });

  test("clicking the Mentions footer link opens the modal on the Mentions panel", async ({ page }) => {
    await page.click('.app-footer a[data-legal-open="mentions"]');
    await expect(page.locator("#legal-modal")).toBeVisible();
    await expect(page.locator('[data-legal-panel="mentions"]')).toBeVisible();
    await expect(page.locator('[data-legal-panel="privacy"]')).toBeHidden();
    await expect(page.locator('[data-legal-panel="credits"]')).toBeHidden();
  });

  test("clicking a different nav tab switches panels (Confidentialité)", async ({ page }) => {
    await page.click('.app-footer a[data-legal-open="mentions"]');
    await page.click('.settings-nav-item[data-legal-tab="privacy"]');
    await expect(page.locator('[data-legal-panel="privacy"]')).toBeVisible();
    await expect(page.locator('[data-legal-panel="mentions"]')).toBeHidden();
  });

  test("hash #legal-privacy opens directly on the Confidentialité panel", async ({ page }) => {
    await page.goto("/index.html#legal-privacy");
    await page.locator("#commander-zone .card").first().waitFor();
    await expect(page.locator("#legal-modal")).toBeVisible();
    await expect(page.locator('[data-legal-panel="privacy"]')).toBeVisible();
  });

  test("closing the modal clears the legal- hash so a reload doesn't re-open it", async ({ page }) => {
    await page.goto("/index.html#legal-credits");
    await page.locator("#commander-zone .card").first().waitFor();
    await expect(page.locator("#legal-modal")).toBeVisible();
    await page.click("#btn-legal-close");
    await expect(page.locator("#legal-modal")).toBeHidden();
    /* location.hash is cleared by history.replaceState — a fresh
     * navigation without the hash would now leave the modal closed. */
    expect(await page.evaluate(() => location.hash)).toBe("");
  });

  test("Escape closes the modal", async ({ page }) => {
    await page.click('.app-footer a[data-legal-open="mentions"]');
    await expect(page.locator("#legal-modal")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#legal-modal")).toBeHidden();
  });
});

test.describe("legal modal — pre-auth (login overlay visible)", () => {
  /* No mockAuth here on purpose: we want the auth-locked path,
   * where the login overlay covers the app shell. Mock Scryfall
   * because the login overlay decorations fetch card images. */
  test.beforeEach(async ({ page }) => {
    await mockScryfall(page);
    await page.goto("/index.html");
    await page.locator("#login-overlay").waitFor({ state: "visible" });
  });

  test("login overlay terms line exposes two legal links", async ({ page }) => {
    const terms = page.locator(".login-terms");
    await expect(terms).toBeVisible();
    await expect(terms.locator("a")).toHaveCount(2);
  });

  test("clicking the policy link inside the login overlay opens the legal modal on top and lets the user interact with it", async ({ page }) => {
    await page.click('.login-terms a[data-legal-open="privacy"]');
    /* If the z-index were wrong (<= 1000), the modal would render
     * behind the login overlay and the click below would fall on the
     * overlay instead of the legal nav. The successful tab switch
     * proves the modal is actually on top and click-receivable. */
    await expect(page.locator("#legal-modal")).toBeVisible();
    await page.click('.settings-nav-item[data-legal-tab="credits"]');
    await expect(page.locator('[data-legal-panel="credits"]')).toBeVisible();
  });
});
