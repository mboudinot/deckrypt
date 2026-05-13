import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Settings modal: opening from the account dropdown, ⌘+, shortcut,
 * tab switching, theme picker persistence. Auth is mocked at the
 * window.sync level by overriding currentUser BEFORE the controller
 * reads it — keeps these tests offline. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
});

test("settings modal is hidden by default", async ({ page }) => {
  await expect(page.locator("#settings-modal")).toBeHidden();
});

test("Ctrl+, opens the settings modal even without going through the account menu", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await expect(page.locator("#settings-modal")).toBeVisible();
});

test("Escape closes the settings modal", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await expect(page.locator("#settings-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-modal")).toBeHidden();
});

test("clicking the backdrop closes the modal", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await expect(page.locator("#settings-modal")).toBeVisible();
  /* Click the backdrop near the edge (outside .settings-modal). */
  const box = await page.locator("#settings-modal").boundingBox();
  await page.mouse.click(box.x + 5, box.y + 5);
  await expect(page.locator("#settings-modal")).toBeHidden();
});

test("clicking the X button closes the modal", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click("#btn-settings-close");
  await expect(page.locator("#settings-modal")).toBeHidden();
});

test("clicking each tab switches which panel is visible", async ({ page }) => {
  await page.keyboard.press("Control+,");
  /* Default = Apparence. */
  await expect(page.locator('[data-settings-panel="appearance"]')).toBeVisible();
  await expect(page.locator('[data-settings-panel="preferences"]')).toBeHidden();
  await page.click('[data-settings-tab="preferences"]');
  await expect(page.locator('[data-settings-panel="preferences"]')).toBeVisible();
  await expect(page.locator('[data-settings-panel="appearance"]')).toBeHidden();
  await page.click('[data-settings-tab="shortcuts"]');
  await expect(page.locator('[data-settings-panel="shortcuts"]')).toBeVisible();
});

test("clicking a theme card sets html[data-direction] and persists in localStorage", async ({ page }) => {
  await page.keyboard.press("Control+,");
  /* Studio is the default at boot. */
  await expect(page.locator("html")).toHaveAttribute("data-direction", "studio");
  await page.click('[data-theme="editorial"]');
  await expect(page.locator("html")).toHaveAttribute("data-direction", "editorial");
  const saved = await page.evaluate(() => localStorage.getItem("deckrypt-direction"));
  expect(saved).toBe("editorial");
  /* The active class follows the selection. */
  await expect(page.locator('[data-theme="editorial"]')).toHaveClass(/active/);
  await expect(page.locator('[data-theme="studio"]')).not.toHaveClass(/active/);
});

test("reloading the page keeps the saved theme (boot-theme.js applies before CSS)", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-theme="editorial"]');
  await expect(page.locator("html")).toHaveAttribute("data-direction", "editorial");
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await expect(page.locator("html")).toHaveAttribute("data-direction", "editorial");
});

test("clicking a default-view segmented button persists the choice", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="preferences"]');
  await page.click('.segmented[data-segmented="default-view"] [data-value="manage"]');
  const saved = await page.evaluate(() => localStorage.getItem("deckrypt-default-view"));
  expect(saved).toBe("manage");
  await expect(page.locator('.segmented[data-segmented="default-view"] [data-value="manage"]')).toHaveClass(/active/);
});

test("density segmented control is disabled (placeholder UI)", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await expect(page.locator('.segmented[data-segmented="density"]')).toHaveAttribute("aria-disabled", "true");
});
