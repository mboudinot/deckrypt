import { test, expect } from "@playwright/test";
import { mockScryfall, openDeckMenu } from "./_helpers.js";

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
});

test("Import button opens the modal on the Importer tab", async ({ page }) => {
  await expect(page.locator("#ie-modal")).toBeHidden();
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await expect(page.locator("#ie-modal")).toBeVisible();
  await expect(page.locator("#ie-tab-import")).toHaveClass(/active/);
  await expect(page.locator("#ie-panel-import")).toBeVisible();
  await expect(page.locator("#ie-panel-export")).toBeHidden();
});

test("Import lives in the header deck-menu (reachable from any view), Export is Manage-only", async ({ page }) => {
  /* Import moved into the deck-pill dropdown — open the menu to see
   * it, but it's reachable from every view. */
  await openDeckMenu(page);
  await expect(page.locator("#btn-import-toggle")).toBeVisible();
  await page.keyboard.press("Escape");
  // Export button lives inside the Manage view → hidden until tab swap.
  await expect(page.locator("#btn-export")).toBeHidden();
  await page.click("#tab-manage");
  await expect(page.locator("#btn-export")).toBeVisible();
});

test("Export button (in Manage view) opens the modal on the Exporter tab", async ({ page }) => {
  // The export button now lives inside the Manage view's deck info
  // panel — must switch tab first to reach it.
  await page.click("#tab-manage");
  await page.click("#btn-export");
  await expect(page.locator("#ie-modal")).toBeVisible();
  await expect(page.locator("#ie-tab-export")).toHaveClass(/active/);
  await expect(page.locator("#ie-panel-export")).toBeVisible();
  await expect(page.locator("#ie-panel-import")).toBeHidden();
});

test("Tabs swap panels inside the modal", async ({ page }) => {
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await page.click("#ie-tab-export");
  await expect(page.locator("#ie-panel-export")).toBeVisible();
  await expect(page.locator("#ie-panel-import")).toBeHidden();
  await page.click("#ie-tab-import");
  await expect(page.locator("#ie-panel-import")).toBeVisible();
  await expect(page.locator("#ie-panel-export")).toBeHidden();
});

test("Escape and the X button close the modal", async ({ page }) => {
  await page.click("#tab-manage");
  await page.click("#btn-export");
  await page.keyboard.press("Escape");
  await expect(page.locator("#ie-modal")).toBeHidden();

  await page.click("#btn-export");
  await page.click("#ie-modal-close");
  await expect(page.locator("#ie-modal")).toBeHidden();
});

test("Backdrop click does NOT close the modal (protects pasted content)", async ({ page }) => {
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await page.locator("#import-text").fill("1 Sol Ring");
  // Click well outside the content panel — the backdrop area.
  await page.locator("#ie-modal").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#ie-modal")).toBeVisible();
  await expect(page.locator("#import-text")).toHaveValue("1 Sol Ring");
});

test("Export populates the 4 formats in the select, MTGA chosen by default", async ({ page }) => {
  await page.click("#tab-manage");
  await page.click("#btn-export");
  await expect(page.locator("#export-format option")).toHaveCount(4);
  // Default selection.
  const selected = await page.locator("#export-format").inputValue();
  expect(selected).toBe("moxfield");
});

test("Export generates output that matches the selected format", async ({ page }) => {
  await page.click("#tab-manage");
  await page.click("#btn-export");

  // MTGA / Moxfield format: section headers + "qty Name (SET) cn" rows.
  let out = await page.locator("#export-output").inputValue();
  expect(out).toContain("// Commanders");
  expect(out).toContain("// Mainboard");

  // Switch to plain — one line per copy, no section headers.
  await page.locator("#export-format").selectOption("plain");
  out = await page.locator("#export-output").inputValue();
  expect(out).not.toContain("// Commanders");
  expect(out.split("\n").length).toBeGreaterThan(50); // Sultai has ~100 copies

  // Switch to JSON — parseable.
  await page.locator("#export-format").selectOption("json");
  out = await page.locator("#export-output").inputValue();
  const parsed = JSON.parse(out);
  expect(parsed.name).toBeTruthy();
  expect(parsed.format).toBe("commander");
  expect(Array.isArray(parsed.cards)).toBe(true);
});

test("Format description updates when the user changes format", async ({ page }) => {
  await page.click("#tab-manage");
  await page.click("#btn-export");
  const before = await page.locator("#export-description").textContent();
  await page.locator("#export-format").selectOption("plain");
  const after = await page.locator("#export-description").textContent();
  expect(after).not.toBe(before);
  expect(after).toMatch(/Discord|e-mail/i);
});

test("Import flow still works end-to-end via the modal", async ({ page }) => {
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await page.locator("#import-name").fill("Tiny test deck");
  await page.locator("#import-text").fill("1 Sol Ring\n1 Forest");
  // Wait for the preview to enable the confirm button.
  await expect(page.locator("#import-confirm")).toBeEnabled();
  await page.click("#import-confirm");
  // After confirm, the new deck is selected and the modal closes.
  await expect(page.locator("#ie-modal")).toBeHidden();
  await expect(page.locator("#deck-select option", { hasText: "Tiny test deck" }))
    .toHaveCount(1);
});
